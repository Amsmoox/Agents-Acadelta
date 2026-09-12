// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import { deriveTaskPrefix, setProjectMembersSchema, taskPrefixSchema } from "./projects.js";

describe("deriveTaskPrefix", () => {
  it("uses initials for a name with several words", () => {
    // How people abbreviate it out loud already.
    expect(deriveTaskPrefix("Checkout Rewrite")).toBe("CR");
    expect(deriveTaskPrefix("Project X")).toBe("PX");
  });

  it("uses the opening letters for a single word", () => {
    expect(deriveTaskPrefix("Atlas")).toBe("ATL");
    expect(deriveTaskPrefix("Go")).toBe("GO");
  });

  it("folds accents rather than dropping the letter", () => {
    expect(deriveTaskPrefix("Écoles Réunies")).toBe("ER");
  });

  it("ignores punctuation between words", () => {
    expect(deriveTaskPrefix("Billing / Invoicing")).toBe("BI");
    expect(deriveTaskPrefix("acme-web-app")).toBe("AWA");
  });

  it("never starts with a digit", () => {
    // A key opening with a number reads as a quantity, not a name.
    expect(deriveTaskPrefix("2024 Rebuild")).toBe("R");
    expect(deriveTaskPrefix("2024")).toBe("");
  });

  it("stays within the length the schema allows", () => {
    const prefix = deriveTaskPrefix("One Two Three Four Five Six Seven Eight");
    expect(prefix).toHaveLength(6);
    expect(taskPrefixSchema.safeParse(prefix).success).toBe(true);
  });

  it("returns nothing it would have to reject", () => {
    expect(deriveTaskPrefix("")).toBe("");
    expect(deriveTaskPrefix("   ")).toBe("");
  });
});

describe("taskPrefixSchema", () => {
  it("uppercases what it is given", () => {
    expect(taskPrefixSchema.parse("cr")).toBe("CR");
    expect(taskPrefixSchema.parse("  cr  ")).toBe("CR");
  });

  it("refuses a prefix that does not start with a letter", () => {
    expect(taskPrefixSchema.safeParse("1A").success).toBe(false);
    expect(taskPrefixSchema.safeParse("-A").success).toBe(false);
  });

  it("refuses anything but letters and digits", () => {
    expect(taskPrefixSchema.safeParse("A-B").success).toBe(false);
    expect(taskPrefixSchema.safeParse("A B").success).toBe(false);
  });

  it("allows digits after the first character", () => {
    expect(taskPrefixSchema.parse("X2")).toBe("X2");
  });
});

describe("setProjectMembersSchema", () => {
  it("refuses the same agent twice", () => {
    const id = "01a09999-0000-7000-8000-000000000000";
    const result = setProjectMembersSchema.safeParse({
      members: [{ agentId: id }, { agentId: id }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses two leads", () => {
    // The database refuses it too; catching it here names the problem instead
    // of returning a constraint violation.
    const result = setProjectMembersSchema.safeParse({
      members: [
        { agentId: "01a09999-0000-7000-8000-000000000001", role: "lead" },
        { agentId: "01a09999-0000-7000-8000-000000000002", role: "lead" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("defaults a member with no role", () => {
    const result = setProjectMembersSchema.parse({
      members: [{ agentId: "01a09999-0000-7000-8000-000000000001" }],
    });
    expect(result.members[0]?.role).toBe("member");
  });

  it("accepts an empty team", () => {
    expect(setProjectMembersSchema.parse({ members: [] }).members).toEqual([]);
  });
});
