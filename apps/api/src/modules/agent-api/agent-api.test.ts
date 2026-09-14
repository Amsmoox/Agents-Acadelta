// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { agentRuns, agents as agentsTable, createDatabase, type Database } from "@agentco/db";
import { createCredentialRepository, createTaskRepository } from "@agentco/core";
import { buildApp } from "../../app.js";
import {
  TEST_DATABASE_URL,
  databaseReachable,
  migrateTestDatabase,
  truncateAll,
} from "../../test/db.js";

const reachable = await databaseReachable();

/** What a command prints. Every one returns a different shape, so it is
 *  narrowed where it is read rather than described here. */
type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value ?? {}) as Json;
const str = (value: unknown): string => String(value ?? "");

/**
 * The surface a running agent acts through, exercised the way one does: as a
 * command line arriving at /agent/exec with a run credential.
 *
 * This is the scenario end to end. A manager files work for QA, QA files work
 * for a developer, the developer sends it for review, and QA sends it back with
 * a reason before accepting it — all of it through the same door a real harness
 * would use, with the same rails in the way.
 */
describe.skipIf(!reachable)("the agent tool surface", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let db: Database;
  let closeDb: () => Promise<void>;
  let org: string;
  let orgId: string;
  let projectId: string;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

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
    const connection = createDatabase(TEST_DATABASE_URL, 5);
    db = connection.db;
    closeDb = connection.close;
  });

  afterAll(async () => {
    await close();
    await closeDb();
  });

  /** Stands in for the runner: leases a run for an agent and mints its token. */
  async function startRun(name: string, taskId: string | null): Promise<string> {
    const credentials = createCredentialRepository(db);

    // An agent has at most one live run — the partial unique index says so — so
    // the previous one ends before the next begins, exactly as the runner does.
    await db
      .update(agentRuns)
      .set({ status: "completed", endedAt: new Date() })
      .where(and(eq(agentRuns.agentId, ids[name]!), inArray(agentRuns.status, ["leased", "running"])));

    const [run] = await db
      .insert(agentRuns)
      .values({
        organizationId: orgId,
        agentId: ids[name]!,
        status: "running",
        leasedBy: "test",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        prompt: "work",
      })
      .returning();

    const token = await credentials.mint({
      runId: run!.id,
      organizationId: orgId,
      agentId: ids[name]!,
      responsibleUserId: "owner",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await credentials.setContext(run!.id, { taskId, projectId });
    tokens[name] = token;
    return token;
  }

  /** What the shim does: carry argv and a credential, print what comes back. */
  async function shell(name: string, argv: string[]) {
    const response = await app.inject({
      method: "POST",
      url: "/agent/exec",
      headers: { authorization: `Bearer ${tokens[name]}` },
      payload: { argv },
    });
    return { status: response.statusCode, body: obj(response.json()) };
  }

  beforeEach(async () => {
    await truncateAll();
    const organization = (
      await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } })
    ).json();
    org = organization.slug;
    orgId = organization.id;

    for (const name of ["Nadia", "Priya", "Sam"]) {
      const agent = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/agents`,
          payload: { name, adapterType: "claude_local" },
        })
      ).json();
      ids[name] = agent.id;
    }

    const project = (
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects`,
        payload: { name: "Checkout Rewrite", brief: "Ship checkout with no defects." },
      })
    ).json();
    projectId = project.id;

    await app.inject({
      method: "PUT",
      url: `/organizations/${org}/projects/${project.slug}/members`,
      payload: {
        members: [
          { agentId: ids["Nadia"], role: "lead" },
          { agentId: ids["Priya"] },
          { agentId: ids["Sam"] },
        ],
      },
    });
  });

  const seedTask = async (payload: Record<string, unknown>) =>
    (
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects/${projectId}/tasks`,
        payload,
      })
    ).json();

  describe("credentials", () => {
    it("refuses a request with no credential", async () => {
      const res = await app.inject({ method: "GET", url: "/agent/me" });
      expect(res.statusCode).toBe(401);
    });

    it("refuses a credential whose run has finished", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      const runId = str(obj((await shell("Sam", ["whoami"])).body["result"])["runId"]);

      await db.update(agentRuns).set({ status: "completed" }).where(eq(agentRuns.id, runId));

      const after = await shell("Sam", ["whoami"]);
      expect(after.status).toBe(401);
    });

    it("tells the agent who it is and what it is working on", async () => {
      const task = await seedTask({ title: "Empty password accepted", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);

      const me = obj((await shell("Sam", ["whoami"])).body["result"]);
      expect(str(obj(me["agent"])["name"])).toBe("Sam");
      expect(str(obj(me["task"])["key"])).toBe(task.key);
    });
  });

  describe("what the command line does", () => {
    it("lists its own tools when asked for help", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      const help = await shell("Sam", ["help"]);
      expect(help.body["ok"]).toBe(true);
      expect((help.body["tools"] as unknown[]).length).toBeGreaterThan(5);
    });

    it("explains an unknown command instead of failing silently", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      const res = await shell("Sam", ["frobnicate"]);
      expect(res.status).toBe(400);
      expect(str(res.body["error"])).toContain("No such command");
    });

    it("names what is missing rather than rejecting with a code", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      const res = await shell("Sam", ["comment"]);
      expect(str(res.body["error"])).toContain("Usage:");
    });
  });

  describe("the scenario", () => {
    it("runs manager to QA to developer, through review, and back", async () => {
      // 1. A person gives the manager something to look into.
      const audit = await seedTask({
        title: "Audit the checkout flow",
        kind: "investigate",
        assigneeAgentId: ids["Nadia"],
      });
      await startRun("Nadia", audit.id);

      // 2. The manager files work for QA. Delegation is one command.
      const filed = await shell("Nadia", [
        "create",
        ids["Priya"]!,
        "investigate",
        "Test every checkout scenario",
        "--",
        "Deep audit. Report everything you find.",
      ]);
      expect(filed.status).toBe(201);
      const qaTask = obj(filed.body["result"]);
      expect(qaTask["assigneeAgentId"]).toBe(ids["Priya"]);
      // It hangs off the manager's task, so the chain is traceable.
      expect(qaTask["parentId"]).toBe(audit.id);

      // 3. QA works, finds a defect, and files it for the developer.
      await startRun("Priya", str(qaTask["id"]));
      const bug = await shell("Priya", [
        "create",
        ids["Sam"]!,
        "standard",
        "Empty password is accepted at payment",
        "--",
        "Reproduced with an empty string and with one space.",
      ]);
      expect(bug.status).toBe(201);
      const bugTask = obj(bug.body["result"]);

      // QA's own task succeeded: it found things. The verdict is the
      // deliverable, so this is done, not blocked.
      const qaDone = await shell("Priya", [
        "status",
        str(qaTask["key"]),
        "done",
        "--",
        "Eleven scenarios tested, one defect filed.",
      ]);
      expect(qaDone.status).toBe(200);

      // 4. The developer fixes it and sends it for review.
      await startRun("Sam", str(bugTask["id"]));
      const submitted = await shell("Sam", [
        "status",
        str(bugTask["key"]),
        "in_review",
        "--",
        "Fixed the check. Added a test.",
      ]);
      expect(submitted.status).toBe(200);
      const inReview = obj(submitted.body["result"]);
      expect(inReview["status"]).toBe("in_review");
      // The task moved to QA, who filed it. The handover is the message.
      expect(inReview["assigneeAgentId"]).toBe(ids["Priya"]);

      // 5. QA verifies and sends it back with a reason.
      await startRun("Priya", str(bugTask["id"]));
      const bounced = await shell("Priya", [
        "status",
        str(bugTask["key"]),
        "in_progress",
        "--",
        "A single space still passes. The check needs trim().",
      ]);
      expect(bounced.status).toBe(200);
      const returned = obj(bounced.body["result"]);
      expect(returned["status"]).toBe("in_progress");
      expect(returned["assigneeAgentId"]).toBe(ids["Sam"]);
      expect(obj(returned["reviewState"])["changesRequestedCount"]).toBe(1);

      // 6. Second attempt, and this time it is accepted.
      await startRun("Sam", str(bugTask["id"]));
      await shell("Sam", ["status", str(bugTask["key"]), "in_review", "--", "Used trim(). Test added."]);
      await startRun("Priya", str(bugTask["id"]));
      const accepted = await shell("Priya", [
        "status",
        str(bugTask["key"]),
        "done",
        "--",
        "Confirmed: empty, whitespace and null all rejected.",
      ]);
      expect(obj(accepted.body["result"])["status"]).toBe("done");

      // Every verdict is on the record, with the reason that was given.
      const repo = createTaskRepository(db);
      const decisions = await repo.decisions(orgId, str(bugTask["id"]));
      expect(decisions.map((d) => d.outcome)).toEqual(["changes_requested", "approved"]);
      expect(decisions[0]?.body).toContain("trim()");

      // And the whole conversation is readable in one place.
      const feed = (
        await app.inject({ method: "GET", url: `/organizations/${org}/communications` })
      ).json().data as { body: string }[];
      expect(feed.some((c) => c.body.includes("A single space still passes"))).toBe(true);
    });
  });

  describe("the rails", () => {
    it("shows an objective owner its team even with no task of its own", async () => {
      // The run where delegating is the entire job is the run with no task, and
      // anchoring the surface on a task left that agent unable to see anybody
      // to delegate to.
      await startRun("Nadia", null);
      const team = obj((await shell("Nadia", ["team"])).body["result"]);
      const names = (team["data"] as { name: string }[]).map((a) => a.name);
      expect(names).toContain("Priya");
      expect(names).toContain("Sam");
    });

    it("lets an objective owner file work with no task of its own", async () => {
      await startRun("Nadia", null);
      const filed = await shell("Nadia", [
        "create",
        ids["Priya"]!,
        "investigate",
        "Look into the checkout flow",
        "--",
        "Find what is wrong.",
      ]);
      expect(filed.status).toBe(201);
      expect(obj(filed.body["result"])["assigneeAgentId"]).toBe(ids["Priya"]);
    });

    it("shows an objective owner the project it is working in", async () => {
      await startRun("Nadia", null);
      const result = obj((await shell("Nadia", ["project"])).body["result"]);
      expect(obj(result["project"])["name"]).toBe("Checkout Rewrite");
    });

    it("refuses to file work for an agent that is not on the project", async () => {
      const outsider = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/agents`,
          payload: { name: "Outsider", adapterType: "claude_local" },
        })
      ).json();
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);

      const res = await shell("Nadia", ["create", outsider.id, "standard", "Nope", "--", "x"]);
      expect(res.status).toBe(422);
    });

    it("refuses a delegation that hands work back up its own chain", async () => {
      // Two agents each convinced the other is the expert will do this forever,
      // quietly, and every task in the chain stays open so nothing reports it.
      const top = await seedTask({ title: "Top", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", top.id);
      const mid = obj(
        (await shell("Nadia", ["create", ids["Priya"]!, "standard", "Middle", "--", "x"])).body[
          "result"
        ],
      );

      await startRun("Priya", str(mid["id"]));
      const back = await shell("Priya", ["create", ids["Nadia"]!, "standard", "Back up", "--", "x"]);
      expect(back.status).toBe(422);
      expect(str(back.body["error"])).toContain("loop");
    });

    it("stops a run that tries to touch more tasks than its budget", async () => {
      const task = await seedTask({ title: "Root", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);

      const results = [];
      for (let i = 0; i < 22; i += 1) {
        results.push(await shell("Nadia", ["create", "-", "standard", `Task number ${i}`, "--", "x"]));
      }
      const refused = results.filter((r) => r.status === 429);
      expect(refused.length).toBeGreaterThan(0);
      // The refusal is a sentence, so the model can act on it.
      expect(str(refused[0]?.body["error"])).toContain("may");
    });

    it("refuses a verdict with no reason", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);
      const bug = obj(
        (await shell("Nadia", ["create", ids["Sam"]!, "standard", "Fix it", "--", "x"])).body[
          "result"
        ],
      );

      await startRun("Sam", str(bug["id"]));
      await shell("Sam", ["status", str(bug["key"]), "in_review", "--", "done"]);

      await startRun("Nadia", str(bug["id"]));
      const res = await shell("Nadia", ["status", str(bug["key"]), "done"]);
      expect(res.status).toBe(422);
    });

    it("refuses a verdict from an agent that is not the reviewer", async () => {
      // Without this, any run in the organization could approve any task in
      // review — including its own work, by submitting under one run and
      // accepting under the next.
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);
      const bug = obj(
        (await shell("Nadia", ["create", ids["Sam"]!, "standard", "Fix it", "--", "x"])).body[
          "result"
        ],
      );

      await startRun("Sam", str(bug["id"]));
      await shell("Sam", ["status", str(bug["key"]), "in_review", "--", "done"]);

      // Priya has nothing to do with this task.
      await startRun("Priya", str(bug["id"]));
      const res = await shell("Priya", ["status", str(bug["key"]), "done", "--", "Looks fine."]);
      expect(res.status).toBe(403);
    });

    it("refuses an agent verdict on work that is waiting for a person", async () => {
      // A person filed it, so no agent is the reviewer. An agent answering for
      // the person is the whole thing the gate exists to stop.
      const task = await seedTask({ title: "Solo", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      await shell("Sam", ["status", task.key, "in_review", "--", "Done."]);

      await startRun("Priya", task.id);
      const res = await shell("Priya", ["status", task.key, "done", "--", "Fine by me."]);
      expect(res.status).toBe(403);
    });

    it("does not leave work waiting for a person assigned to the agent that did it", async () => {
      // `in_review` is claimable, so leaving it on the implementer meant every
      // later run re-claimed a task they are forbidden to judge.
      const task = await seedTask({ title: "Solo", assigneeAgentId: ids["Sam"] });
      await startRun("Sam", task.id);
      const submitted = obj(
        (await shell("Sam", ["status", task.key, "in_review", "--", "Done."])).body["result"],
      );
      expect(submitted["assigneeAgentId"]).toBeNull();
    });

    it("refuses to reach a task on another project", async () => {
      const other = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/projects`,
          payload: { name: "Something Else" },
        })
      ).json();
      const elsewhere = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/projects/${other.id}/tasks`,
          payload: { title: "Not your business" },
        })
      ).json();

      const mine = await seedTask({ title: "Mine", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", mine.id);

      // Same organization, different project. There is no command that needs
      // this, so it answers as though the task is not there.
      const res = await shell("Nadia", ["task", elsewhere.key]);
      expect(res.status).toBe(404);
    });

    it("explains an unknown status instead of failing with a server error", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);
      const res = await shell("Nadia", ["tasks", "--status=In Progress"]);
      expect(res.status).toBeLessThan(500);
    });

    it("never lets one organization's run see another's task", async () => {
      const other = (
        await app.inject({ method: "POST", url: "/organizations", payload: { name: "Other" } })
      ).json();
      const otherProject = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other.slug}/projects`,
          payload: { name: "Secret" },
        })
      ).json();
      const secret = (
        await app.inject({
          method: "POST",
          url: `/organizations/${other.slug}/projects/${otherProject.id}/tasks`,
          payload: { title: "Secret work" },
        })
      ).json();

      const mine = await seedTask({ title: "Mine", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", mine.id);

      // 404 rather than 403: a 403 confirms the row exists.
      const res = await shell("Nadia", ["task", secret.key]);
      expect(res.status).toBe(404);
    });

    it("does not let an agent claim to be somebody else", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);
      const filed = obj(
        (await shell("Nadia", ["create", ids["Sam"]!, "standard", "Delegated", "--", "x"])).body[
          "result"
        ],
      );

      // Provenance comes from the credential, never from the request body.
      expect(filed["createdByAgentId"]).toBe(ids["Nadia"]);
    });

    it("keeps a terminated agent out of the team listing", async () => {
      const task = await seedTask({ title: "Work", assigneeAgentId: ids["Nadia"] });
      await startRun("Nadia", task.id);
      await db
        .update(agentsTable)
        .set({ status: "terminated" })
        .where(eq(agentsTable.id, ids["Sam"]!));

      const team = obj((await shell("Nadia", ["team"])).body["result"]);
      const names = (team["data"] as { name: string }[]).map((a) => a.name);
      expect(names).not.toContain("Sam");
    });
  });
});
