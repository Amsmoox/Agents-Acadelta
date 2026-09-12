// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import {
  createOrganizationSchema,
  organizationSlugSchema,
  slugify,
  updateOrganizationSchema,
} from "./organizations.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Schools")).toBe("acme-schools");
  });

  it("folds accents instead of dropping the characters", () => {
    // "Écoles Réunies" and "Ecoles Reunies" must not produce different slugs.
    expect(slugify("Écoles Réunies")).toBe("ecoles-reunies");
    expect(slugify("Écoles Réunies")).toBe(slugify("Ecoles Reunies"));
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugify("  ***Hello -- World!!  ")).toBe("hello-world");
  });

  it("never ends in a hyphen, even when truncating at the limit", () => {
    const slug = slugify(`${"a".repeat(62)} tail`);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty when there is nothing usable", () => {
    expect(slugify("！！！")).toBe("");
  });
});

describe("organizationSlugSchema", () => {
  it.each(["ab", "acme", "acme-schools", "a1-b2-c3"])("accepts %s", (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each([
    ["a", "too short"],
    ["-acme", "leading hyphen"],
    ["acme-", "trailing hyphen"],
    ["acme--schools", "double hyphen"],
    ["Acme", "uppercase"],
    ["acme schools", "space"],
    ["new", "reserved"],
    ["admin", "reserved"],
  ])("rejects %s (%s)", (slug) => {
    expect(organizationSlugSchema.safeParse(slug).success).toBe(false);
  });
});

describe("createOrganizationSchema", () => {
  it("requires a name", () => {
    expect(createOrganizationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a whitespace-only name", () => {
    expect(createOrganizationSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("trims the name", () => {
    const parsed = createOrganizationSchema.parse({ name: "  Acme  " });
    expect(parsed.name).toBe("Acme");
  });

  it("accepts a name on its own", () => {
    expect(createOrganizationSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });
});

describe("updateOrganizationSchema", () => {
  it("refuses an empty patch", () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing the mission with null", () => {
    expect(updateOrganizationSchema.safeParse({ mission: null }).success).toBe(true);
  });

  it("does not accept a slug — renaming is a separate operation", () => {
    const parsed = updateOrganizationSchema.parse({ name: "New", slug: "new-slug" } as never);
    expect(parsed).not.toHaveProperty("slug");
  });
});
