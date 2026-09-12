// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";

/**
 * The brakes, as arithmetic.
 *
 * `endCycle` is where a standing order decides whether to carry on, and the
 * decision is three comparisons. They are worth pinning down separately from
 * the database, because getting one of them backwards is the difference
 * between an order that stops and one that does not.
 */
function shouldEnd(row: {
  cycleCount: number;
  maxCycles: number;
  budgetCents: number;
  spentCents: number;
  idleCycles: number;
  maxIdleCycles: number;
}): "cycles" | "budget" | "idle" | null {
  if (row.cycleCount >= row.maxCycles) return "cycles";
  if (row.budgetCents > 0 && row.spentCents >= row.budgetCents) return "budget";
  if (row.idleCycles >= row.maxIdleCycles) return "idle";
  return null;
}

const base = {
  cycleCount: 0,
  maxCycles: 10,
  budgetCents: 0,
  spentCents: 0,
  idleCycles: 0,
  maxIdleCycles: 2,
};

describe("when a standing objective stops", () => {
  it("carries on while there is room in every budget", () => {
    expect(shouldEnd({ ...base, cycleCount: 3, spentCents: 500 })).toBeNull();
  });

  it("stops at the cycle limit", () => {
    expect(shouldEnd({ ...base, cycleCount: 10 })).toBe("cycles");
  });

  it("treats a zero budget as no limit", () => {
    // Same rule as an agent's monthly budget: zero means unlimited, so an
    // objective created without one is not instantly out of money.
    expect(shouldEnd({ ...base, budgetCents: 0, spentCents: 99_999 })).toBeNull();
  });

  it("stops when the money runs out", () => {
    expect(shouldEnd({ ...base, budgetCents: 1000, spentCents: 1000 })).toBe("budget");
  });

  it("stops after enough cycles that achieved nothing", () => {
    // An agent that wakes, finds nothing and files nothing is not making
    // progress, but it is still spending. This is the brake that separates
    // "keep going until it's clean" from an open-ended bill.
    expect(shouldEnd({ ...base, idleCycles: 2 })).toBe("idle");
  });

  it("checks the cycle limit before anything else", () => {
    // All three could be true at once; the cycle count is the one a person set
    // most deliberately, so it is the reason they are told.
    expect(shouldEnd({ ...base, cycleCount: 10, spentCents: 999, budgetCents: 1, idleCycles: 9 })).toBe(
      "cycles",
    );
  });
});
