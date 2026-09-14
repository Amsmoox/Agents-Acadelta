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
 * The loop, exercised through the API a person uses.
 *
 * Everything here is the shape of the scenario this product exists for: a
 * manager files work for a specialist, the specialist files work for somebody
 * else, the work comes back for review, and the review either accepts it or
 * sends it back with a reason.
 */
describe.skipIf(!reachable)("tasks API", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let org: string;
  let project: string;
  const agentIds: Record<string, string> = {};

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
    org = (
      await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } })
    ).json().slug;

    for (const name of ["Nadia", "Sam", "Priya"]) {
      const agent = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/agents`,
          payload: { name, adapterType: "claude_local" },
        })
      ).json();
      agentIds[name] = agent.id;
    }

    project = (
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects`,
        payload: { name: "Checkout Rewrite" },
      })
    ).json().slug;

    await app.inject({
      method: "PUT",
      url: `/organizations/${org}/projects/${project}/members`,
      payload: {
        members: [
          { agentId: agentIds["Nadia"], role: "lead" },
          { agentId: agentIds["Sam"] },
          { agentId: agentIds["Priya"] },
        ],
      },
    });
  });

  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/organizations/${org}/projects/${project}/tasks`,
      payload,
    });

  const move = (key: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/organizations/${org}/tasks/${key}/move`, payload });

  const read = async (key: string) =>
    (await app.inject({ method: "GET", url: `/organizations/${org}/tasks/${key}` })).json();

  describe("creating work", () => {
    it("numbers tasks from the project's prefix", async () => {
      expect((await create({ title: "One" })).json().key).toBe("CR-1");
      expect((await create({ title: "Two" })).json().key).toBe("CR-2");
    });

    it("numbers concurrent creates without collision", async () => {
      // Bumping a counter inside the insert, rather than reading the maximum
      // and adding one, is what makes this safe.
      const results = await Promise.all([
        create({ title: "A" }),
        create({ title: "B" }),
        create({ title: "C" }),
      ]);
      const keys = results.map((r) => r.json().key);
      expect(new Set(keys).size).toBe(3);
    });

    it("refuses a second open task with the same title under the same parent", async () => {
      const parent = (await create({ title: "Parent" })).json();
      await create({ title: "Fix the login bug", parentId: parent.id });
      const again = await create({ title: "fix   the LOGIN bug", parentId: parent.id });

      expect(again.statusCode).toBe(409);
      // Naming the existing one is the difference between a model retrying
      // five times and a model reading the comment thread.
      expect(again.json().error.detail.existing).toBeTruthy();
    });

    it("allows the same title again once the first is done", async () => {
      const first = (await create({ title: "Recurring" })).json();
      await move(first.key, { status: "done" });
      expect((await create({ title: "Recurring" })).statusCode).toBe(201);
    });

    it("refuses an assignee who is not on the project", async () => {
      const outsider = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/agents`,
          payload: { name: "Outsider", adapterType: "claude_local" },
        })
      ).json();
      const res = await create({ title: "Work", assigneeAgentId: outsider.id });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-6007");
    });
  });

  describe("the review loop", () => {
    it("goes out for review, comes back with a reason, and is accepted the second time", async () => {
      // Priya files work for Sam. She is the creator, so she reviews it.
      const task = (
        await create({ title: "Empty password is accepted", assigneeAgentId: agentIds["Sam"] })
      ).json();

      const submitted = (await move(task.key, { status: "in_review" })).json();
      expect(submitted.status).toBe("in_review");
      expect(submitted.reviewState.returnAssigneeAgentId).toBe(agentIds["Sam"]);

      const bounced = (
        await move(task.key, {
          status: "in_progress",
          comment: "A single space still passes. The check needs trim().",
        })
      ).json();
      expect(bounced.status).toBe("in_progress");
      // Back to whoever did the work, by id, from state captured at submit.
      expect(bounced.assigneeAgentId).toBe(agentIds["Sam"]);
      // Zero, not one: this rejection came from a person, and the cap exists
      // to stop agents disagreeing unattended rather than to limit a reviewer.
      expect(bounced.reviewState.changesRequestedCount).toBe(0);

      await move(task.key, { status: "in_review" });
      const accepted = (
        await move(task.key, { status: "done", comment: "Confirmed. Whitespace rejected too." })
      ).json();
      expect(accepted.status).toBe("done");

      const full = await read(task.key);
      expect(full.decisions).toHaveLength(2);
      expect(full.decisions.map((d: { outcome: string }) => d.outcome)).toEqual([
        "changes_requested",
        "approved",
      ]);
    });

    it("refuses a verdict with no reason", async () => {
      const task = (await create({ title: "Work", assigneeAgentId: agentIds["Sam"] })).json();
      await move(task.key, { status: "in_review" });

      const res = await move(task.key, { status: "done" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-6008");
    });

    it("waits for a person when no agent can judge it", async () => {
      // A person filed it, so there is no agent creator to review it. It must
      // not complete itself: an agent marking its own work done because nobody
      // else was available is the thing the gate exists to prevent.
      const task = (await create({ title: "Solo", assigneeAgentId: agentIds["Sam"] })).json();
      const submitted = (await move(task.key, { status: "in_review" })).json();
      expect(submitted.status).toBe("in_review");
      expect(submitted.reviewState.reviewerAgentId).toBeNull();
    });

    it("does not count a person's rejections towards the ping-pong cap", async () => {
      // The cap stops two agents disagreeing forever unattended. A person
      // giving real iterative feedback on their own task is not that.
      const task = (await create({ title: "Ambiguous", assigneeAgentId: agentIds["Sam"] })).json();
      for (let round = 0; round < 4; round += 1) {
        await move(task.key, { status: "in_review" });
        const bounced = (
          await move(task.key, { status: "in_progress", comment: `Round ${round}: not yet.` })
        ).json();
        expect(bounced.status).toBe("in_progress");
        expect(bounced.reviewState.changesRequestedCount).toBe(0);
      }
    });
  });

  describe("guards that only show up under load", () => {
    it("refuses a second open task with the same title at the root", async () => {
      // Every task a person files sits at the root with a null parent, and
      // NULLs compare as distinct in a unique index — so the one group this
      // was most needed for was the one group it never covered.
      await create({ title: "Fix the login bug" });
      const again = await create({ title: "fix   the LOGIN bug" });
      expect(again.statusCode).toBe(409);
    });

    it("picks up an urgent task ahead of older ordinary ones", async () => {
      // The candidate list is limited, so ordering after the limit meant an
      // agent with a backlog could never reach anything filed today.
      const { createTaskRepository } = await import("@agentco/core");
      const { createDatabase } = await import("@agentco/db");
      const connection = createDatabase(TEST_DATABASE_URL, 2);
      const repo = createTaskRepository(connection.db);

      for (let i = 0; i < 12; i += 1) {
        await create({ title: `Old ${i}`, assigneeAgentId: agentIds["Sam"], priority: "normal" });
      }
      const urgent = (
        await create({ title: "Urgent thing", assigneeAgentId: agentIds["Sam"], priority: "urgent" })
      ).json();

      const claimed = await repo.claimNextFor(
        agentIds["Sam"]!,
        "01a09999-0000-7000-8000-00000000abcd",
      );
      expect(claimed?.key).toBe(urgent.key);
      await connection.close();
    });

    it("refuses to hand a task back up its own chain", async () => {
      // The assign route skipped the guard the create route has, so this was
      // the way around the delegation-cycle check.
      const top = (await create({ title: "Top", assigneeAgentId: agentIds["Nadia"] })).json();
      const mid = (
        await create({ title: "Middle", parentId: top.id, assigneeAgentId: agentIds["Priya"] })
      ).json();

      const res = await app.inject({
        method: "PATCH",
        url: `/organizations/${org}/tasks/${mid.key}`,
        payload: { assigneeAgentId: agentIds["Nadia"] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-6006");
    });

    it("does not lose the implementer when work is submitted twice", async () => {
      // Submitting again recomputed the implementer as whoever holds it — the
      // reviewer — and wrote them in as the person a rejection goes back to.
      const task = (await create({ title: "Work", assigneeAgentId: agentIds["Sam"] })).json();
      await move(task.key, { status: "in_review" });
      const again = (await move(task.key, { status: "in_review" })).json();
      expect(again.reviewState.returnAssigneeAgentId).toBe(agentIds["Sam"]);
    });
  });

  describe("dependencies", () => {
    it("blocks a dependent until its blocker is done, and only done", async () => {
      const api = (await create({ title: "API", assigneeAgentId: agentIds["Sam"] })).json();
      const ui = (await create({ title: "UI", assigneeAgentId: agentIds["Priya"] })).json();

      await app.inject({
        method: "POST",
        url: `/organizations/${org}/tasks/${ui.key}/blockers`,
        payload: { blockerTaskId: api.id },
      });
      expect((await read(ui.key)).status).toBe("blocked");

      await move(api.key, { status: "done" });
      expect((await read(ui.key)).status).toBe("todo");
    });

    it("leaves a dependent blocked when its blocker is cancelled", async () => {
      // Cancelling says the work will not happen. Starting the dependent anyway
      // means building on something that does not exist.
      const api = (await create({ title: "API", assigneeAgentId: agentIds["Sam"] })).json();
      const ui = (await create({ title: "UI", assigneeAgentId: agentIds["Priya"] })).json();
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/tasks/${ui.key}/blockers`,
        payload: { blockerTaskId: api.id },
      });

      await move(api.key, { status: "cancelled" });
      expect((await read(ui.key)).status).toBe("blocked");
    });

    it("needs every blocker done, not just one", async () => {
      const a = (await create({ title: "A" })).json();
      const b = (await create({ title: "B" })).json();
      const c = (await create({ title: "C", assigneeAgentId: agentIds["Sam"] })).json();
      for (const blocker of [a, b]) {
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/tasks/${c.key}/blockers`,
          payload: { blockerTaskId: blocker.id },
        });
      }

      await move(a.key, { status: "done" });
      expect((await read(c.key)).status).toBe("blocked");
      await move(b.key, { status: "done" });
      expect((await read(c.key)).status).toBe("todo");
    });

    it("refuses an edge that would make two tasks wait for each other", async () => {
      const a = (await create({ title: "A" })).json();
      const b = (await create({ title: "B" })).json();
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/tasks/${b.key}/blockers`,
        payload: { blockerTaskId: a.id },
      });

      const res = await app.inject({
        method: "POST",
        url: `/organizations/${org}/tasks/${a.key}/blockers`,
        payload: { blockerTaskId: b.id },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AGC-6010");
    });
  });

  describe("what a person can always do", () => {
    // Everything here had a route and no way to reach it from the product,
    // which is the same as not having it.
    it("reassigns a task, and says so in the thread", async () => {
      const task = (await create({ title: "Work", assigneeAgentId: agentIds["Sam"] })).json();
      const moved = (
        await app.inject({
          method: "PATCH",
          url: `/organizations/${org}/tasks/${task.key}`,
          payload: { assigneeAgentId: agentIds["Priya"] },
        })
      ).json();

      expect(moved.assigneeAgentId).toBe(agentIds["Priya"]);
      const full = await read(task.key);
      expect(full.comments.some((c: { intent: string }) => c.intent === "handoff")).toBe(true);
    });

    it("edits a task without touching who has it", async () => {
      const task = (await create({ title: "Typo", assigneeAgentId: agentIds["Sam"] })).json();
      const edited = (
        await app.inject({
          method: "PATCH",
          url: `/organizations/${org}/tasks/${task.key}`,
          payload: { title: "Fixed", priority: "urgent" },
        })
      ).json();

      expect(edited.title).toBe("Fixed");
      expect(edited.priority).toBe("urgent");
      expect(edited.assigneeAgentId).toBe(agentIds["Sam"]);
    });

    it("clears a dependency, which is the decision a cancelled blocker forces", async () => {
      const blocker = (await create({ title: "Blocker" })).json();
      const dependent = (await create({ title: "Dependent", assigneeAgentId: agentIds["Sam"] })).json();
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/tasks/${dependent.key}/blockers`,
        payload: { blockerTaskId: blocker.id },
      });
      await move(blocker.key, { status: "cancelled" });
      expect((await read(dependent.key)).status).toBe("blocked");

      // Somebody decides it goes ahead anyway.
      await app.inject({
        method: "DELETE",
        url: `/organizations/${org}/tasks/${dependent.key}/blockers/${blocker.id}`,
      });
      const after = await read(dependent.key);
      expect(after.status).toBe("todo");
      expect(after.blockedBy).toHaveLength(0);
    });

    it("returns the chain with the task, so it can be walked", async () => {
      const parent = (await create({ title: "Parent" })).json();
      await create({ title: "Child one", parentId: parent.id });
      await create({ title: "Child two", parentId: parent.id });

      const full = await read(parent.key);
      expect(full.children).toHaveLength(2);
      expect(full.parent).toBeNull();

      const child = await read(full.children[0].key);
      expect(child.parent.key).toBe(parent.key);
    });
  });

  describe("a standing objective", () => {
    const objective = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: `/organizations/${org}/projects/${project}/objectives`,
        payload: {
          title: "Zero defects",
          directive: "Keep going until checkout is clean.",
          exitCriteria: "No open tasks, every defect verified.",
          ownerAgentId: agentIds["Nadia"],
          ...payload,
        },
      });

    it("keeps the person's own words, and the condition separately", async () => {
      const res = await objective({});
      expect(res.statusCode).toBe(201);
      expect(res.json().directive).toBe("Keep going until checkout is clean.");
      expect(res.json().exitCriteria).toBe("No open tasks, every defect verified.");
      expect(res.json().status).toBe("active");
    });

    it("allows only one standing order per agent on a project", async () => {
      await objective({});
      const second = await objective({ title: "Another" });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("AGC-6014");
    });

    it("writes a report when a person stops it", async () => {
      const created = (await objective({})).json();
      const stopped = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/objectives/${created.id}/stop`,
        })
      ).json();

      expect(stopped.status).toBe("abandoned");
      expect(stopped.reportTaskId).toBeTruthy();

      const report = await read(stopped.reportTaskId);
      expect(report.kind).toBe("report");
      // The two sections a report is actually read for.
      expect(report.description).toContain("Found but not fixed");
      expect(report.description).toContain("Still open");
      // And the person's words, not a paraphrase of them.
      expect(report.description).toContain("Keep going until checkout is clean.");
    });

    it("pauses and resumes without writing anything off", async () => {
      const created = (await objective({})).json();
      const paused = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/objectives/${created.id}/pause`,
        })
      ).json();
      expect(paused.status).toBe("paused");
      // Pausing is reversible and produces no report: nothing has ended.
      expect(paused.reportTaskId).toBeNull();

      const resumed = (
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/objectives/${created.id}/resume`,
        })
      ).json();
      expect(resumed.status).toBe("active");
    });

    it("does not finish just because the agent says so", async () => {
      // The whole point of the verification path. An agent reporting its own
      // work complete is a claim; the objective ends only when something that
      // is not the agent has established the facts.
      const { createObjectiveRepository } = await import("@agentco/core");
      const { createDatabase } = await import("@agentco/db");
      const connection = createDatabase(TEST_DATABASE_URL, 2);
      const repo = createObjectiveRepository(connection.db);

      const created = (await objective({})).json();
      const orgRow = (
        await app.inject({ method: "GET", url: `/organizations/${org}` })
      ).json();

      // Something is still open under it.
      await app.inject({
        method: "POST",
        url: `/organizations/${org}/projects/${project}/tasks`,
        payload: { title: "Still going", assigneeAgentId: agentIds["Sam"] },
      });
      const open = (
        await app.inject({
          method: "GET",
          url: `/organizations/${org}/projects/${project}/tasks`,
        })
      ).json().data[0];
      await connection.db.execute(
        // Tag it to the objective the way an agent's own filing would.
        `update agc_tasks set objective_id = '${created.id}' where id = '${open.id}'`,
      );

      const asked = await repo.requestSatisfaction(orgRow.id, created.id, "All done.");
      expect(asked.accepted).toBe(true);

      // Asking is not finishing.
      expect((await repo.get(orgRow.id, created.id)).status).toBe("active");

      const settled = await repo.settleSatisfaction(orgRow.id, created.id, []);
      expect(settled.satisfied).toBe(false);
      expect(settled.refusal).toContain("still open");
      expect((await repo.get(orgRow.id, created.id)).status).toBe("active");

      await connection.close();
    });

    it("finishes once the facts actually hold", async () => {
      const { createObjectiveRepository } = await import("@agentco/core");
      const { createDatabase } = await import("@agentco/db");
      const connection = createDatabase(TEST_DATABASE_URL, 2);
      const repo = createObjectiveRepository(connection.db);

      const created = (await objective({})).json();
      const orgRow = (await app.inject({ method: "GET", url: `/organizations/${org}` })).json();

      await repo.requestSatisfaction(orgRow.id, created.id, "Nothing left to do.");
      const settled = await repo.settleSatisfaction(orgRow.id, created.id, []);

      expect(settled.satisfied).toBe(true);
      const after = await repo.get(orgRow.id, created.id);
      expect(after.status).toBe("satisfied");
      expect(after.reportTaskId).toBeTruthy();
      await connection.close();
    });

    it("waits for a person on a check only a person can settle", async () => {
      const { createObjectiveRepository } = await import("@agentco/core");
      const { createDatabase } = await import("@agentco/db");
      const connection = createDatabase(TEST_DATABASE_URL, 2);
      const repo = createObjectiveRepository(connection.db);

      const created = (
        await objective({
          checks: [
            {
              id: "looks-right",
              statement: "The checkout flow looks and feels right",
              kind: "human",
              required: true,
            },
          ],
        })
      ).json();
      const orgRow = (await app.inject({ method: "GET", url: `/organizations/${org}` })).json();

      await repo.requestSatisfaction(orgRow.id, created.id, "Done as far as I can tell.");
      const first = await repo.settleSatisfaction(orgRow.id, created.id, []);
      expect(first.satisfied).toBe(false);
      expect(first.refusal).toContain("looks and feels right");

      // A person says yes.
      const ticked = await app.inject({
        method: "POST",
        url: `/organizations/${org}/objectives/${created.id}/checks/looks-right`,
        payload: { passed: true, note: "Looked at it, happy." },
      });
      expect(ticked.statusCode).toBe(200);

      await repo.requestSatisfaction(orgRow.id, created.id, "Done.");
      const second = await repo.settleSatisfaction(orgRow.id, created.id, []);
      expect(second.satisfied).toBe(true);
      await connection.close();
    });

    it("writes one report however many times it is ended", async () => {
      // Two verification sweeps a second and a half apart both read one
      // objective as pending and both settled it, so it got two reports.
      const { createObjectiveRepository } = await import("@agentco/core");
      const { createDatabase } = await import("@agentco/db");
      const connection = createDatabase(TEST_DATABASE_URL, 2);
      const repo = createObjectiveRepository(connection.db);

      const created = (await objective({})).json();
      const orgRow = (await app.inject({ method: "GET", url: `/organizations/${org}` })).json();

      const [first, second] = await Promise.all([
        repo.settleSatisfaction(orgRow.id, created.id, []),
        repo.settleSatisfaction(orgRow.id, created.id, []),
      ]);
      expect(first.satisfied || second.satisfied).toBe(true);

      const reports = (
        await app.inject({
          method: "GET",
          url: `/organizations/${org}/projects/${project}/tasks?kind=report`,
        })
      ).json().data;
      expect(reports).toHaveLength(1);
      await connection.close();
    });

    it("counts the work filed under it", async () => {
      const created = (await objective({})).json();
      expect(created.taskCount).toBe(0);
      expect(created.openTaskCount).toBe(0);
    });
  });

  describe("the thread", () => {
    it("keeps everything said about a task in order", async () => {
      const task = (await create({ title: "Talk", assigneeAgentId: agentIds["Sam"] })).json();
      for (const body of ["first", "second"]) {
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/tasks/${task.key}/comments`,
          payload: { body },
        });
      }
      const full = await read(task.key);
      expect(full.comments.map((c: { body: string }) => c.body)).toEqual(["first", "second"]);
    });

    it("shows everything said across the organization, newest first", async () => {
      const one = (await create({ title: "One" })).json();
      const two = (await create({ title: "Two" })).json();
      for (const [task, body] of [
        [one, "about one"],
        [two, "about two"],
      ] as const) {
        await app.inject({
          method: "POST",
          url: `/organizations/${org}/tasks/${task.key}/comments`,
          payload: { body },
        });
      }

      const feed = (
        await app.inject({ method: "GET", url: `/organizations/${org}/communications` })
      ).json().data;
      expect(feed[0].body).toBe("about two");
      expect(feed[0].taskKey).toBe("CR-2");
    });
  });
});
