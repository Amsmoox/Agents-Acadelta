// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { agents, createDatabase } from "@agentco/db";
import { buildSpawnSpec } from "@agentco/adapters";
import type { ClaimedRun } from "@agentco/core";
import { buildSkillManifest, composeSystemPrompt } from "@agentco/shared";
import {
  RUN_API_ENV,
  RUN_TOKEN_ENV,
  createCredentialRepository,
  createDispatchRepository,
  createObjectiveRepository,
  createInstructionRepository,
  createSkillRepository,
  createTaskRepository,
} from "@agentco/core";
import { buildToolManifest, writeShim } from "@agentco/sandbox";
import { buildWorkPrompt } from "./work-context.js";
import { verifyObjectives } from "./verify-objectives.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { superviseRun } from "./supervisor.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const database = createDatabase(env.DATABASE_URL, 10);

const dispatch = createDispatchRepository(database.db);
const instructions = createInstructionRepository(database.db);
const skills = createSkillRepository(database.db);
const taskRepo = createTaskRepository(database.db);
const credentials = createCredentialRepository(database.db);
const objectiveRepo = createObjectiveRepository(database.db);


/** Identifies this process in a lease, so a reaper knows whose run it was. */
const RUNNER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = env.RUN_LEASE_SECONDS;
const STALE_AFTER_SECONDS = LEASE_SECONDS * 3;

/** Put on each child's PATH, so `agentco` is a command it can simply run. */
const shimDir = resolve(process.cwd(), env.RUN_SHIM_DIR);
const transcriptDir = resolve(process.cwd(), env.RUN_TRANSCRIPT_DIR);
await mkdir(transcriptDir, { recursive: true });

// Written once at startup rather than per run: it is the same file every time,
// and a child that starts while it is being rewritten would find half of one.
await writeShim(shimDir);

let stopping = false;
const active = new Set<string>();

async function executeRun(claim: ClaimedRun): Promise<void> {
  active.add(claim.runId);
  const runLog = log.child({ runId: claim.runId, agentId: claim.agentId });

  try {
    const [agent] = await database.db
      .select()
      .from(agents)
      .where(eq(agents.id, claim.agentId))
      .limit(1);
    if (!agent) {
      await dispatch.finish(claim.runId, { status: "failed", error: "Agent no longer exists." });
      return;
    }

    // What the agent is: its instruction bundle, plus one line per skill in the
    // organization. Skill bodies stay on disk and are read only if the agent
    // decides they apply.
    const [identity, manifest] = await Promise.all([
      instructions.entry(claim.organizationId, claim.agentId),
      skills.manifestFor(claim.organizationId, claim.agentId),
    ]);

    // Take a task before saying anything, so the prompt can be about the work
    // rather than about the possibility of work. Claiming is atomic: if another
    // runner got there first this simply returns nothing and the run proceeds
    // with none, which is a normal outcome rather than an error.
    const claimedTask = await taskRepo.claimNextFor(claim.agentId, claim.runId);


    // A run by an agent carrying a standing order is one cycle of it, whether
    // or not it picked up a task. Counted before the work, so a run that
    // crashes still spends the cycle it started.
    const objective = await objectiveRepo.activeFor(claim.agentId);
    if (objective) await objectiveRepo.beginCycle(objective.id);

    const token = await credentials.mint({
      runId: claim.runId,
      organizationId: claim.organizationId,
      agentId: claim.agentId,
      responsibleUserId: claimedTask?.responsibleUserId ?? "owner",
      expiresAt: new Date(Date.now() + LEASE_SECONDS * 4000),
    });
    // The project comes from the task when there is one and from the standing
    // objective when there is not, so an agent woken to carry an objective can
    // still see its team and its board — which is the run where it needs them.
    await credentials.setContext(claim.runId, {
      taskId: claimedTask?.id ?? null,
      projectId: claimedTask?.projectId ?? objective?.projectId ?? null,
    });

    const work = await buildWorkPrompt(database.db, {
      organizationId: claim.organizationId,
      agentId: claim.agentId,
      taskId: claimedTask?.id ?? null,
      reasons: claim.reasons,
    });

    const systemPrompt = [
      composeSystemPrompt({
        instructions: identity,
        instructionsPath: "AGENTS.md",
        manifest: manifest || buildSkillManifest([]),
      }),
      "",
      buildToolManifest(),
      "",
      work,
    ].join("\n");

    // Probed before spawning so an adapter the local runner cannot start fails
    // with an explanation rather than a missing-command error.
    const probe = buildSpawnSpec(agent.adapterType, {
      prompt: claim.prompt,
      systemPromptPath: "/dev/null",
      config: agent.adapterConfig,
    });

    if (!probe) {
      await dispatch.finish(claim.runId, {
        status: "failed",
        error: `The local runner cannot start a ${agent.adapterType} agent.`,
      });
      return;
    }

    const config = agent.adapterConfig;
    const timeoutSec = typeof config["timeoutSec"] === "number" ? config["timeoutSec"] : 0;
    const graceSec = typeof config["graceSec"] === "number" ? config["graceSec"] : 15;
    const cwd = typeof config["cwd"] === "string" && config["cwd"] ? config["cwd"] : undefined;

    const result = await superviseRun({
      runId: claim.runId,
      buildSpec: (systemPromptPath) =>
        buildSpawnSpec(agent.adapterType, {
          prompt: claim.prompt,
          systemPromptPath,
          config: agent.adapterConfig,
        })!,
      systemPrompt,
      cwd,
      // The token goes into the environment and nowhere else: an argument list
      // is readable by every other user on the machine.
      env: {
        [RUN_TOKEN_ENV]: token,
        [RUN_API_ENV]: env.API_URL,
        PATH: `${shimDir}:${process.env["PATH"] ?? ""}`,
      },
      transcriptDir,
      timeoutSec,
      graceSec,
      onStart: async (pid, _systemPromptPath, transcriptPath, command) => {
        await dispatch.markRunning(claim.runId, pid, systemPrompt, transcriptPath);
        runLog.info({ pid, command }, "run started");
      },
      onEvents: (events) => dispatch.appendEvents(claim.runId, events),
      shouldCancel: () => dispatch.cancelRequested(claim.runId),
      heartbeat: async () => {
        await dispatch.touch(claim.runId, LEASE_SECONDS);
        // The credential is extended with the lease; a long run must not lose
        // its own hands halfway through.
        await credentials.touch(claim.runId, new Date(Date.now() + LEASE_SECONDS * 4000));
      },
    });

    const status = result.cancelled
      ? "cancelled"
      : result.exitCode === 0
        ? "completed"
        : "failed";

    await dispatch.finish(claim.runId, {
      status,
      exitCode: result.exitCode,
      ...(result.timedOut ? { stopReason: "timeout" } : {}),
      ...(status === "failed"
        ? {
            // A spawn failure names the real cause; "exited with code unknown"
            // is what an operator gets when the command simply is not installed.
            error:
              result.error ??
              (result.timedOut
                ? "The run was stopped for taking too long."
                : `The agent exited with code ${result.exitCode ?? "unknown"}.`),
          }
        : {}),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costCents: result.costCents,
    });

    // The credential dies with the run, so a token that escaped a crashed child
    // is inert rather than valid for as long as anyone holds it.
    await credentials.revoke(claim.runId);
    if (claimedTask) {
      await taskRepo.releaseClaim(claimedTask.id, claim.runId);
      // Whether this run got anywhere decides whether the task is worth waking
      // anybody for again. Five silent runs and it stops asking and waits for
      // a person instead.
      const { stalled } = await taskRepo.noteRunOutcome(
        claim.organizationId,
        claimedTask.id,
        claim.runId,
        claimedTask.status,
      );
      if (stalled) runLog.warn({ task: claimedTask.key }, "task made no progress; parked");
    }

    if (objective) {
      const ending = await objectiveRepo.endCycle(objective.id, {
        runId: claim.runId,
        costCents: result.costCents,
      });
      if (ending) {
        // It ran out of cycles, budget or ideas. It stops, and it says which —
        // and a report is written either way, because a standing order that
        // ends quietly is indistinguishable from one nobody is running.
        await objectiveRepo.end(claim.organizationId, objective.id, ending);
        runLog.warn({ objective: objective.id, outcome: ending.outcome }, "objective ended");
      }
    }

    runLog.info({ status, exitCode: result.exitCode, task: claimedTask?.key }, "run finished");
  } catch (error) {
    runLog.error({ err: error }, "run failed unexpectedly");
    await dispatch
      .finish(claim.runId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown failure.",
      })
      .catch(() => undefined);
    await credentials.revoke(claim.runId).catch(() => undefined);
    await taskRepo.releaseClaimsOfRun(claim.runId).catch(() => undefined);
  } finally {
    active.delete(claim.runId);
  }
}

async function tick(): Promise<void> {
  // Recover before dispatching: a run whose runner died holds the agent's only
  // active-run slot, and nothing new can start until it is released.
  const reaped = await dispatch.reapStale(STALE_AFTER_SECONDS);
  if (reaped.length > 0) log.warn({ count: reaped.length }, "reaped runs with no live runner");

  // An objective whose owner has asked to finish is tested here rather than
  // taken at its word. This is the only place in the system that can run a
  // command, and it has no stake in the answer.
  await verifyObjectives(database.db, log);

  // Keep claiming while there is work and capacity. One claim per tick meant
  // four agents woken at the same moment started one poll interval apart, so a
  // team of four took six seconds to get going and a team of ten, fifteen —
  // for no reason other than the shape of this loop.
  while (!stopping && active.size < env.MAX_CONCURRENT_RUNS) {
    const claim = await dispatch.claimNext(RUNNER_ID, LEASE_SECONDS);
    if (!claim) break;

    // Deliberately not awaited: a long run must not block the loop from picking
    // up work for a different agent. `executeRun` adds to `active` before its
    // first await, so the check above sees this one on the next pass.
    void executeRun(claim);
  }
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      log.error({ err: error }, "dispatch tick failed");
    }
    await new Promise((r) => setTimeout(r, env.DISPATCH_POLL_INTERVAL_MS));
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal, active: active.size }, "shutting down runner");

  // Runs in flight are left to the reaper rather than killed here: their
  // children are detached and still writing, and a restart will find them.
  await database.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

log.info(
  { runnerId: RUNNER_ID, transcriptDir, pollIntervalMs: env.DISPATCH_POLL_INTERVAL_MS },
  "runner started",
);

await loop();
