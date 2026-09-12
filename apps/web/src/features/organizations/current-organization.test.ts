// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import type { Organization } from "@agentco/shared";
import { currentOrganizationInternals } from "./current-organization.js";

const { resolveCurrentId } = currentOrganizationInternals;

function org(id: string, status: Organization["status"] = "active"): Organization {
  return {
    id,
    slug: id,
    name: id,
    mission: null,
    status,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    archivedAt: null,
  };
}

function resolve(input: {
  selectedId?: string | null;
  storedId?: string | null;
  organizations: Organization[];
}) {
  const organizations = input.organizations;
  return resolveCurrentId({
    selectedId: input.selectedId ?? null,
    storedId: input.storedId ?? null,
    organizations,
    switchable: organizations.filter((o) => o.status !== "archived"),
  });
}

describe("resolveCurrentId", () => {
  it("has nothing to select when the account owns nothing", () => {
    expect(resolve({ organizations: [] })).toBeNull();
  });

  it("prefers an explicit selection over anything remembered", () => {
    const result = resolve({
      selectedId: "b",
      storedId: "a",
      organizations: [org("a"), org("b")],
    });
    expect(result).toBe("b");
  });

  it("honours an explicit selection of an archived organization", () => {
    // A URL may name an archived organization. Vetoing that against the
    // switchable list would have the two re-select against each other forever.
    const result = resolve({
      selectedId: "old",
      organizations: [org("a"), org("old", "archived")],
    });
    expect(result).toBe("old");
  });

  it("uses the remembered organization when it still resolves", () => {
    expect(resolve({ storedId: "b", organizations: [org("a"), org("b")] })).toBe("b");
  });

  it("ignores a remembered id that no longer resolves, without clearing anything", () => {
    expect(resolve({ storedId: "gone", organizations: [org("a"), org("b")] })).toBe("a");
  });

  it("does not boot into an archived organization from memory alone", () => {
    const result = resolve({
      storedId: "old",
      organizations: [org("a"), org("old", "archived")],
    });
    expect(result).toBe("a");
  });

  it("falls back to the first switchable organization", () => {
    expect(resolve({ organizations: [org("a"), org("b")] })).toBe("a");
  });

  it("still resolves when every organization is archived", () => {
    // Otherwise the switcher would show "Select organization" forever on an
    // account whose organizations are all archived but still reachable.
    expect(resolve({ organizations: [org("old", "archived")] })).toBe("old");
  });

  it("is stable: resolving its own result changes nothing", () => {
    const organizations = [org("a"), org("b")];
    const first = resolve({ storedId: "b", organizations });
    const second = resolve({ selectedId: first, storedId: "b", organizations });
    expect(second).toBe(first);
  });
});
