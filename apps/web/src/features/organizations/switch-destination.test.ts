// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import { destinationAfterSwitch } from "./switch-destination.js";

describe("destinationAfterSwitch", () => {
  it("keeps you on the agents roster", () => {
    // The reported bug: switching from agents dumped you on the org page.
    expect(destinationAfterSwitch("/organizations/acme/agents", "beta")).toBe(
      "/organizations/beta/agents",
    );
  });

  it("drops an agent that does not exist in the organization you switched to", () => {
    expect(destinationAfterSwitch("/organizations/acme/agents/ada", "beta")).toBe(
      "/organizations/beta/agents",
    );
  });

  it("drops a nested tab as well as the record", () => {
    expect(destinationAfterSwitch("/organizations/acme/agents/ada/runs", "beta")).toBe(
      "/organizations/beta/agents",
    );
  });

  it("keeps a creation screen, which holds no resource", () => {
    expect(destinationAfterSwitch("/organizations/acme/agents/new", "beta")).toBe(
      "/organizations/beta/agents/new",
    );
  });

  it("moves to the other organization when you are on an organization page", () => {
    expect(destinationAfterSwitch("/organizations/acme", "beta")).toBe("/organizations/beta");
  });

  it("handles a trailing slash", () => {
    expect(destinationAfterSwitch("/organizations/acme/", "beta")).toBe("/organizations/beta");
  });

  it("lands on the organization when switching from anywhere else", () => {
    expect(destinationAfterSwitch("/organizations", "beta")).toBe("/organizations/beta");
    expect(destinationAfterSwitch("/", "beta")).toBe("/organizations/beta");
  });

  it("keeps you on Projects but drops the project you were looking at", () => {
    // A project slug means nothing in another tenant.
    expect(destinationAfterSwitch("/organizations/acme/projects", "beta")).toBe(
      "/organizations/beta/projects",
    );
    expect(destinationAfterSwitch("/organizations/acme/projects/atlas", "beta")).toBe(
      "/organizations/beta/projects",
    );
  });

  it("keeps you on Activity when you switch from Activity", () => {
    expect(destinationAfterSwitch("/organizations/acme/activity", "beta")).toBe(
      "/organizations/beta/activity",
    );
  });

  it("never carries the old organization into the destination", () => {
    for (const path of [
      "/organizations/acme",
      "/organizations/acme/agents",
      "/organizations/acme/agents/ada",
      "/organizations/acme/agents/new",
      "/organizations/acme/activity",
      "/organizations/acme/skills/writing",
    ]) {
      expect(destinationAfterSwitch(path, "beta")).not.toContain("acme");
    }
  });
});
