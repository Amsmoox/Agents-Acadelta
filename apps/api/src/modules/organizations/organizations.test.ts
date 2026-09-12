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

describe.skipIf(!reachable)("organizations API", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;

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

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/organizations", payload });

  describe("create", () => {
    it("derives a slug from the name", async () => {
      const res = await create({ name: "Acme Schools" });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.slug).toBe("acme-schools");
      expect(body.status).toBe("active");
      expect(body.mission).toBeNull();
      expect(body.archivedAt).toBeNull();
      // UUIDv7 is time-ordered, so the version nibble must be 7.
      expect(body.id[14]).toBe("7");
    });

    it("accepts an explicit slug", async () => {
      const res = await create({ name: "Acme Schools", slug: "acme" });
      expect(res.json().slug).toBe("acme");
    });

    it("suffixes a derived slug rather than colliding", async () => {
      await create({ name: "Acme" });
      const second = await create({ name: "Acme" });
      expect(second.statusCode).toBe(201);
      expect(second.json().slug).toBe("acme-2");
    });

    it("refuses an explicit slug that is taken, instead of silently renaming it", async () => {
      await create({ name: "Acme" });
      const res = await create({ name: "Something else", slug: "acme" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2002");
    });

    it("treats slugs case-insensitively", async () => {
      await create({ name: "Acme", slug: "acme" });
      const res = await create({ name: "Acme two", slug: "acme" });
      expect(res.statusCode).toBe(409);
    });

    it("reports validation failures as AGC-1001 with issues", async () => {
      const res = await create({ name: "" });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("AGC-1001");
      expect(body.error.detail.issues.length).toBeGreaterThan(0);
    });

    it("refuses a name with no usable slug characters", async () => {
      const res = await create({ name: "！！！" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2004");
    });

    it("gives every concurrent create of the same name a distinct slug", async () => {
      // The real point of the partial unique index: check-then-insert would
      // hand two of these the same slug.
      const results = await Promise.all(
        Array.from({ length: 5 }, () => create({ name: "Race" })),
      );
      const slugs = results.filter((r) => r.statusCode === 201).map((r) => r.json().slug);
      expect(slugs.length).toBe(5);
      expect(new Set(slugs).size).toBe(5);
    });
  });

  describe("read", () => {
    it("resolves by id and by slug", async () => {
      const created = (await create({ name: "Acme" })).json();
      const byId = await app.inject({ method: "GET", url: `/organizations/${created.id}` });
      const bySlug = await app.inject({ method: "GET", url: `/organizations/${created.slug}` });
      expect(byId.json().id).toBe(created.id);
      expect(bySlug.json().id).toBe(created.id);
    });

    it("returns AGC-2001 for an unknown reference", async () => {
      const res = await app.inject({ method: "GET", url: "/organizations/nope" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("AGC-2001");
    });
  });

  describe("list", () => {
    it("pages with a cursor without repeating or skipping rows", async () => {
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        await create({ name });
      }
      const first = await app.inject({ method: "GET", url: "/organizations?limit=2" });
      const firstBody = first.json();
      expect(firstBody.data).toHaveLength(2);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await app.inject({
        method: "GET",
        url: `/organizations?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      });
      const secondBody = second.json();
      expect(secondBody.data).toHaveLength(2);

      const ids = [...firstBody.data, ...secondBody.data].map((o: { id: string }) => o.id);
      expect(new Set(ids).size).toBe(4);
    });

    it("returns a null cursor on the last page", async () => {
      await create({ name: "Only" });
      const res = await app.inject({ method: "GET", url: "/organizations?limit=10" });
      expect(res.json().nextCursor).toBeNull();
    });

    it("filters by status", async () => {
      const a = (await create({ name: "Kept" })).json();
      const b = (await create({ name: "Gone" })).json();
      await app.inject({ method: "POST", url: `/organizations/${b.slug}/archive` });

      const active = await app.inject({ method: "GET", url: "/organizations?status=active" });
      expect(active.json().data.map((o: { id: string }) => o.id)).toEqual([a.id]);

      const archived = await app.inject({ method: "GET", url: "/organizations?status=archived" });
      expect(archived.json().data.map((o: { id: string }) => o.id)).toEqual([b.id]);
    });

    it("rejects a malformed cursor", async () => {
      const res = await app.inject({ method: "GET", url: "/organizations?cursor=not-a-cursor" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("AGC-1001");
    });
  });

  describe("update", () => {
    it("changes the name but never the slug", async () => {
      const created = (await create({ name: "Acme" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${created.slug}`,
        payload: { name: "Acme Group" },
      });
      expect(res.json().name).toBe("Acme Group");
      expect(res.json().slug).toBe("acme");
    });

    it("clears the mission with null", async () => {
      const created = (await create({ name: "Acme", mission: "Ship it" })).json();
      expect(created.mission).toBe("Ship it");
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${created.id}`,
        payload: { mission: null },
      });
      expect(res.json().mission).toBeNull();
    });

    it("refuses an empty patch", async () => {
      const created = (await create({ name: "Acme" })).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${created.id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("refuses to edit an archived organization", async () => {
      const created = (await create({ name: "Acme" })).json();
      await app.inject({ method: "POST", url: `/organizations/${created.id}/archive` });
      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${created.id}`,
        payload: { name: "Nope" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("AGC-2003");
    });
  });

  describe("archive and restore", () => {
    it("archives, stamps archivedAt, then restores", async () => {
      const created = (await create({ name: "Acme" })).json();

      const archived = await app.inject({
        method: "POST",
        url: `/organizations/${created.id}/archive`,
      });
      expect(archived.json().status).toBe("archived");
      expect(archived.json().archivedAt).not.toBeNull();

      const restored = await app.inject({
        method: "POST",
        url: `/organizations/${created.id}/restore`,
      });
      expect(restored.json().status).toBe("active");
      expect(restored.json().archivedAt).toBeNull();
    });

    it("is idempotent", async () => {
      const created = (await create({ name: "Acme" })).json();
      const url = `/organizations/${created.id}/archive`;
      await app.inject({ method: "POST", url });
      const again = await app.inject({ method: "POST", url });
      expect(again.statusCode).toBe(200);
      expect(again.json().status).toBe("archived");
    });

    it("never destroys the row", async () => {
      const created = (await create({ name: "Acme" })).json();
      await app.inject({ method: "POST", url: `/organizations/${created.id}/archive` });
      const res = await app.inject({ method: "GET", url: `/organizations/${created.id}` });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("malformed requests", () => {
    // Each of these used to fall through to a 500, telling the caller nothing.
    it("answers 400 for a body that is not valid JSON", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: { "content-type": "application/json" },
        payload: '{"name":',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("AGC-1004");
    });

    it("answers 413 for a body over the size limit", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/organizations",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "a".repeat(2_000_000) }),
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("AGC-1005");
    });

    it("never answers a client mistake with a 500", async () => {
      for (const payload of ["{", "[]invalid", ""]) {
        const res = await app.inject({
          method: "POST",
          url: "/organizations",
          headers: { "content-type": "application/json" },
          payload,
        });
        expect(res.statusCode).toBeLessThan(500);
      }
    });
  });

  describe("pagination across more than one page", () => {
    it("walks every row via the cursor without gaps or repeats", async () => {
      // The list UI depends on this: it follows nextCursor until it is null.
      const total = 105;
      for (let i = 0; i < total; i += 1) {
        await create({ name: `Org ${String(i).padStart(3, "0")}` });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = await app.inject({ method: "GET", url: `/organizations?limit=50${suffix}` });
        const body = response.json() as { data: { id: string }[]; nextCursor: string | null };
        seen.push(...body.data.map((o) => o.id));
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    });
  });

  describe("unknown routes", () => {
    it("answers in the same error shape", async () => {
      const res = await app.inject({ method: "GET", url: "/nope" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("AGC-1002");
    });
  });
});
