// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, eq, sql } from "drizzle-orm";
import { agents, objectives, tasks, type Database, type TaskRow } from "@agentco/db";
import {
  AppError,
  MAX_REVIEW_ROUNDS,
  isTerminalTaskStatus,
  type ReviewState,
  type Task,
  type TaskStatus,
} from "@agentco/shared";
import { createDispatchRepository } from "./dispatch.js";
import { createTaskRepository, type Actor } from "./tasks.js";

/**
 * Moving work, and what each move sets in motion.
 *
 * There is no central table of legal transitions. Legality belongs to whatever
 * owns the move — the atomic claim owns `todo -> in_progress`, this file owns
 * everything around review, the dependency check owns `blocked` — and a single
 * function pretending to know all of them becomes a lie within a month. What
 * *is* central is the side effects, so those cannot drift apart.
 */

export type MoveResult = {
  task: Task;
  /** Agents to wake, and why. Returned rather than woken here so the caller
   *  decides whether a wake is appropriate in its context. */
  wake: { agentId: string; reason: string; detail: string }[];
};

function emptyReviewState(): ReviewState {
  return { status: "idle", changesRequestedCount: 0 };
}

export function createWorkflowService(db: Database) {
  const repo = createTaskRepository(db);
  const dispatch = createDispatchRepository(db);

  async function agentName(agentId: string | null): Promise<string> {
    if (!agentId) return "someone";
    const [row] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return row?.name ?? "someone";
  }

  /**
   * Who is entitled to cast the verdict.
   *
   * Three separate questions, and getting any of them wrong means work marks
   * its own homework. The submitter is excluded because they are the one being
   * judged; a task with no agent reviewer is waiting for a person and no agent
   * may answer for them; and an agent that is not the designated reviewer has
   * no standing at all, whatever else is true.
   */
  function assertVerdictAllowed(row: TaskRow, state: ReviewState, actor: Actor): void {
    if (row.reviewPolicy === "human_only" && actor.type !== "user") {
      throw new AppError("TASK_REVIEW_NOT_ALLOWED", { policy: row.reviewPolicy });
    }
    if (actor.type !== "agent") return;

    if (!state.reviewerAgentId) {
      throw new AppError("TASK_REVIEW_NOT_ALLOWED", { reason: "waiting_for_a_person" });
    }
    if (state.reviewerAgentId !== actor.agentId) {
      throw new AppError("TASK_REVIEW_NOT_ALLOWED", { reason: "not_the_reviewer" });
    }
    // Not reconstructed from a log after the fact: who submitted it is written
    // down when they submit, because guessing gets it wrong.
    if (row.reviewPolicy === "not_creator" && state.submittedByAgentId === actor.agentId) {
      throw new AppError("TASK_REVIEW_NOT_ALLOWED", { policy: row.reviewPolicy });
    }
  }

  return {
    /**
     * Submits finished work for review.
     *
     * Two things happen that make the bounce possible later: the current
     * assignee is remembered as where a rejection goes back to, and the task is
     * handed to the reviewer. That handover *is* the message — the reviewer now
     * owns the task, so it appears in their queue like any other work, with a
     * run and a cost of its own.
     */
    async submitForReview(
      organizationId: string,
      taskId: string,
      actor: Actor,
      comment?: string,
    ): Promise<MoveResult> {
      const row = await repo.requireRow(organizationId, taskId);
      if (isTerminalTaskStatus(row.status)) throw new AppError("TASK_TERMINAL");

      // Already there. Submitting again would recompute the implementer as
      // whoever holds it now — the reviewer — and write them in as the person
      // to hand a rejection back to, losing the one who actually did the work.
      if (row.status === "in_review") {
        const [task] = await repo.hydrate([row]);
        return { task: task!, wake: [] };
      }

      const previous = (row.reviewStateJson as ReviewState | null) ?? emptyReviewState();

      // The creator reviews by default: they asked for it, so they know what
      // they wanted. With nobody to review it, the work is simply done.
      const reviewerAgentId = row.createdByAgentId ?? previous.reviewerAgentId ?? null;
      const implementer = row.assigneeAgentId;

      if (!reviewerAgentId || reviewerAgentId === implementer) {
        // No agent can judge this — a person filed it, or the only candidate is
        // the one who did the work. It waits for a person rather than
        // completing itself: an agent marking its own work done because nobody
        // else was available is exactly what the review gate exists to prevent.
        const waiting: ReviewState = {
          status: "pending",
          returnAssigneeAgentId: implementer,
          submittedByAgentId: actor.type === "agent" ? actor.agentId : null,
          submittedByUserId: actor.type === "user" ? actor.userId : null,
          reviewerAgentId: null,
          changesRequestedCount: previous.changesRequestedCount,
        };
        const held = await repo.setStatus(row.id, "in_review", {
          // Unassigned, and that matters: `in_review` is claimable, so leaving
          // it on the implementer meant their every later run re-claimed a task
          // they are forbidden to judge — a paid run achieving nothing, for
          // ever, while their real work waited behind it.
          assigneeAgentId: null,
          reviewStateJson: waiting,
          claimedByRunId: null,
          claimedAt: null,
        });
        if (comment) await repo.comment(organizationId, row.id, comment, "progress", actor);
        await repo.comment(
          organizationId,
          row.id,
          "Submitted for review. No agent can judge this one, so it is waiting for a person.",
          "system",
          { type: "system" },
        );
        const [task] = await repo.hydrate([held]);
        return { task: task!, wake: [] };
      }

      const state: ReviewState = {
        status: "pending",
        returnAssigneeAgentId: implementer,
        submittedByAgentId: actor.type === "agent" ? actor.agentId : null,
        submittedByUserId: actor.type === "user" ? actor.userId : null,
        reviewerAgentId,
        changesRequestedCount: previous.changesRequestedCount,
      };

      const updated = await repo.setStatus(row.id, "in_review", {
        assigneeAgentId: reviewerAgentId,
        reviewStateJson: state,
        claimedByRunId: null,
        claimedAt: null,
      });

      if (comment) await repo.comment(organizationId, row.id, comment, "progress", actor);
      await repo.comment(
        organizationId,
        row.id,
        `Submitted for review by ${await agentName(implementer)}.`,
        "handoff",
        { type: "system" },
      );

      const [task] = await repo.hydrate([updated]);
      return {
        task: task!,
        wake: [
          { agentId: reviewerAgentId, reason: "task_review_requested", detail: updated.key },
        ],
      };
    },

    /**
     * The verdict.
     *
     * A reason is required either way. On a rejection it is the only thing that
     * makes the next attempt different from the last one; on an approval it is
     * the record of what was actually checked, which is what a report is built
     * from later.
     */
    async castVerdict(
      organizationId: string,
      taskId: string,
      outcome: "approved" | "changes_requested",
      body: string,
      actor: Actor,
    ): Promise<MoveResult> {
      const row = await repo.requireRow(organizationId, taskId);
      if (row.status !== "in_review") throw new AppError("TASK_NOT_IN_REVIEW", { status: row.status });
      if (!body.trim()) throw new AppError("TASK_REVIEW_COMMENT_REQUIRED");

      const state = (row.reviewStateJson as ReviewState | null) ?? emptyReviewState();
      assertVerdictAllowed(row, state, actor);

      const round = state.changesRequestedCount + 1;
      await repo.recordDecision(organizationId, row.id, round, outcome, body, actor);
      await repo.comment(organizationId, row.id, body, "verdict", actor);

      if (outcome === "approved") {
        const done = await repo.setStatus(row.id, "done", {
          reviewStateJson: { ...state, status: "completed" },
          claimedByRunId: null,
          claimedAt: null,
        });
        const [task] = await repo.hydrate([done]);
        return { task: task!, wake: await this.wakesForCompletion(organizationId, done) };
      }

      // A human decision resets the counter. The cap is there to stop
      // unattended agent-to-agent ping-pong, not to limit a person who is
      // giving real iterative feedback on their own task.
      const count = actor.type === "user" ? 0 : state.changesRequestedCount + 1;
      const capped = count >= MAX_REVIEW_ROUNDS;

      if (capped) {
        // Nobody is converging. Stop, and put it in front of a person rather
        // than spending another round discovering the same disagreement.
        const escalated = await repo.setStatus(row.id, "blocked", {
          assigneeAgentId: null,
          reviewStateJson: { ...state, status: "changes_requested", changesRequestedCount: count },
          claimedByRunId: null,
          claimedAt: null,
        });
        await repo.comment(
          organizationId,
          row.id,
          `This has been sent back ${count} times without agreement. It needs a person to decide.`,
          "system",
          { type: "system" },
        );
        const [task] = await repo.hydrate([escalated]);
        return { task: task!, wake: [] };
      }

      const returnTo = state.returnAssigneeAgentId ?? null;
      const bounced = await repo.setStatus(row.id, "in_progress", {
        assigneeAgentId: returnTo,
        reviewStateJson: { ...state, status: "changes_requested", changesRequestedCount: count },
        claimedByRunId: null,
        claimedAt: null,
      });

      const [task] = await repo.hydrate([bounced]);
      return {
        task: task!,
        wake: returnTo
          ? [{ agentId: returnTo, reason: "task_changes_requested", detail: bounced.key }]
          : [],
      };
    },

    /**
     * Who should hear that a task finished.
     *
     * Its parent, so a manager can decide what comes next; and any dependent
     * that this was the last thing holding up.
     */
    async wakesForCompletion(
      organizationId: string,
      row: TaskRow,
    ): Promise<MoveResult["wake"]> {
      const wake: MoveResult["wake"] = [];

      if (row.parentId) {
        const [parent] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, row.parentId))
          .limit(1);
        if (parent?.assigneeAgentId && !isTerminalTaskStatus(parent.status)) {
          wake.push({
            agentId: parent.assigneeAgentId,
            reason: "child_task_finished",
            detail: `${row.key} ${row.status}`,
          });
        }
      }

      for (const dependent of await repo.dependentsNowReady(row.id)) {
        const moved = await repo.refreshBlockedState(organizationId, dependent.id);
        if (moved === "todo" && dependent.assigneeAgentId) {
          wake.push({
            agentId: dependent.assigneeAgentId,
            reason: "blockers_resolved",
            detail: dependent.key,
          });
        }
      }

      // The agent carrying the standing order hears about anything finishing
      // underneath it. This is what makes an objective event-driven rather than
      // a poll: between things happening, it costs nothing at all.
      if (row.objectiveId) {
        const [objective] = await db
          .select({ ownerAgentId: objectives.ownerAgentId })
          .from(objectives)
          .where(and(eq(objectives.id, row.objectiveId), eq(objectives.status, "active")))
          .limit(1);
        if (objective && !wake.some((w) => w.agentId === objective.ownerAgentId)) {
          wake.push({
            agentId: objective.ownerAgentId,
            reason: "objective_cycle",
            detail: `${row.key} ${row.status}`,
          });
        }
      }

      return wake;
    },

    /**
     * Any other move: a person dragging a card, an agent saying it is blocked.
     *
     * Review moves go through the two methods above, because they carry state
     * that a bare status write would silently drop.
     */
    async move(
      organizationId: string,
      taskId: string,
      status: TaskStatus,
      actor: Actor,
      comment?: string,
    ): Promise<MoveResult> {
      const row = await repo.requireRow(organizationId, taskId);

      if (status === "in_review") return this.submitForReview(organizationId, taskId, actor, comment);
      if (row.status === "in_review" && (status === "done" || status === "in_progress")) {
        if (!comment?.trim()) throw new AppError("TASK_REVIEW_COMMENT_REQUIRED");
        return this.castVerdict(
          organizationId,
          taskId,
          status === "done" ? "approved" : "changes_requested",
          comment,
          actor,
        );
      }

      if (status === "done" && (await repo.unresolvedBlockers(row.id)) > 0) {
        // Completing something that is still waiting on another task is almost
        // always a mistake about which task was meant.
        throw new AppError("TASK_TERMINAL", { reason: "blocked" });
      }

      const updated = await repo.setStatus(row.id, status, {
        ...(isTerminalTaskStatus(status) ? { claimedByRunId: null, claimedAt: null } : {}),
      });
      if (comment) await repo.comment(organizationId, row.id, comment, "progress", actor);

      const [task] = await repo.hydrate([updated]);
      return {
        task: task!,
        wake: isTerminalTaskStatus(status)
          ? await this.wakesForCompletion(organizationId, updated)
          : [],
      };
    },

    /**
     * Fires the wakes a move produced.
     *
     * An agent is never woken by its own action: it is already awake, and
     * waking it again is how a loop starts that reads its own output and
     * answers it, forever, at full price.
     */
    async applyWakes(
      organizationId: string,
      wakes: MoveResult["wake"],
      actor: Actor,
    ): Promise<void> {
      const self = actor.type === "agent" ? actor.agentId : null;
      for (const wake of wakes) {
        if (wake.agentId === self) continue;
        await dispatch.requestWake(organizationId, wake.agentId, {
          type: wake.reason,
          at: new Date().toISOString(),
          detail: wake.detail,
        });
      }
    },

    async countOpenUnder(objectiveId: string): Promise<number> {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.objectiveId, objectiveId),
            sql`${tasks.status} not in ('done','cancelled')`,
          ),
        );
      return row?.value ?? 0;
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
