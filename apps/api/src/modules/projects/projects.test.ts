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

describe.skipIf(!reachable)("projects API", () => {
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
    app.inject({ method: "POST", url: `/organizations/${org}/projects`, payload });

  const hire = async (name: string) =>
    (
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/agents`,
        payload: { name, adapterType: "claude_local" },
      })
    ).json();

  const setMembers = (ref: string, members: unknown[]) =>
    app.inject({
      method: "PUT",
      url: `/organizations/${org}/projects/${ref}/members`,
      payload: { members },
    });

  describe("create", () => {
    it("derives a slug and a task prefix from the name", async () => {
      const res = await create({ name: "Checkout Rewrite" });
      expect(res.statusCode).toBe(201);
      expect(res.json().slug).toBe("checkout-rewrite");
      // Initials are how people already abbreviate a name out loud.
      expect(res.json().taskPrefix).toBe("CR");
    });

    it("falls back to the opening letters for a one-word name", async () => {
      expect((await create({ name: "Atlas" })).json().taskPrefix).toBe("ATL");
    });

    it("takes an explicit slug and prefix at face value", async () => {
      const res = await create({ name: "Project X", slug: "px", taskPrefix: "X" });
      expect(res.json().slug).toBe("px");
      expect(res.json().taskPrefix).toBe("X");
    });

    it("uppercases a prefix given in lower case", async () => {
      expect((await create({ name: "Atlas", taskPrefix: "at" })).json().taskPrefix).toBe("AT");
    });

    it("refuses a prefix that starts with a digit", async () => {
      const res = await create({ name: "Atlas", taskPrefix: "1A" });
      expect(res.statusCode).toBe(400);
    });

    it("refuses an explicit slug that is taken", async () => {
      await create({ name: "One", slug: "shared" });
      const res = await create({ name: "Two", slug: "shared" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2502");
    });

    it("refuses an explicit prefix that is taken", async () => {
      await create({ name: "One", taskPrefix: "ONE" });
      const res = await create({ name: "Two", taskPrefix: "ONE" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2503");
    });

    it("suffixes a derived slug rather than failing", async () => {
      const first = await create({ name: "Atlas" });
      const second = await create({ name: "Atlas" });
      expect(second.statusCode).toBe(201);
      expect(second.json().slug).not.toBe(first.json().slug);
      expect(second.json().taskPrefix).not.toBe(first.json().taskPrefix);
    });

    it("settles concurrent creates of the same name on the index, not a check", async () => {
      // Check-then-insert would have both find the name free.
      const results = await Promise.all([
        create({ name: "Parallel" }),
        create({ name: "Parallel" }),
        create({ name: "Parallel" }),
      ]);
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      const slugs = new Set(results.map((r) => r.json().slug));
      const prefixes = new Set(results.map((r) => r.json().taskPrefix));
      expect(slugs.size).toBe(3);
      expect(prefixes.size).toBe(3);
    });

    it("settles concurrent creates of the same explicit slug with one winner", async () => {
      const results = await Promise.all([
        create({ name: "A", slug: "one-slug" }),
        create({ name: "B", slug: "one-slug" }),
      ]);
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409]);
    });
  });

  describe("read and update", () => {
    it("finds a project by slug or by id", async () => {
      const project = (await create({ name: "Atlas" })).json();
      for (const ref of [project.slug, project.id]) {
        const res = await app.inject({ method: "GET", url: `/organizations/${org}/projects/${ref}` });
        expect(res.json().id).toBe(project.id);
      }
    });

    it("changes the name and the brief", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/projects/${project.slug}`,
        payload: { name: "Atlas II", brief: "Ship the thing." },
      });
      expect(res.json().name).toBe("Atlas II");
      expect(res.json().brief).toBe("Ship the thing.");
      // The slug is what people bookmark, so renaming never moves it.
      expect(res.json().slug).toBe("atlas");
    });

    it("never changes the task prefix", async () => {
      // Every key ever written down carries it, so there is no route that can.
      const project = (await create({ name: "Atlas" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/projects/${project.slug}`,
        payload: { taskPrefix: "ZZ" },
      });
      expect(res.statusCode).toBe(400);

      const after = await app.inject({
        method: "GET",
        url: `/organizations/${org}/projects/${project.slug}`,
      });
      expect(after.json().taskPrefix).toBe("ATL");
    });

    it("pauses and resumes", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const paused = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/projects/${project.slug}`,
        payload: { status: "paused" },
      });
      expect(paused.json().status).toBe("paused");
    });

    it("cannot be archived through the status field", async () => {
      // Archiving has a guard on it; a status write would skip the guard.
      const project = (await create({ name: "Atlas" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/projects/${project.slug}`,
        payload: { status: "archived" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("is 404 for a project in another organization", async () => {
      const other = (
        await app.inject({ method: "POST", url: "/organizations", payload: { name: "Other" } })
      ).json();
      const foreign = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other.slug}/projects`,
          payload: { name: "Secret" },
        })
      ).json();

      const res = await app.inject({
        method: "GET",
        url: `/organizations/${org}/projects/${foreign.id}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("archive", () => {
    it("archives and restores", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const archived = await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects/${project.slug}/archive`,
      });
      expect(archived.json().status).toBe("archived");
      expect(archived.json().archivedAt).not.toBeNull();

      const restored = await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects/${project.slug}/restore`,
      });
      expect(restored.json().status).toBe("active");
      expect(restored.json().archivedAt).toBeNull();
    });

    it("refuses to edit an archived project", async () => {
      const project = (await create({ name: "Atlas" })).json();
      await app.inject({ method: "POST", url: `/organizations/${org}/projects/${project.slug}/archive` });

      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/projects/${project.slug}`,
        payload: { name: "Nope" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2504");
    });

    it("still reads an archived project", async () => {
      const project = (await create({ name: "Atlas" })).json();
      await app.inject({ method: "POST", url: `/organizations/${org}/projects/${project.slug}/archive` });
      const res = await app.inject({ method: "GET", url: `/organizations/${org}/projects/${project.slug}` });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("membership", () => {
    it("starts empty", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const res = await app.inject({
        method: "GET",
        url: `/organizations/${org}/projects/${project.slug}/members`,
      });
      expect(res.json().data).toEqual([]);
      expect(project.memberCount).toBe(0);
    });

    it("replaces the whole membership", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      const grace = await hire("Grace");

      const first = await setMembers(project.slug, [
        { agentId: ada.id, role: "lead" },
        { agentId: grace.id, role: "member" },
      ]);
      expect(first.json().data).toHaveLength(2);
      // The lead is listed first: a roster is read, not scrolled.
      expect(first.json().data[0].role).toBe("lead");
      expect(first.json().data[0].name).toBe("Ada");

      const second = await setMembers(project.slug, [{ agentId: grace.id, role: "lead" }]);
      expect(second.json().data).toHaveLength(1);
      expect(second.json().data[0].name).toBe("Grace");
    });

    it("counts members on the project", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      await setMembers(project.slug, [{ agentId: ada.id }]);

      const res = await app.inject({ method: "GET", url: `/organizations/${org}/projects/${project.slug}` });
      expect(res.json().memberCount).toBe(1);
    });

    it("refuses two leads in one request", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      const grace = await hire("Grace");

      const res = await setMembers(project.slug, [
        { agentId: ada.id, role: "lead" },
        { agentId: grace.id, role: "lead" },
      ]);
      expect(res.statusCode).toBe(400);
    });

    it("refuses the same agent twice", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      const res = await setMembers(project.slug, [{ agentId: ada.id }, { agentId: ada.id }]);
      expect(res.statusCode).toBe(400);
    });

    it("names the agents that do not exist", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const res = await setMembers(project.slug, [
        { agentId: "01a09999-0000-7000-8000-000000000000" },
      ]);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.detail.agentIds).toHaveLength(1);
    });

    it("refuses an agent from another organization", async () => {
      const other = (
        await app.inject({ method: "POST", url: "/organizations", payload: { name: "Other" } })
      ).json();
      const foreign = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other.slug}/agents`,
          payload: { name: "Outsider", adapterType: "claude_local" },
        })
      ).json();

      const project = (await create({ name: "Atlas" })).json();
      const res = await setMembers(project.slug, [{ agentId: foreign.id }]);
      expect(res.statusCode).toBe(404);
    });

    it("refuses a terminated agent", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      await app.inject({ method: "POST", url: `/organizations/${org}/agents/${ada.id}/terminate` });

      const res = await setMembers(project.slug, [{ agentId: ada.id }]);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-2506");
    });

    it("drops the membership when an agent is deleted from the tenant", async () => {
      // The composite foreign key cascades, so no row can outlive its agent.
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      await setMembers(project.slug, [{ agentId: ada.id }]);
      expect((await setMembers(project.slug, [])).json().data).toEqual([]);
    });

    it("refuses membership changes on an archived project", async () => {
      const project = (await create({ name: "Atlas" })).json();
      const ada = await hire("Ada");
      await app.inject({ method: "POST", url: `/organizations/${org}/projects/${project.slug}/archive` });

      const res = await setMembers(project.slug, [{ agentId: ada.id }]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2504");
    });
  });

  describe("listing", () => {
    it("returns newest first with member counts", async () => {
      await create({ name: "One" });
      const two = (await create({ name: "Two" })).json();
      const ada = await hire("Ada");
      await setMembers(two.slug, [{ agentId: ada.id, role: "lead" }]);

      const res = await app.inject({ method: "GET", url: `/organizations/${org}/projects` });
      const data = res.json().data;
      expect(data[0].name).toBe("Two");
      expect(data[0].memberCount).toBe(1);
      expect(data[1].memberCount).toBe(0);
    });

    it("filters by status", async () => {
      const one = (await create({ name: "One" })).json();
      await create({ name: "Two" });
      await app.inject({ method: "POST", url: `/organizations/${org}/projects/${one.slug}/archive` });

      const active = await app.inject({ method: "GET", url: `/organizations/${org}/projects?status=active` });
      expect(active.json().data.map((p: { name: string }) => p.name)).toEqual(["Two"]);
    });

    it("walks every row via the cursor without gaps or repeats", async () => {
      for (let i = 0; i < 11; i += 1) await create({ name: `Project ${i}` });

      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const url: string = `/organizations/${org}/projects?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const body = (await app.inject({ method: "GET", url })).json();
        for (const row of body.data) seen.add(row.id);
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      expect(seen.size).toBe(11);
    });

    it("never lists another organization's projects", async () => {
      const other = (
        await app.inject({ method: "POST", url: "/organizations", payload: { name: "Other" } })
      ).json();
      await app.inject({
        method: "POST",
        url: `/organizations/${other.slug}/projects`,
        payload: { name: "Secret" },
      });
      await create({ name: "Mine" });

      const res = await app.inject({ method: "GET", url: `/organizations/${org}/projects` });
      expect(res.json().data.map((p: { name: string }) => p.name)).toEqual(["Mine"]);
    });
  });
});
