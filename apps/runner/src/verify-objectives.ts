// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { spawn } from "node:child_process";
import type { Database, ObjectiveRow } from "@agentco/db";
import {
  checksFor,
  commandChecks,
  createObjectiveRepository,
  createTaskRepository,
} from "@agentco/core";
import type { ObjectiveCheckResult } from "@agentco/shared";
import type { Logger } from "./logger.js";

/**
 * Running the checks an objective is measured against.
 *
 * Here, in the runner, because the API is not allowed to spawn a process and
 * because it has to be somewhere the owning agent is not. An agent that could
 * run its own exit criteria and report the result would be marking its own
 * homework with extra steps; the value of this whole path is that the exit code
 * is observed by something with no stake in the answer.
 */

const CHECK_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_KEPT = 2_000;

export type CommandRun = { exitCode: number | null; output: string; timedOut: boolean };

/** Runs one command and reports what happened, without ever throwing. */
export function runCheckCommand(
  command: string,
  cwd: string | undefined,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CommandRun> {
  return new Promise((resolve) => {
    // Through a shell on purpose: a check is written by a person as the command
    // they would type, pipes and all.
    const child = spawn(command, {
      shell: true,
      ...(cwd ? { cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (chunk: Buffer) => {
      // Only the tail is kept: a failing test suite prints megabytes, and the
      // part that says what failed is at the end.
      output = `${output}${chunk.toString()}`.slice(-OUTPUT_KEPT);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: error.message, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output: output.trim(), timedOut });
    });
  });
}

function describe(run: CommandRun): string {
  if (run.timedOut) return "timed out";
  if (run.exitCode === 0) return "passed";
  if (run.exitCode === null) return `could not run: ${run.output.split("\n")[0] ?? ""}`;
  const lastLine = run.output.split("\n").filter(Boolean).at(-1) ?? "";
  return `exit ${run.exitCode}${lastLine ? `: ${lastLine.slice(0, 200)}` : ""}`;
}

/**
 * Settles every objective whose owner has asked to finish.
 *
 * The refusal goes back as a comment on the objective's own tasks rather than
 * into a log, because the agent that asked is the one that has to act on it —
 * and "not finished, these three are still failing" is something it can work
 * with, where silence is not.
 */
export async function verifyObjectives(db: Database, log: Logger): Promise<void> {
  const repo = createObjectiveRepository(db);
  const tasks = createTaskRepository(db);
  const pending = await repo.awaitingVerification();

  for (const row of pending) {
    const results = await runChecksFor(row, log);
    const outcome = await repo.settleSatisfaction(row.organizationId, row.id, results);

    if (outcome.satisfied) {
      log.info({ objective: row.id }, "objective verified and finished");
      continue;
    }

    // Told, not just recorded. The owner asked to stop; it needs to know why it
    // is still going, in words it can act on.
    const [reportTask] = await tasks.list(row.organizationId, row.projectId, {
      limit: 1,
      objectiveId: row.id,
    });
    if (reportTask) {
      await tasks.comment(row.organizationId, reportTask.id, outcome.refusal, "system", {
        type: "system",
      });
    }
    log.warn({ objective: row.id }, "objective asked to finish but checks did not pass");
  }
}

async function runChecksFor(row: ObjectiveRow, log: Logger): Promise<ObjectiveCheckResult[]> {
  const checks = checksFor(row.checks);
  const results: ObjectiveCheckResult[] = [];

  for (const check of commandChecks(checks)) {
    const run = await runCheckCommand(check.command, row.workingDirectory ?? undefined);
    log.info(
      { objective: row.id, check: check.id, exitCode: run.exitCode },
      "ran an objective check",
    );
    results.push({
      id: check.id,
      passed: run.exitCode === 0,
      observed: describe(run),
      checkedAt: new Date().toISOString(),
    });
  }

  return results;
}

/**
 * Whether an objective about to be stopped by one of its brakes has in fact
 * finished.
 *
 * Running out of cycles and being done look identical from inside the loop, and
 * they are opposite outcomes. An objective whose checks all pass has succeeded
 * even if nobody got round to saying so, and recording that as "gave up" is
 * both wrong and the kind of wrong somebody acts on.
 */
export async function checksAlreadyPass(
  db: Database,
  row: ObjectiveRow,
  log: Logger,
): Promise<boolean> {
  const repo = createObjectiveRepository(db);
  const results = await runChecksFor(row, log);
  const outcome = await repo.settleSatisfaction(row.organizationId, row.id, results);
  return outcome.satisfied;
}
