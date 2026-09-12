// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { agents, createDatabase } from "@agentco/db";
import { buildSpawnSpec } from "@agentco/adapters";
import { buildSkillManifest, composeSystemPrompt } from "@agentco/shared";
import {
  createDispatchRepository,
  createInstructionRepository,
  createSkillRepository,
} from "@agentco/core";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { superviseRun } from "./supervisor.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const database = createDatabase(env.DATABASE_URL, 10);

const dispatch = createDispatchRepository(database.db);
const instructions = createInstructionRepository(database.db);
const skills = createSkillRepository(database.db);

/** Identifies this process in a lease, so a reaper knows whose run it was. */
const RUNNER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = env.RUN_LEASE_SECONDS;
const STALE_AFTER_SECONDS = LEASE_SECONDS * 3;

const transcriptDir = resolve(process.cwd(), env.RUN_TRANSCRIPT_DIR);
await mkdir(transcriptDir, { recursive: true });

let stopping = false;
const active = new Set<string>();

async function executeRun(claim: {
  runId: string;
  agentId: string;
  organizationId: string;
  prompt: string;
}): Promise<void> {
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

    const systemPrompt = composeSystemPrompt({
      instructions: identity,
      instructionsPath: "AGENTS.md",
      manifest: manifest || buildSkillManifest([]),
    });

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
      transcriptDir,
      timeoutSec,
      graceSec,
      onStart: async (pid, _systemPromptPath, transcriptPath, command) => {
        await dispatch.markRunning(claim.runId, pid, systemPrompt, transcriptPath);
        runLog.info({ pid, command }, "run started");
      },
      onEvents: (events) => dispatch.appendEvents(claim.runId, events),
      shouldCancel: () => dispatch.cancelRequested(claim.runId),
      heartbeat: () => dispatch.touch(claim.runId, LEASE_SECONDS),
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

    runLog.info({ status, exitCode: result.exitCode }, "run finished");
  } catch (error) {
    runLog.error({ err: error }, "run failed unexpectedly");
    await dispatch
      .finish(claim.runId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown failure.",
      })
      .catch(() => undefined);
  } finally {
    active.delete(claim.runId);
  }
}

async function tick(): Promise<void> {
  // Recover before dispatching: a run whose runner died holds the agent's only
  // active-run slot, and nothing new can start until it is released.
  const reaped = await dispatch.reapStale(STALE_AFTER_SECONDS);
  if (reaped.length > 0) log.warn({ count: reaped.length }, "reaped runs with no live runner");

  const claim = await dispatch.claimNext(RUNNER_ID, LEASE_SECONDS);
  if (!claim) return;

  // Deliberately not awaited: a long run must not block the loop from picking
  // up work for a different agent.
  void executeRun(claim);
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
