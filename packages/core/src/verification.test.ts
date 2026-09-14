// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import type { ObjectiveCheck, ObjectiveCheckResult } from "@agentco/shared";
import { DEFAULT_CHECK, awaitingAPerson, checksFor, commandChecks, weigh } from "./verification.js";

const passed = (id: string): ObjectiveCheckResult => ({
  id,
  passed: true,
  observed: "passed",
  checkedAt: "2026-01-01T00:00:00.000Z",
});
const failed = (id: string, observed: string): ObjectiveCheckResult => ({
  id,
  passed: false,
  observed,
  checkedAt: "2026-01-01T00:00:00.000Z",
});
const unchecked = (id: string): ObjectiveCheckResult => ({
  id,
  passed: false,
  observed: "",
  checkedAt: null,
});

const command: ObjectiveCheck = {
  id: "tests",
  statement: "The test suite passes",
  kind: "command",
  command: "pnpm test",
  required: true,
};

describe("what an objective is measured against", () => {
  it("always includes that nothing it opened is still open", () => {
    expect(checksFor([])).toEqual([DEFAULT_CHECK]);
    // Even when other checks were declared: stated conditions passing while
    // half the work is still open is not finished, whatever they said.
    expect(checksFor([command]).map((c) => c.id)).toEqual(["no-open-tasks", "tests"]);
  });

  it("does not add it twice when it was declared explicitly", () => {
    const declared = [{ ...DEFAULT_CHECK, statement: "Our own wording" }];
    expect(checksFor(declared)).toHaveLength(1);
  });

  it("picks out the checks something has to run", () => {
    expect(commandChecks(checksFor([command])).map((c) => c.command)).toEqual(["pnpm test"]);
    // A command check with no command is not runnable and must not be treated
    // as one, or it would sit unchecked for ever.
    expect(commandChecks([{ ...command, command: "  " }])).toHaveLength(0);
  });
});

describe("weighing the results", () => {
  it("finishes only when every required check passed", () => {
    const checks = checksFor([command]);
    const outcome = weigh(checks, [passed("no-open-tasks"), passed("tests")]);
    expect(outcome.satisfied).toBe(true);
    expect(outcome.refusal).toBe("");
  });

  it("refuses, and says what is outstanding", () => {
    const checks = checksFor([command]);
    const outcome = weigh(checks, [passed("no-open-tasks"), failed("tests", "exit 1: 3 failing")]);
    expect(outcome.satisfied).toBe(false);
    expect(outcome.refusal).toContain("The test suite passes");
    expect(outcome.refusal).toContain("3 failing");
  });

  it("treats a check that has not been run as not passed", () => {
    // The line that decides whether "we could not test it" quietly becomes
    // "it works". It has to fall on the side of not finishing.
    const checks = checksFor([command]);
    const outcome = weigh(checks, [passed("no-open-tasks"), unchecked("tests")]);
    expect(outcome.satisfied).toBe(false);
    expect(outcome.refusal).toContain("not checked yet");
  });

  it("treats a missing result as not passed", () => {
    const outcome = weigh(checksFor([command]), [passed("no-open-tasks")]);
    expect(outcome.satisfied).toBe(false);
  });

  it("ignores a check that was not required", () => {
    const optional: ObjectiveCheck = { ...command, required: false };
    const outcome = weigh(checksFor([optional]), [passed("no-open-tasks"), failed("tests", "x")]);
    expect(outcome.satisfied).toBe(true);
  });

  it("separates waiting for a person from failing", () => {
    // A nudge and an alarm are different things and should read differently.
    const human: ObjectiveCheck = {
      id: "looks-right",
      statement: "The checkout flow looks right",
      kind: "human",
      required: true,
    };
    const checks = checksFor([human]);
    expect(awaitingAPerson(checks, [passed("no-open-tasks")]).map((c) => c.id)).toEqual([
      "looks-right",
    ]);
    expect(awaitingAPerson(checks, [passed("no-open-tasks"), passed("looks-right")])).toHaveLength(0);
  });
});
