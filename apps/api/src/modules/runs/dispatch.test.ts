// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { agentRuns, agentWakeups, agents, createDatabase, type Database } from "@agentco/db";
import { TEST_DATABASE_URL, databaseReachable, migrateTestDatabase, truncateAll } from "../../test/db.js";
import { createDispatchRepository, startOfMonth } from "@agentco/core";

const reachable = await databaseReachable();

/**
 * These run against a real PostgreSQL because the behaviour under test is two
 * partial unique indexes settling races. Against a mock they would assert
 * nothing at all.
 */
describe.skipIf(!reachable)("dispatch", () => {
  let db: Database;
  let close: () => Promise<void>;
  let dispatch: ReturnType<typeof createDispatchRepository>;
  let org: string;
  let agent: string;

  beforeAll(async () => {
    await migrateTestDatabase();
    const connection = createDatabase(TEST_DATABASE_URL, 10);
    db = connection.db;
    close = connection.close;
    dispatch = createDispatchRepository(db);
  });

  afterAll(async () => close());

  beforeEach(async () => {
    await truncateAll();
    const [organization] = await db
      .insert((await import("@agentco/db")).organizations)
      .values({ slug: "acme", name: "Acme" })
      .returning();
    org = organization!.id;

    const [row] = await db
      .insert(agents)
      .values({
        organizationId: org,
        slug: "ada",
        name: "Ada",
        adapterType: "process",
        adapterConfig: { command: "/bin/echo" },
      })
      .returning();
    agent = row!.id;
  });

  const reason = (type: string) => ({ type, at: new Date().toISOString() });

  describe("coalescing", () => {
    it("merges a second trigger into the pending wakeup instead of queueing another", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const second = await dispatch.requestWake(org, agent, reason("assignment"));

      expect(second.coalesced).toBe(true);
      const pending = await db
        .select()
        .from(agentWakeups)
        .where(and(eq(agentWakeups.agentId, agent), eq(agentWakeups.status, "pending")));
      expect(pending).toHaveLength(1);
      expect(pending[0]!.reasons.map((r) => r.type)).toEqual(["timer", "assignment"]);
    });

    it("holds at one pending wakeup under a burst of simultaneous triggers", async () => {
      // The real scenario: a timer, an assignment and three mentions landing
      // together. Check-then-insert would produce five runs doing one job.
      await Promise.all(
        ["timer", "assignment", "mention", "mention", "manual"].map((type) =>
          dispatch.requestWake(org, agent, reason(type)),
        ),
      );

      const pending = await db
        .select()
        .from(agentWakeups)
        .where(and(eq(agentWakeups.agentId, agent), eq(agentWakeups.status, "pending")));
      expect(pending).toHaveLength(1);
      expect(pending[0]!.reasons.length).toBe(5);
    });

    it("lets the newest prompt supersede an earlier one", async () => {
      await dispatch.requestWake(org, agent, reason("manual"), "do the first thing");
      await dispatch.requestWake(org, agent, reason("manual"), "actually do this instead");

      const claimed = await dispatch.claimNext("runner-1", 30);
      expect(claimed?.prompt).toBe("actually do this instead");
    });

    it("accepts a new wakeup once the previous one was claimed", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      await dispatch.claimNext("runner-1", 30);

      const again = await dispatch.requestWake(org, agent, reason("timer"));
      expect(again.coalesced).toBe(false);
    });

    it("reports coalescing from the row it wrote, not from a read beforehand", async () => {
      // Three callers arriving together all used to find no pending wakeup and
      // all report "queued", when two of them had merged into the first.
      const results = await Promise.all([
        dispatch.requestWake(org, agent, reason("a")),
        dispatch.requestWake(org, agent, reason("b")),
        dispatch.requestWake(org, agent, reason("c")),
      ]);

      expect(results.filter((r) => !r.coalesced)).toHaveLength(1);
      expect(results.filter((r) => r.coalesced)).toHaveLength(2);

      const rows = await db.select().from(agentWakeups).where(eq(agentWakeups.agentId, agent));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reasons).toHaveLength(3);
    });

    it("keeps a bounded window of reasons rather than growing without limit", async () => {
      // An agent paused with a wakeup pending can be triggered indefinitely,
      // and nothing ever trimmed the row.
      for (let i = 0; i < 30; i += 1) {
        await dispatch.requestWake(org, agent, reason(`trigger-${i}`));
      }

      const [row] = await db.select().from(agentWakeups).where(eq(agentWakeups.agentId, agent));
      expect(row!.reasons).toHaveLength(20);
      // The most recent survive; the oldest are the ones dropped.
      expect(row!.reasons.at(-1)!.type).toBe("trigger-29");
      expect(row!.reasons.at(0)!.type).toBe("trigger-10");
    });
  });

  describe("the lease", () => {
    it("gives the run to exactly one of several dispatchers", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));

      const claims = await Promise.all(
        ["a", "b", "c", "d"].map((id) => dispatch.claimNext(`runner-${id}`, 30)),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it("will not open a second run while one is active", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      await dispatch.claimNext("runner-1", 30);
      await dispatch.requestWake(org, agent, reason("timer"));

      expect(await dispatch.claimNext("runner-2", 30)).toBeNull();
    });

    it("dispatches again once the first run has finished", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const first = await dispatch.claimNext("runner-1", 30);
      await dispatch.finish(first!.runId, { status: "completed", exitCode: 0 });

      await dispatch.requestWake(org, agent, reason("timer"));
      expect(await dispatch.claimNext("runner-1", 30)).not.toBeNull();
    });
  });

  describe("gates before a run may start", () => {
    it.each(["paused", "terminated", "pending_approval"] as const)(
      "does not start a %s agent",
      async (status) => {
        await db.update(agents).set({ status }).where(eq(agents.id, agent));
        await dispatch.requestWake(org, agent, reason("timer"));

        expect(await dispatch.claimNext("runner-1", 30)).toBeNull();
        const [wakeup] = await db.select().from(agentWakeups).where(eq(agentWakeups.agentId, agent));
        expect(wakeup!.status).toBe("skipped");
        expect(wakeup!.skipReason).toBe(`agent_${status}`);
      },
    );

    it("refuses to start an agent that is out of budget, and pauses it", async () => {
      // The budget is checked with the row locked in the same transaction as
      // the lease: checked beforehand, it could be exceeded by whatever starts
      // in between.
      await db
        .update(agents)
        .set({ budgetMonthlyCents: 500, spentMonthlyCents: 500 })
        .where(eq(agents.id, agent));
      await dispatch.requestWake(org, agent, reason("timer"));

      expect(await dispatch.claimNext("runner-1", 30)).toBeNull();

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.status).toBe("paused");
      expect(row!.pauseReason).toBe("budget");
    });

    it("treats a zero budget as no limit", async () => {
      await db
        .update(agents)
        .set({ budgetMonthlyCents: 0, spentMonthlyCents: 999_999 })
        .where(eq(agents.id, agent));
      await dispatch.requestWake(org, agent, reason("timer"));

      expect(await dispatch.claimNext("runner-1", 30)).not.toBeNull();
    });

    it("starts the spend again when the month turns over", async () => {
      // `spent_monthly_cents` only ever accumulated, so the first month an
      // agent reached its limit was the last month it ever ran: a "monthly"
      // budget that was really a lifetime one.
      await db
        .update(agents)
        .set({
          budgetMonthlyCents: 500,
          spentMonthlyCents: 500,
          budgetPeriodStart: new Date(Date.UTC(2020, 0, 1)),
        })
        .where(eq(agents.id, agent));
      await dispatch.requestWake(org, agent, reason("timer"));

      expect(await dispatch.claimNext("runner-1", 30)).not.toBeNull();

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.spentMonthlyCents).toBe(0);
      expect(row!.budgetPeriodStart).toEqual(startOfMonth(new Date()));
      expect(row!.status).not.toBe("paused");
    });

    it("does not reset the spend inside the same month", async () => {
      await db
        .update(agents)
        .set({
          budgetMonthlyCents: 500,
          spentMonthlyCents: 500,
          budgetPeriodStart: startOfMonth(new Date()),
        })
        .where(eq(agents.id, agent));
      await dispatch.requestWake(org, agent, reason("timer"));

      expect(await dispatch.claimNext("runner-1", 30)).toBeNull();

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.spentMonthlyCents).toBe(500);
      expect(row!.pauseReason).toBe("budget");
    });
  });

  describe("the transcript", () => {
    it("numbers events monotonically so a reader can resume", async () => {
      await dispatch.requestWake(org, agent, reason("manual"), "hello");
      const run = await dispatch.claimNext("runner-1", 30);

      await dispatch.appendEvents(run!.runId, [
        { kind: "log", payload: { text: "one" } },
        { kind: "log", payload: { text: "two" } },
      ]);
      const lastSeq = await dispatch.appendEvents(run!.runId, [
        { kind: "log", payload: { text: "three" } },
      ]);

      expect(lastSeq).toBe(3);
      const afterFirst = await dispatch.listEvents(run!.runId, 1);
      expect(afterFirst.map((e) => e.payload["text"])).toEqual(["two", "three"]);
    });

    it("keeps numbering correct when two writers append at once", async () => {
      await dispatch.requestWake(org, agent, reason("manual"), "hello");
      const run = await dispatch.claimNext("runner-1", 30);

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          dispatch.appendEvents(run!.runId, [{ kind: "log", payload: { i } }]),
        ),
      );

      const events = await dispatch.listEvents(run!.runId, 0);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("recovery", () => {
    it("reaps a run whose runner stopped proving it was alive", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await db
        .update(agentRuns)
        .set({ status: "running", heartbeatAt: new Date(Date.now() - 120_000) })
        .where(eq(agentRuns.id, run!.runId));

      const reaped = await dispatch.reapStale(60);
      expect(reaped).toHaveLength(1);

      const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, run!.runId));
      expect(row!.status).toBe("orphaned");
    });

    it("leaves a slow but living run alone", async () => {
      // Liveness, not a fixed timeout: a long run that keeps touching its lease
      // must not be killed for taking a long time.
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await dispatch.touch(run!.runId, 30);

      expect(await dispatch.reapStale(60)).toHaveLength(0);
    });

    it("re-wakes the agent after a reap, so interrupted work resumes", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await db
        .update(agentRuns)
        .set({ heartbeatAt: new Date(Date.now() - 120_000) })
        .where(eq(agentRuns.id, run!.runId));

      await dispatch.reapStale(60);
      const pending = await db
        .select()
        .from(agentWakeups)
        .where(and(eq(agentWakeups.agentId, agent), eq(agentWakeups.status, "pending")));
      expect(pending).toHaveLength(1);
    });

    it("stops re-waking a run that keeps killing its runner", async () => {
      // Otherwise a poisonous task burns a machine forever. Three strikes, then
      // it waits for a person.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await dispatch.requestWake(org, agent, reason("timer"));
        const run = await dispatch.claimNext("runner-1", 30);
        if (!run) break;
        await db
          .update(agentRuns)
          .set({
            heartbeatAt: new Date(Date.now() - 120_000),
            reapCount: attempt,
          })
          .where(eq(agentRuns.id, run.runId));
        await dispatch.reapStale(60);
      }

      const pending = await db
        .select()
        .from(agentWakeups)
        .where(and(eq(agentWakeups.agentId, agent), eq(agentWakeups.status, "pending")));
      expect(pending).toHaveLength(0);
    });
  });

  describe("starting", () => {
    it("does not undo a pause that landed while the process was starting", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);

      // A person pauses between the lease and the process actually starting.
      await db
        .update(agents)
        .set({ status: "paused", pauseReason: "manual" })
        .where(eq(agents.id, agent));

      await dispatch.markRunning(run!.runId, 4242, "# prompt", "/tmp/transcript.ndjson");

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.status).toBe("paused");
      // Proof of life is still recorded; only the status change is refused.
      expect(row!.lastHeartbeatAt).not.toBeNull();
    });

    it("marks an idle agent as running", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);

      await dispatch.markRunning(run!.runId, 4242, "# prompt", "/tmp/transcript.ndjson");

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.status).toBe("running");
    });
  });

  describe("finishing", () => {
    it("adds the run's cost to the agent's spend", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await db.update(agents).set({ status: "running" }).where(eq(agents.id, agent));

      await dispatch.finish(run!.runId, { status: "completed", exitCode: 0, costCents: 42 });

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.spentMonthlyCents).toBe(42);
      expect(row!.status).toBe("idle");
    });

    it("records the cost even when the agent was paused mid-run", async () => {
      // The spend used to ride along with the status change, which is guarded
      // on the agent still being `running`. Pausing or terminating an agent
      // while a run was in flight therefore threw away the bill for it — the
      // one case where knowing what was spent matters most.
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await db.update(agents).set({ status: "running" }).where(eq(agents.id, agent));

      await db
        .update(agents)
        .set({ status: "paused", pauseReason: "manual" })
        .where(eq(agents.id, agent));

      await dispatch.finish(run!.runId, { status: "completed", exitCode: 0, costCents: 137 });

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.spentMonthlyCents).toBe(137);
      // Still paused: a run finishing must not undo a person's decision.
      expect(row!.status).toBe("paused");
    });

    it("leaves the agent in error after a failed run, with the reason visible", async () => {
      await dispatch.requestWake(org, agent, reason("timer"));
      const run = await dispatch.claimNext("runner-1", 30);
      await db.update(agents).set({ status: "running" }).where(eq(agents.id, agent));

      await dispatch.finish(run!.runId, { status: "failed", error: "command not found" });

      const [row] = await db.select().from(agents).where(eq(agents.id, agent));
      expect(row!.status).toBe("error");
      expect(row!.errorReason).toBe("command not found");
    });
  });
});
