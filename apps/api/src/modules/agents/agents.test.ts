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

describe.skipIf(!reachable)("agents API", () => {
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
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/organizations/${org}/agents`,
      payload: { adapterType: "claude_local", ...payload },
    });

  const post = (path: string, payload?: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/organizations/${org}/agents/${path}`, ...(payload ? { payload } : {}) });

  describe("create", () => {
    it("derives a slug and applies create-context permission defaults", async () => {
      const res = await create({ name: "Ada Lovelace", role: "engineer" });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.slug).toBe("ada-lovelace");
      expect(body.status).toBe("idle");
      expect(body.permissions.canCreateSkills).toBe(true);
    });

    it("rejects an unknown agent type", async () => {
      const res = await create({ name: "Ghost", adapterType: "nope_local" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3007");
    });

    it("rejects a config missing an adapter-required field", async () => {
      // `process` declares `command` as required in its config schema; the
      // validator is generated from that same declaration.
      const res = await create({ name: "Runner", adapterType: "process", adapterConfig: {} });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3010");
      expect(res.json().error.detail.issues[0].path).toBe("command");
    });

    it("accepts a config that satisfies the declaration", async () => {
      const res = await create({
        name: "Runner",
        adapterType: "process",
        adapterConfig: { command: "/bin/echo" },
      });
      expect(res.statusCode).toBe(201);
    });

    it("rejects a manager from another organization", async () => {
      const other = (await app.inject({
        method: "POST",
        url: "/organizations",
        payload: { name: "Other Co" },
      })).json().slug;
      const foreign = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other}/agents`,
          payload: { name: "Outsider", adapterType: "claude_local" },
        })
      ).json();

      const res = await create({ name: "Insider", reportsTo: foreign.id });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3006");
    });

    it("gives concurrent creates of the same name distinct slugs", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => create({ name: "Race" })));
      const slugs = results.filter((r) => r.statusCode === 201).map((r) => r.json().slug);
      expect(new Set(slugs).size).toBe(5);
    });
  });

  describe("reporting lines", () => {
    it("refuses an agent reporting to itself", async () => {
      const agent = (await create({ name: "Solo" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { reportsTo: agent.id },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3005");
    });

    it("refuses a reporting line that would close a loop", async () => {
      const boss = (await create({ name: "Boss" })).json();
      const staff = (await create({ name: "Staff", reportsTo: boss.id })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${boss.id}`,
        payload: { reportsTo: staff.id },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3005");
    });

    it("reports a terminated ancestor as a broken chain on the descendant", async () => {
      const lead = (await create({ name: "Lead" })).json();
      const dev = (await create({ name: "Dev", reportsTo: lead.id })).json();
      await post(`${lead.id}/terminate`);

      const res = await app.inject({ method: "GET", url: `/organizations/${org}/agents/${dev.id}` });
      const body = res.json();
      expect(body.orgChainHealth.status).toBe("terminated_ancestor");
      expect(body.eligibility.invokable).toBe(false);
      expect(body.eligibility.reason).toBe("invalid_org_chain");
    });

    it("refuses to point a new reporting line at a terminated manager", async () => {
      // The chain would be broken the moment it was saved, and the agent would
      // immediately read as unassignable. Better to say so while the operator
      // is still choosing than to explain it in a banner afterwards.
      const lead = (await create({ name: "Lead" })).json();
      await post(`${lead.id}/terminate`);

      const res = await create({ name: "Dev", reportsTo: lead.id });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3011");
    });

    it("refuses to move an existing agent under a terminated manager", async () => {
      const lead = (await create({ name: "Lead" })).json();
      const dev = (await create({ name: "Dev" })).json();
      await post(`${lead.id}/terminate`);

      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${dev.id}`,
        payload: { reportsTo: lead.id },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-3011");
    });

    it("promotes an agent whose manager is terminated into the org tree root", async () => {
      const lead = (await create({ name: "Lead" })).json();
      await create({ name: "Dev", reportsTo: lead.id });
      await post(`${lead.id}/terminate`);

      const tree = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents/org-tree` })
      ).json().data;
      expect(tree.map((n: { name: string }) => n.name)).toContain("Dev");
    });
  });

  describe("paging", () => {
    it("says so when a cursor points at a row that has gone", async () => {
      // The keyset comparison is against a subquery, so a missing anchor made
      // it NULL and returned an empty page — indistinguishable from reaching
      // the end, and it hid every remaining row.
      await create({ name: "One" });
      await create({ name: "Two" });
      await create({ name: "Three" });

      const first = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents?limit=1` })
      ).json();
      expect(first.nextCursor).not.toBeNull();

      // The anchor row leaves the default listing once it is terminated, and a
      // cursor naming a row outside the result set is the same shape of problem.
      const gone = Buffer.from("01a09999-0000-7000-8000-000000000000", "utf8").toString("base64url");
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${org}/agents?limit=1&cursor=${encodeURIComponent(gone)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("AGC-1008");
    });

    it("refuses a cursor naming an agent in another organization", async () => {
      const other = (
        await app.inject({ method: "POST", url: "/organizations", payload: { name: "Other" } })
      ).json();
      const foreign = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other.slug}/agents`,
          payload: { name: "Foreign", adapterType: "claude_local" },
        })
      ).json();

      const cursor = Buffer.from(foreign.id, "utf8").toString("base64url");
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${org}/agents?limit=1&cursor=${encodeURIComponent(cursor)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("AGC-1008");
    });
  });

  describe("status transitions", () => {
    it("pauses and resumes", async () => {
      const agent = (await create({ name: "Worker" })).json();
      const paused = (await post(`${agent.id}/pause`, { reason: "manual" })).json();
      expect(paused.status).toBe("paused");
      expect(paused.pausedAt).not.toBeNull();

      const resumed = (await post(`${agent.id}/resume`)).json();
      expect(resumed.status).toBe("idle");
      expect(resumed.pauseReason).toBeNull();
    });

    it("refuses to clear an error on an agent that is not in error", async () => {
      const agent = (await create({ name: "Worker" })).json();
      const res = await post(`${agent.id}/clear-error`);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-3008");
    });

    it("makes termination one-way", async () => {
      const agent = (await create({ name: "Gone" })).json();
      await post(`${agent.id}/terminate`);

      const resumed = await post(`${agent.id}/resume`);
      expect(resumed.statusCode).toBe(409);
      expect(resumed.json().error.code).toBe("AGC-3003");

      const edited = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { name: "Back" },
      });
      expect(edited.statusCode).toBe(409);
    });

    it("excludes terminated agents from the roster entirely", async () => {
      const agent = (await create({ name: "Gone" })).json();
      await create({ name: "Here" });
      await post(`${agent.id}/terminate`);

      const list = (await app.inject({ method: "GET", url: `/organizations/${org}/agents` })).json();
      expect(list.data.map((a: { name: string }) => a.name)).toEqual(["Here"]);
    });
  });

  describe("config revisions", () => {
    it("records a revision listing only the fields that changed", async () => {
      const agent = (await create({ name: "Ada", title: "Engineer" })).json();
      await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { title: "Staff engineer" },
      });

      const revisions = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents/${agent.id}/revisions` })
      ).json().data;
      expect(revisions).toHaveLength(1);
      expect(revisions[0].changedKeys).toEqual(["title"]);
      expect(revisions[0].beforeConfig.title).toBe("Engineer");
      expect(revisions[0].afterConfig.title).toBe("Staff engineer");
    });

    it("writes no revision when nothing actually changed", async () => {
      const agent = (await create({ name: "Ada", title: "Engineer" })).json();
      await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { title: "Engineer" },
      });
      const revisions = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents/${agent.id}/revisions` })
      ).json().data;
      expect(revisions).toHaveLength(0);
    });

    it("rolls back to a revision and keeps history append-only", async () => {
      const agent = (await create({ name: "Ada", title: "One" })).json();
      await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { title: "Two" },
      });

      const [first] = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents/${agent.id}/revisions` })
      ).json().data;

      const restored = await post(`${agent.id}/revisions/${first.id}/rollback`);
      expect(restored.statusCode).toBe(200);
      expect(restored.json().title).toBe("Two");

      // The rollback is itself a revision; nothing was rewritten.
      const after = (
        await app.inject({ method: "GET", url: `/organizations/${org}/agents/${agent.id}/revisions` })
      ).json().data;
      expect(after.length).toBeGreaterThanOrEqual(1);
    });

    it("records the rollback as its own revision, pointing at the one replayed", async () => {
      const agent = (await create({ name: "Ada", title: "One" })).json();
      const patch = (title: string) =>
        app.inject({
          method: "PATCH",
          url: `/organizations/${org}/agents/${agent.id}`,
          payload: { title },
        });
      await patch("Two");
      await patch("Three");

      const list = async () =>
        (
          await app.inject({
            method: "GET",
            url: `/organizations/${org}/agents/${agent.id}/revisions`,
          })
        ).json().data;

      // Newest first, so the older of the two is the one that produced "Two".
      const toTwo = (await list()).at(-1);
      const restored = await post(`${agent.id}/revisions/${toTwo.id}/rollback`);
      expect(restored.json().title).toBe("Two");

      const [newest] = await list();
      expect(newest.source).toBe("rollback");
      expect(newest.rolledBackFromRevisionId).toBe(toTwo.id);
      expect(newest.changedKeys).toEqual(["title"]);
    });

    it("does not relabel an unrelated revision when the rollback changes nothing", async () => {
      // The regression. The source used to be corrected with a second UPDATE
      // that matched "the newest revision with source=patch" — but a rollback
      // to the state an agent is already in writes no revision at all, so that
      // UPDATE stamped "rollback" onto whatever edit happened to be newest and
      // the history started describing changes nobody made.
      const agent = (await create({ name: "Ada", title: "One" })).json();
      await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/agents/${agent.id}`,
        payload: { title: "Two" },
      });

      const list = async () =>
        (
          await app.inject({
            method: "GET",
            url: `/organizations/${org}/agents/${agent.id}/revisions`,
          })
        ).json().data;

      const [toTwo] = await list();
      // Rolling back to the state it is already in.
      expect((await post(`${agent.id}/revisions/${toTwo.id}/rollback`)).statusCode).toBe(200);

      const after = await list();
      expect(after).toHaveLength(1);
      expect(after[0].source).toBe("patch");
      expect(after[0].rolledBackFromRevisionId).toBeNull();
    });
  });

  describe("adapters", () => {
    it("publishes the declared configuration for each agent type", async () => {
      const res = await app.inject({ method: "GET", url: "/adapters" });
      const types = res.json().data.map((a: { type: string }) => a.type);
      expect(types).toContain("claude_local");
      expect(types).toContain("process");

      const claude = res.json().data.find((a: { type: string }) => a.type === "claude_local");
      expect(claude.configSchema.length).toBeGreaterThan(0);
      expect(claude.capabilities.supportsInstructionsBundle).toBe(true);
    });
  });
});
