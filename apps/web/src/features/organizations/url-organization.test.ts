// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import { urlOrganizationMatches } from "./url-organization.js";

const acme = { id: "01a0-acme", slug: "acme" };

describe("urlOrganizationMatches", () => {
  it("matches by slug", () => {
    expect(urlOrganizationMatches(acme, "acme")).toBe(true);
  });

  it("matches by id, since either may appear in a URL", () => {
    expect(urlOrganizationMatches(acme, "01a0-acme")).toBe(true);
  });

  it("refuses a fallback organization under another organization's address", () => {
    // The provider fell back to acme because the URL named something gone.
    // Rendering acme's agents at /organizations/ghost-co/agents would be a lie.
    expect(urlOrganizationMatches(acme, "ghost-co")).toBe(false);
  });

  it("refuses when nothing resolved at all", () => {
    expect(urlOrganizationMatches(null, "acme")).toBe(false);
  });

  it("allows a page that names no organization", () => {
    expect(urlOrganizationMatches(acme, undefined)).toBe(true);
    expect(urlOrganizationMatches(null, undefined)).toBe(true);
  });
});
