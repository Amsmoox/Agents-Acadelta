// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import {
  TEST_DATABASE_URL,
  databaseReachable,
  migrateTestDatabase,
  truncateAll,
} from "../../test/db.js";

const reachable = await databaseReachable();

/**
 * What archiving an organization actually means.
 *
 * It used to mean almost nothing: only the organization's own PATCH was
 * guarded, so an archived tenant still accepted new agents, edits to existing
 * ones, and `invoke` — which spends real money inside something somebody
 * deliberately put away.
 *
 * The rule these tests pin down: you can look at everything, and you can stop
 * things. You cannot start, change, or re-enable anything.
 */
describe.skipIf(!reachable)("an archived organization", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let org: string;

  beforeAll(async () => {
    await migrateTestDatabase();
    const ctx = await buildApp({
      NODE_ENV: "test",
      API_HOST: "127.0.0.1",
      API_PORT: 0,
      LOG_LEVEL: "fatal",
      DATABASE_URL: TEST_DATABASE_URL,
    });
    app = ctx.app;
    close = ctx.close;
    await app.ready();
  });

  afterAll(async () => close());

  beforeEach(async () => {
    await truncateAll();
    const created = await app.inject({
      method: "POST",
      url: "/organizations",
      payload: { name: "Acme" },
    });
    org = created.json().slug;

    await app.inject({
      method: "POST",
      url: `/organizations/${org}/agents`,
      payload: { name: "Ada", role: "engineer", adapterType: "claude_local", adapterConfig: {} },
    });
    await app.inject({
      method: "POST",
      url: `/organizations/${org}/skills`,
      payload: {
        name: "Probe",
        markdown: "---\nname: probe\ndescription: a probe skill\n---\n\nbody\n",
      },
    });
    await app.inject({ method: "POST", url: `/organizations/${org}/archive` });
  });

  const refused = [
    ["hire an agent", "POST", "/agents", { name: "Grace", role: "engineer", adapterType: "claude_local", adapterConfig: {} }],
    ["edit an agent", "PATCH", "/agents/ada", { title: "Staff engineer" }],
    ["resume an agent", "POST", "/agents/ada/resume", undefined],
    ["clear an agent's error", "POST", "/agents/ada/clear-error", undefined],
    ["approve an agent", "POST", "/agents/ada/approve", undefined],
    ["invoke an agent", "POST", "/agents/ada/invoke", { prompt: "do a thing" }],
    ["write a skill", "POST", "/skills", { name: "Two", markdown: "---\nname: two\ndescription: another\n---\n\nbody\n" }],
    ["rename a skill", "PATCH", "/skills/probe", { name: "Renamed" }],
    ["delete a skill", "DELETE", "/skills/probe", undefined],
    ["change which skills an agent has", "PUT", "/agents/ada/skills", { skillIds: [] }],
    ["edit an instruction file", "PUT", "/agents/ada/instructions", { path: "AGENTS.md", content: "# new" }],
  ] as const;

  for (const [what, method, path, payload] of refused) {
    it(`refuses to ${what}`, async () => {
      const response = await app.inject({
        method,
        url: `/organizations/${org}${path}`,
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("AGC-2003");
    });
  }

  const allowed = [
    ["list agents", "GET", "/agents"],
    ["read an agent", "GET", "/agents/ada"],
    ["read the org chart", "GET", "/agents/org-tree"],
    ["list skills", "GET", "/skills"],
    ["read an agent's instructions", "GET", "/agents/ada/instructions"],
    ["read the skill manifest", "GET", "/agents/ada/skills/manifest"],
    ["list runs", "GET", "/runs"],
  ] as const;

  for (const [what, method, path] of allowed) {
    it(`still lets you ${what}`, async () => {
      const response = await app.inject({ method, url: `/organizations/${org}${path}` });
      expect(response.statusCode).toBe(200);
    });
  }

  // Stopping things is always allowed. An archived organization you cannot
  // quiet down is worse than one you can.
  it("still lets you pause an agent", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/organizations/${org}/agents/ada/pause`,
      payload: { reason: "manual" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("still lets you terminate an agent", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/organizations/${org}/agents/ada/terminate`,
    });
    expect(response.statusCode).toBe(200);
  });

  it("accepts everything again once restored", async () => {
    await app.inject({ method: "POST", url: `/organizations/${org}/restore` });
    const response = await app.inject({
      method: "POST",
      url: `/organizations/${org}/agents/ada/invoke`,
      payload: { prompt: "do a thing" },
    });
    expect(response.statusCode).toBe(202);
  });
});
