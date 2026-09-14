// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agentRuns,
  agents,
  objectives,
  taskComments,
  taskReviewDecisions,
  tasks,
  type Database,
  type ObjectiveRow,
} from "@agentco/db";
import {
  AppError,
  type CreateObjectiveInput,
  type Objective,
  type ObjectiveCheckResult,
} from "@agentco/shared";
import { checksFor, weigh } from "./verification.js";
import { createTaskRepository } from "./tasks.js";

/**
 * A standing instruction that is guaranteed to stop.
 *
 * "Keep going until it is clean" is not a task: a task finishes when its work
 * is done, and this finishes when a condition holds — or when one of three
 * brakes reaches its limit first. Every way out is explicit, and at least one
 * of them is always reachable, which is the difference between a standing order
 * and an open-ended bill.
 *
 * The owner is not polled. It is woken when something under the objective
 * reaches a terminal state, so between events the objective costs nothing.
 */

export type ObjectiveEnding = {
  status: "satisfied" | "exhausted" | "abandoned";
  outcome: string;
};

function toObjective(
  row: ObjectiveRow,
  extra: { ownerName: string | null; taskCount: number; openTaskCount: number },
): Objective {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    directive: row.directive,
    exitCriteria: row.exitCriteria,
    ownerAgentId: row.ownerAgentId,
    ownerName: extra.ownerName,
    status: row.status,
    maxCycles: row.maxCycles,
    cycleCount: row.cycleCount,
    budgetCents: row.budgetCents,
    spentCents: row.spentCents,
    maxIdleCycles: row.maxIdleCycles,
    idleCycles: row.idleCycles,
    outcome: row.outcome,
    reportTaskId: row.reportTaskId,
    checks: checksFor(row.checks),
    checkResults: (row.checkResults ?? []) as ObjectiveCheckResult[],
    verifying: row.satisfactionRequestedAt !== null,
    taskCount: extra.taskCount,
    openTaskCount: extra.openTaskCount,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export function createObjectiveRepository(db: Database) {
  const taskRepo = createTaskRepository(db);

  async function counts(objectiveId: string) {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} not in ('done','cancelled'))::int`,
      })
      .from(tasks)
      .where(eq(tasks.objectiveId, objectiveId));
    return { taskCount: row?.total ?? 0, openTaskCount: row?.open ?? 0 };
  }

  async function hydrate(rows: ObjectiveRow[]): Promise<Objective[]> {
    const out: Objective[] = [];
    for (const row of rows) {
      const [owner] = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, row.ownerAgentId))
        .limit(1);
      out.push(toObjective(row, { ownerName: owner?.name ?? null, ...(await counts(row.id)) }));
    }
    return out;
  }

  return {
    async create(
      organizationId: string,
      projectId: string,
      input: CreateObjectiveInput,
      userId: string,
    ): Promise<Objective> {
      try {
        const [row] = await db
          .insert(objectives)
          .values({
            organizationId,
            projectId,
            title: input.title,
            directive: input.directive,
            exitCriteria: input.exitCriteria,
            ownerAgentId: input.ownerAgentId,
            maxCycles: input.maxCycles,
            budgetCents: input.budgetCents,
            maxIdleCycles: input.maxIdleCycles,
            checks: input.checks,
            ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
            createdByUserId: userId,
          })
          .returning();
        if (!row) throw new AppError("INTERNAL");
        const [objective] = await hydrate([row]);
        return objective!;
      } catch (error) {
        // The partial unique index: one standing order per agent per project,
        // because two is no order at all.
        if (
          typeof error === "object" &&
          error &&
          String((error as { cause?: { code?: string } }).cause?.code ?? "") === "23505"
        ) {
          throw new AppError("OBJECTIVE_ALREADY_ACTIVE", { agentId: input.ownerAgentId });
        }
        throw error;
      }
    },

    async list(organizationId: string, projectId: string): Promise<Objective[]> {
      const rows = await db
        .select()
        .from(objectives)
        .where(
          and(eq(objectives.organizationId, organizationId), eq(objectives.projectId, projectId)),
        )
        .orderBy(desc(objectives.createdAt));
      return hydrate(rows);
    },

    async get(organizationId: string, id: string): Promise<Objective> {
      const [row] = await db
        .select()
        .from(objectives)
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, id)))
        .limit(1);
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id });
      const [objective] = await hydrate([row]);
      return objective!;
    },

    async activeFor(agentId: string): Promise<ObjectiveRow | null> {
      const [row] = await db
        .select()
        .from(objectives)
        .where(and(eq(objectives.ownerAgentId, agentId), eq(objectives.status, "active")))
        .limit(1);
      return row ?? null;
    },

    /** A cycle is one run of the owning agent under this objective. */
    async beginCycle(objectiveId: string): Promise<void> {
      await db
        .update(objectives)
        .set({ cycleCount: sql`${objectives.cycleCount} + 1` })
        .where(eq(objectives.id, objectiveId));
    },

    /**
     * Closes a cycle and decides whether the objective carries on.
     *
     * A cycle that produced no task and said nothing is idle. An agent that
     * wakes, thinks, finds nothing and files nothing is not making progress —
     * but it is still spending, and two of those in a row is the difference
     * between "keep going until it's clean" and an open-ended bill.
     */
    async endCycle(
      objectiveId: string,
      input: { runId: string; costCents: number },
    ): Promise<ObjectiveEnding | null> {
      const [produced] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.createdByRunId, input.runId));
      const [said] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(taskComments)
        .where(eq(taskComments.authorRunId, input.runId));
      // Finishing something counts, even in silence. A comment is optional on
      // every move, so a run that closed two tasks and said nothing about them
      // was being recorded as having achieved nothing — and two of those in a
      // row ended the objective while it was in fact progressing.
      const [moved] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.lastRunId, input.runId),
            sql`${tasks.status} in ('done', 'cancelled', 'in_review')`,
          ),
        );

      const idle =
        (produced?.value ?? 0) === 0 && (said?.value ?? 0) === 0 && (moved?.value ?? 0) === 0;

      const [row] = await db
        .update(objectives)
        .set({
          spentCents: sql`${objectives.spentCents} + ${input.costCents}`,
          idleCycles: idle ? sql`${objectives.idleCycles} + 1` : 0,
        })
        .where(eq(objectives.id, objectiveId))
        .returning();
      if (!row) return null;

      if (row.cycleCount >= row.maxCycles) {
        return {
          status: "exhausted",
          outcome: `Stopped after ${row.cycleCount} cycles, the limit set when it was created.`,
        };
      }
      if (row.budgetCents > 0 && row.spentCents >= row.budgetCents) {
        return {
          status: "exhausted",
          outcome: `Stopped at $${(row.spentCents / 100).toFixed(2)}, the budget set when it was created.`,
        };
      }
      if (row.idleCycles >= row.maxIdleCycles) {
        return {
          status: "exhausted",
          outcome: `Stopped after ${row.idleCycles} cycles that produced no new work and said nothing.`,
        };
      }
      return null;
    },

    /**
     * The owner's request to declare it finished.
     *
     * Checked, not taken. The agent saying the work is done is a claim; open
     * tasks under the objective are a fact, and the fact wins. It is a weaker
     * gate than evidence against stated criteria would be, and it is still not
     * the model marking its own homework.
     */
    /**
     * The owning agent asking to finish.
     *
     * Recorded as a request, never acted on here. Something that is not the
     * agent has to run the checks first — that gap is the entire difference
     * between declaring the work done and it being done.
     */
    async requestSatisfaction(
      organizationId: string,
      objectiveId: string,
      summary: string,
    ): Promise<{ accepted: boolean; reason: string }> {
      const [row] = await db
        .select()
        .from(objectives)
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, objectiveId)))
        .limit(1);
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id: objectiveId });
      if (row.status !== "active") throw new AppError("OBJECTIVE_NOT_ACTIVE", { status: row.status });

      await db
        .update(objectives)
        .set({ satisfactionRequestedAt: new Date(), satisfactionSummary: summary })
        .where(eq(objectives.id, objectiveId));

      return {
        accepted: true,
        reason: "Recorded. The checks will run and the objective ends only if they pass.",
      };
    },

    /**
     * Settles an outstanding request against results the system produced.
     *
     * Command results come from whatever was able to run them; the open-task
     * count is read here, now, rather than taken from anybody's summary.
     */
    async settleSatisfaction(
      organizationId: string,
      objectiveId: string,
      commandResults: ObjectiveCheckResult[],
    ): Promise<{ satisfied: boolean; refusal: string }> {
      const [row] = await db
        .select()
        .from(objectives)
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, objectiveId)))
        .limit(1);
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id: objectiveId });

      const checks = checksFor(row.checks);
      const { openTaskCount } = await counts(objectiveId);
      const now = new Date().toISOString();

      const results: ObjectiveCheckResult[] = checks.map((check) => {
        if (check.kind === "no_open_tasks") {
          return {
            id: check.id,
            passed: openTaskCount === 0,
            observed:
              openTaskCount === 0
                ? "nothing open"
                : `${openTaskCount} task${openTaskCount === 1 ? "" : "s"} still open`,
            checkedAt: now,
          };
        }
        const ran = commandResults.find((result) => result.id === check.id);
        if (ran) return ran;

        // Kept from last time rather than reset, so a human tick survives a
        // later automated run.
        const previous = ((row.checkResults ?? []) as ObjectiveCheckResult[]).find(
          (result) => result.id === check.id,
        );
        return previous ?? { id: check.id, passed: false, observed: "", checkedAt: null };
      });

      const outcome = weigh(checks, results);

      await db
        .update(objectives)
        .set({
          checkResults: results as unknown as Record<string, unknown>[],
          satisfactionRequestedAt: null,
        })
        .where(eq(objectives.id, objectiveId));

      if (outcome.satisfied) {
        await this.end(organizationId, objectiveId, {
          status: "satisfied",
          outcome: row.satisfactionSummary || "Every check passed.",
        });
      }
      return { satisfied: outcome.satisfied, refusal: outcome.refusal };
    },

    /** A person settling a check only a person can settle. */
    async recordHumanCheck(
      organizationId: string,
      objectiveId: string,
      checkId: string,
      passed: boolean,
      note: string,
    ): Promise<Objective> {
      const [row] = await db
        .select()
        .from(objectives)
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, objectiveId)))
        .limit(1);
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id: objectiveId });

      const existing = ((row.checkResults ?? []) as ObjectiveCheckResult[]).filter(
        (result) => result.id !== checkId,
      );
      const results = [
        ...existing,
        { id: checkId, passed, observed: note, checkedAt: new Date().toISOString() },
      ];

      await db
        .update(objectives)
        .set({ checkResults: results as unknown as Record<string, unknown>[] })
        .where(eq(objectives.id, objectiveId));

      return this.get(organizationId, objectiveId);
    },

    /** Objectives whose owner has asked to finish and whose checks have not run. */
    async awaitingVerification(): Promise<ObjectiveRow[]> {
      return db
        .select()
        .from(objectives)
        .where(and(eq(objectives.status, "active"), sql`satisfaction_requested_at is not null`));
    },

    async end(
      organizationId: string,
      objectiveId: string,
      ending: ObjectiveEnding,
    ): Promise<Objective> {
      const [row] = await db
        .update(objectives)
        .set({ status: ending.status, outcome: ending.outcome, endedAt: new Date() })
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, objectiveId)))
        .returning();
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id: objectiveId });

      const reportTaskId = await this.writeReport(organizationId, row, ending);
      await db.update(objectives).set({ reportTaskId }).where(eq(objectives.id, row.id));

      const [objective] = await hydrate([{ ...row, reportTaskId }]);
      return objective!;
    },

    async setStatus(
      organizationId: string,
      objectiveId: string,
      status: "active" | "paused",
    ): Promise<Objective> {
      const [row] = await db
        .update(objectives)
        .set({ status })
        .where(and(eq(objectives.organizationId, organizationId), eq(objectives.id, objectiveId)))
        .returning();
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { id: objectiveId });
      const [objective] = await hydrate([row]);
      return objective!;
    },

    /**
     * The report, built from the records rather than written by a model.
     *
     * What was fixed, what was found and not fixed, what is still open, and
     * what it cost — every line of it is a row somebody can click through to.
     * A summary composed by an agent would read better and would be a claim;
     * this is the system saying what actually happened, which is the only
     * useful thing a report can be.
     */
    async writeReport(
      organizationId: string,
      objective: ObjectiveRow,
      ending: ObjectiveEnding,
    ): Promise<string | null> {
      const all = await db
        .select({
          id: tasks.id,
          key: tasks.key,
          title: tasks.title,
          status: tasks.status,
          kind: tasks.kind,
          assignee: agents.name,
        })
        .from(tasks)
        .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
        .where(eq(tasks.objectiveId, objective.id))
        .orderBy(asc(tasks.number));

      const taskIds = all.map((task) => task.id);
      const decisions =
        taskIds.length === 0
          ? []
          : await db
              .select({
                taskId: taskReviewDecisions.taskId,
                outcome: taskReviewDecisions.outcome,
                round: taskReviewDecisions.round,
                body: taskReviewDecisions.body,
                actor: agents.name,
              })
              .from(taskReviewDecisions)
              .leftJoin(agents, eq(agents.id, taskReviewDecisions.actorAgentId))
              // Scoped to this objective's tasks rather than filtered afterwards,
              // so the query does not read the organization's whole history to
              // throw nearly all of it away.
              .where(inArray(taskReviewDecisions.taskId, taskIds))
              .orderBy(asc(taskReviewDecisions.createdAt));

      // Bounded by the objective's own lifetime. Without the window this
      // counted every run every agent in the organization had ever done and
      // presented the total as the cost of this objective.
      const spend = await db
        .select({
          name: agents.name,
          runs: sql<number>`count(*)::int`,
          cost: sql<number>`coalesce(sum(${agentRuns.costCents}), 0)::int`,
        })
        .from(agentRuns)
        .innerJoin(agents, eq(agents.id, agentRuns.agentId))
        .where(
          and(
            eq(agentRuns.organizationId, organizationId),
            sql`${agentRuns.createdAt} >= ${objective.createdAt}`,
          ),
        )
        .groupBy(agents.name);

      const byTask = new Map(all.map((t) => [t.id, t]));
      const rounds = new Map<string, number>();
      for (const decision of decisions) {
        if (!byTask.has(decision.taskId)) continue;
        rounds.set(decision.taskId, Math.max(rounds.get(decision.taskId) ?? 0, decision.round));
      }

      const done = all.filter((t) => t.status === "done");
      const abandoned = all.filter((t) => t.status === "cancelled");
      const open = all.filter((t) => t.status !== "done" && t.status !== "cancelled");

      const lines: string[] = [
        `# ${objective.title} — report`,
        "",
        `**Asked:** ${objective.directive.split("\n")[0]}`,
        `**Finished as:** ${ending.status}. ${ending.outcome}`,
        `**Cycles:** ${objective.cycleCount} of ${objective.maxCycles}.`,
        "",
        "## What was asked for",
        objective.directive,
        "",
        "## How anyone would know it is done",
        objective.exitCriteria,
        "",
        `## Completed (${done.length})`,
      ];

      if (done.length === 0) lines.push("_Nothing was completed._");
      for (const task of done) {
        const round = rounds.get(task.id);
        lines.push(
          `- **${task.key}** ${task.title} — ${task.assignee ?? "unassigned"}${round ? `, ${round} review round${round === 1 ? "" : "s"}` : ""}`,
        );
      }

      // The section most reports leave out, and the reason to read one.
      lines.push("", `## Found but not fixed (${abandoned.length})`);
      if (abandoned.length === 0) lines.push("_Nothing was abandoned._");
      for (const task of abandoned) lines.push(`- **${task.key}** ${task.title} — cancelled`);

      lines.push("", `## Still open (${open.length})`);
      if (open.length === 0) lines.push("_Nothing is outstanding._");
      for (const task of open) {
        lines.push(`- **${task.key}** ${task.title} — ${task.status}, ${task.assignee ?? "nobody"}`);
      }

      const verdicts = decisions.filter((d) => byTask.has(d.taskId));
      lines.push("", `## Review decisions (${verdicts.length})`);
      if (verdicts.length === 0) lines.push("_No work went through review._");
      for (const decision of verdicts) {
        const task = byTask.get(decision.taskId);
        lines.push(
          `- ${task?.key} round ${decision.round}, **${decision.outcome === "approved" ? "approved" : "changes requested"}** by ${decision.actor ?? "a person"}: ${decision.body.split("\n")[0]}`,
        );
      }

      lines.push("", `## Cost, from ${objective.createdAt.toISOString().slice(0, 10)}`);
      for (const row of spend) {
        lines.push(`- ${row.name}: ${row.runs} run${row.runs === 1 ? "" : "s"}, $${((row.cost ?? 0) / 100).toFixed(2)}`);
      }
      lines.push("", `Objective spend: $${(objective.spentCents / 100).toFixed(2)}.`);

      const report = await taskRepo
        .createSafely(
          organizationId,
          objective.projectId,
          {
            title: `Report — ${objective.title}`,
            description: lines.join("\n"),
            kind: "report",
            priority: "normal",
            status: "todo",
          },
          { type: "user", userId: objective.createdByUserId },
          { objectiveId: objective.id },
        )
        .catch(() => null);

      if (report) {
        // Nothing to do on it. It is the record, not a piece of work.
        await taskRepo.setStatus(report.id, "done");
      }
      return report?.id ?? null;
    },
  };
}

export type ObjectiveRepository = ReturnType<typeof createObjectiveRepository>;
