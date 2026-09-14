// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { ObjectiveCheck, ObjectiveCheckResult } from "@agentco/shared";

/**
 * Deciding whether an objective is actually finished.
 *
 * The rule this file exists to enforce: an agent saying its work is complete is
 * a claim, and a claim never becomes proof by being confident. So nothing here
 * reads anything the owning agent wrote. A check either counts rows the system
 * owns, or runs a command and reads its exit code, or waits for a person.
 *
 * The counting and the command-running happen elsewhere — the API cannot spawn
 * a process and the runner should not own policy — so both arrive here as
 * results, and this decides what they mean.
 */

export type CheckOutcome = {
  results: ObjectiveCheckResult[];
  satisfied: boolean;
  /** Why not, in a sentence the agent can act on. Empty when satisfied. */
  refusal: string;
};

/** The check every objective gets, so none of them is unfinishable. */
export const DEFAULT_CHECK: ObjectiveCheck = {
  id: "no-open-tasks",
  statement: "Work was done under this objective, and none of it is still open.",
  kind: "no_open_tasks",
  required: true,
};

export function checksFor(raw: unknown): ObjectiveCheck[] {
  const declared = Array.isArray(raw) ? (raw as ObjectiveCheck[]) : [];
  if (declared.length === 0) return [DEFAULT_CHECK];
  // Always present, even when other checks are declared: an objective whose
  // stated conditions pass while half its work is still open has not finished,
  // whatever the conditions said.
  return declared.some((check) => check.kind === "no_open_tasks")
    ? declared
    : [DEFAULT_CHECK, ...declared];
}

/**
 * Weighs the results.
 *
 * A check that has not been run is not a pass. This is the line that decides
 * whether "we could not test it" quietly becomes "it works", and it has to fall
 * on the side of not finishing.
 */
export function weigh(checks: ObjectiveCheck[], results: ObjectiveCheckResult[]): CheckOutcome {
  const byId = new Map(results.map((result) => [result.id, result]));
  const failures: string[] = [];

  for (const check of checks) {
    if (!check.required) continue;
    const result = byId.get(check.id);

    if (!result || result.checkedAt === null) {
      failures.push(`${check.statement} — not checked yet.`);
      continue;
    }
    if (!result.passed) {
      failures.push(`${check.statement} — ${result.observed || "failed"}.`);
    }
  }

  return {
    results,
    satisfied: failures.length === 0,
    refusal:
      failures.length === 0
        ? ""
        : `Not finished yet. ${failures.length === 1 ? "This is" : "These are"} outstanding:\n- ${failures.join("\n- ")}`,
  };
}

/**
 * A human check cannot be settled by anything automatic, so it is listed
 * separately: the difference between "waiting for a person" and "failing" is
 * the difference between a nudge and an alarm.
 */
export function awaitingAPerson(
  checks: ObjectiveCheck[],
  results: ObjectiveCheckResult[],
): ObjectiveCheck[] {
  const byId = new Map(results.map((result) => [result.id, result]));
  return checks.filter(
    (check) => check.kind === "human" && (byId.get(check.id)?.checkedAt ?? null) === null,
  );
}

/** Commands, in declaration order, that something able to spawn should run. */
export function commandChecks(checks: ObjectiveCheck[]): (ObjectiveCheck & { command: string })[] {
  return checks.filter(
    (check): check is ObjectiveCheck & { command: string } =>
      check.kind === "command" && typeof check.command === "string" && check.command.trim() !== "",
  );
}
