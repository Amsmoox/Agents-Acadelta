// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  agentRuns,
  agentWakeups,
  agents,
  runEvents,
  type AgentRunRow,
  type Database,
} from "@agentco/db";
import { AppError, NON_INVOKABLE_STATUSES } from "@agentco/shared";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type WakeReason = { type: string; at: string; detail?: string };

export type ClaimedRun = {
  runId: string;
  agentId: string;
  organizationId: string;
  prompt: string;
};

/** A run reaped this many times stops being retried and waits for a person. */
const POISON_PILL_LIMIT = 3;

/** How many trigger reasons one pending wakeup keeps. The most recent win. */
const MAX_WAKE_REASONS = 20;

/**
 * The first instant of the calendar month a moment falls in, in UTC.
 *
 * UTC rather than local time so that two runners in different time zones agree
 * on when the month turned over, and a budget cannot be reset twice by moving
 * a machine.
 */
export function startOfMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function createDispatchRepository(db: Database) {
  return {
    /**
     * Records an intent to run.
     *
     * One statement, and the partial unique index does the coalescing: a second
     * trigger for an agent that already has a pending wakeup merges its reason
     * into the existing row instead of creating another. Check-then-insert
     * cannot do this — two triggers in the same millisecond would both find
     * nothing and both insert.
     */
    async requestWake(
      organizationId: string,
      agentId: string,
      reason: WakeReason,
      prompt?: string,
    ): Promise<{ coalesced: boolean }> {
      const [row] = await db
        .insert(agentWakeups)
        .values({
          organizationId,
          agentId,
          reasons: [reason],
          ...(prompt ? { prompt } : {}),
        })
        .onConflictDoUpdate({
          target: agentWakeups.agentId,
          targetWhere: sql`status = 'pending'`,
          set: {
            // A rolling window, not an append-only log. An agent that is paused
            // with a wakeup pending can be triggered indefinitely, and every
            // trigger used to add another entry to a row nobody ever trimmed.
            reasons: sql`(case
              when jsonb_array_length(${agentWakeups.reasons}) >= ${MAX_WAKE_REASONS}
              then ${agentWakeups.reasons} #- '{0}'
              else ${agentWakeups.reasons}
            end) || ${JSON.stringify([reason])}::jsonb`,
            // A later prompt supersedes an earlier one; the agent should act on
            // the most recent instruction, not the one that happened to be first.
            ...(prompt ? { prompt } : {}),
            updatedAt: new Date(),
          },
        })
        .returning({ reasonCount: sql<number>`jsonb_array_length(${agentWakeups.reasons})` });

      // Read off the row the statement actually wrote, rather than a SELECT
      // beforehand: two callers arriving together both found nothing and both
      // reported "queued", when one of them had in fact merged into the other.
      // A fresh insert carries exactly one reason; only the update path appends.
      return { coalesced: (row?.reasonCount ?? 1) > 1 };
    },

    /**
     * Claims one wakeup and opens a run for it, or returns null.
     *
     * Everything that decides whether a run may start happens in one
     * transaction with the row locked: the agent must be invokable, and it must
     * be within budget. A budget checked before the lease, in its own
     * statement, is a budget that can be exceeded by whatever starts in between.
     */
    async claimNext(runnerId: string, leaseSeconds: number): Promise<ClaimedRun | null> {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({
            id: agentWakeups.id,
            agentId: agentWakeups.agentId,
            organizationId: agentWakeups.organizationId,
            prompt: agentWakeups.prompt,
          })
          .from(agentWakeups)
          .where(
            and(
              eq(agentWakeups.status, "pending"),
              sql`not exists (
                select 1 from ${agentRuns}
                 where ${agentRuns.agentId} = ${agentWakeups.agentId}
                   and ${agentRuns.status} in ('leased', 'running')
              )`,
            ),
          )
          .orderBy(agentWakeups.updatedAt)
          .for("update", { skipLocked: true })
          .limit(1);

        if (!candidate) return null;

        const [agent] = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, candidate.agentId))
          .for("update")
          .limit(1);

        const skip = async (reason: string) => {
          await tx
            .update(agentWakeups)
            .set({ status: "skipped", skipReason: reason, updatedAt: new Date() })
            .where(eq(agentWakeups.id, candidate.id));
          return null;
        };

        if (!agent) return skip("agent_missing");
        if (NON_INVOKABLE_STATUSES.includes(agent.status)) return skip(`agent_${agent.status}`);

        // A monthly budget has to actually be monthly. `spent_monthly_cents`
        // only ever accumulated, so the first month an agent reached its limit
        // was the last month it ever ran. The reset happens here, inside the
        // same locked transaction as the check below, because doing it on a
        // timer would let a run start against a stale figure.
        const period = startOfMonth(new Date());
        let spent = agent.spentMonthlyCents;
        if (!agent.budgetPeriodStart) {
          // An agent that predates this column has a spend belonging to no
          // recorded month. Adopt the current one WITHOUT clearing it: guessing
          // in the agent's favour would hand a full fresh budget to every agent
          // already over its limit, which is the one direction this must not
          // get wrong.
          await tx.update(agents).set({ budgetPeriodStart: period }).where(eq(agents.id, agent.id));
        } else if (agent.budgetPeriodStart < period) {
          spent = 0;
          await tx
            .update(agents)
            .set({ spentMonthlyCents: 0, budgetPeriodStart: period })
            .where(eq(agents.id, agent.id));
        }

        // Zero means no limit. Any other value is a hard stop, and hitting it
        // pauses the agent rather than letting the next wakeup try again and
        // spend more.
        if (agent.budgetMonthlyCents > 0 && spent >= agent.budgetMonthlyCents) {
          await tx
            .update(agents)
            .set({ status: "paused", pauseReason: "budget", pausedAt: new Date() })
            .where(eq(agents.id, agent.id));
          return skip("over_budget");
        }

        await tx
          .update(agentWakeups)
          .set({ status: "claimed", updatedAt: new Date() })
          .where(eq(agentWakeups.id, candidate.id));

        const prompt = candidate.prompt ?? "Check your assignments and continue your work.";

        try {
          const [run] = await tx
            .insert(agentRuns)
            .values({
              organizationId: candidate.organizationId,
              agentId: candidate.agentId,
              wakeupId: candidate.id,
              status: "leased",
              leasedBy: runnerId,
              leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
              prompt,
            })
            .returning();
          if (!run) return null;

          return {
            runId: run.id,
            agentId: run.agentId,
            organizationId: run.organizationId,
            prompt,
          };
        } catch (error) {
          // Another dispatcher won the race for this agent. Not an error — the
          // index did exactly what it is there for.
          if (isUniqueViolation(error)) return null;
          throw error;
        }
      });
    },

    async markRunning(runId: string, pid: number, systemPrompt: string, transcriptPath: string) {
      await db
        .update(agentRuns)
        .set({
          status: "running",
          pid,
          pidStartedAt: new Date(),
          systemPrompt,
          transcriptPath,
          startedAt: new Date(),
          heartbeatAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));

      await db
        .update(agents)
        .set({ status: "running", lastHeartbeatAt: new Date() })
        .where(eq(agents.id, sql`(select agent_id from ${agentRuns} where id = ${runId})`));
    },

    /** Proof of life. Its interval bounds how long a dead run stays undetected. */
    async touch(runId: string, leaseSeconds: number) {
      await db
        .update(agentRuns)
        .set({
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
        })
        .where(eq(agentRuns.id, runId));
    },

    async appendEvents(
      runId: string,
      events: { kind: string; payload: Record<string, unknown> }[],
    ): Promise<number> {
      if (events.length === 0) return 0;

      return db.transaction(async (tx) => {
        const [run] = await tx
          .select({ lastSeq: agentRuns.lastSeq })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId))
          .for("update")
          .limit(1);
        if (!run) return 0;

        const rows = events.map((event, index) => ({
          runId,
          seq: run.lastSeq + index + 1,
          kind: event.kind,
          payload: event.payload,
        }));

        await tx.insert(runEvents).values(rows);
        const lastSeq = run.lastSeq + events.length;
        await tx.update(agentRuns).set({ lastSeq }).where(eq(agentRuns.id, runId));
        return lastSeq;
      });
    },

    async finish(
      runId: string,
      outcome: {
        status: "completed" | "failed" | "cancelled";
        exitCode?: number | null;
        stopReason?: string;
        error?: string;
        inputTokens?: number;
        outputTokens?: number;
        costCents?: number;
      },
    ) {
      return db.transaction(async (tx) => {
        const [run] = await tx
          .update(agentRuns)
          .set({
            status: outcome.status,
            exitCode: outcome.exitCode ?? null,
            stopReason: outcome.stopReason ?? null,
            error: outcome.error ?? null,
            inputTokens: outcome.inputTokens ?? 0,
            outputTokens: outcome.outputTokens ?? 0,
            costCents: outcome.costCents ?? 0,
            endedAt: new Date(),
          })
          .where(eq(agentRuns.id, runId))
          .returning();
        if (!run) return;

        // Money spent is recorded whatever state the agent is in. This used to
        // ride along with the status change below, which meant pausing or
        // terminating an agent mid-run threw away the bill for the run that was
        // already in flight — the one case where the spend matters most.
        await tx
          .update(agents)
          .set({
            spentMonthlyCents: sql`${agents.spentMonthlyCents} + ${outcome.costCents ?? 0}`,
            lastHeartbeatAt: new Date(),
          })
          .where(eq(agents.id, run.agentId));

        // The status transition stays conditional: an agent a person paused or
        // terminated while this run was working must not be quietly returned to
        // idle by the run finishing.
        await tx
          .update(agents)
          .set({
            status: outcome.status === "failed" ? "error" : "idle",
            ...(outcome.status === "failed" ? { errorReason: outcome.error ?? "Run failed." } : {}),
          })
          .where(and(eq(agents.id, run.agentId), eq(agents.status, "running")));
      });
    },

    /**
     * Finds runs whose runner stopped proving they were alive.
     *
     * Liveness, not a fixed timeout: a legitimately long run keeps its lease by
     * touching it, while a run whose runner died stops within one interval.
     */
    async reapStale(staleAfterSeconds: number): Promise<AgentRunRow[]> {
      const cutoff = new Date(Date.now() - staleAfterSeconds * 1000);

      const stale = await db
        .select()
        .from(agentRuns)
        .where(
          and(
            sql`${agentRuns.status} in ('leased', 'running')`,
            lt(agentRuns.heartbeatAt, cutoff),
          ),
        );

      for (const run of stale) {
        const reapCount = run.reapCount + 1;
        await db
          .update(agentRuns)
          .set({
            status: "orphaned",
            reapCount,
            error: "The runner stopped responding.",
            endedAt: new Date(),
          })
          .where(eq(agentRuns.id, run.id));

        await db
          .update(agents)
          .set({ status: "idle" })
          .where(and(eq(agents.id, run.agentId), eq(agents.status, "running")));

        // Repeatedly reaped means something about this work kills its runner.
        // Retrying forever would burn a machine; stop and wait for a person.
        if (reapCount < POISON_PILL_LIMIT) {
          await this.requestWake(run.organizationId, run.agentId, {
            type: "recovery",
            at: new Date().toISOString(),
            detail: "Previous run was interrupted.",
          });
        }
      }

      return stale;
    },

    async listRuns(organizationId: string, agentId: string, limit = 25) {
      return db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.agentId, agentId)))
        .orderBy(desc(agentRuns.createdAt))
        .limit(limit);
    },

    async getRun(organizationId: string, runId: string) {
      const [run] = await db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.id, runId)))
        .limit(1);
      if (!run) throw new AppError("RUN_NOT_FOUND", { runId });
      return run;
    },

    /** Events after `afterSeq`, which is how a reconnecting reader resumes. */
    async listEvents(runId: string, afterSeq = 0, limit = 500) {
      return db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
        .orderBy(runEvents.seq)
        .limit(limit);
    },

    async requestCancel(organizationId: string, runId: string) {
      const run = await this.getRun(organizationId, runId);
      if (run.status !== "running" && run.status !== "leased") {
        throw new AppError("RUN_NOT_ACTIVE", { status: run.status });
      }
      await db
        .update(agentRuns)
        .set({ stopReason: "cancel_requested" })
        .where(eq(agentRuns.id, runId));
      return run;
    },

    async cancelRequested(runId: string): Promise<boolean> {
      const [run] = await db
        .select({ stopReason: agentRuns.stopReason })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .limit(1);
      return run?.stopReason === "cancel_requested";
    },
  };
}

export type DispatchRepository = ReturnType<typeof createDispatchRepository>;
