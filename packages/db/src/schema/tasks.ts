// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";
import { agents } from "./agents.js";
import { projects } from "./projects.js";
import { agentRuns } from "./runs.js";

export const taskStatus = pgEnum(`${DB_TABLE_PREFIX}task_status`, [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
]);

export const taskPriority = pgEnum(`${DB_TABLE_PREFIX}task_priority`, [
  "urgent",
  "high",
  "normal",
  "low",
]);

export const taskKind = pgEnum(`${DB_TABLE_PREFIX}task_kind`, [
  "standard",
  "investigate",
  "review",
  "report",
]);

/**
 * One piece of work.
 *
 * `blocked` means *I cannot proceed*. It does not mean the news is bad: an
 * investigation that finds eleven defects succeeded, and its verdict is the
 * deliverable. Getting that backwards makes every audit look like a failure
 * and poisons every rollup above it.
 */
export const tasks = pgTable(
  `${DB_TABLE_PREFIX}tasks`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),

    /** Sequential within the project; `key` is the two joined, for URLs and prompts. */
    number: integer("number").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),

    parentId: uuid("parent_id"),
    /** Delegation hops from a human-created root. Capped, so a chain cannot run away. */
    depth: integer("depth").notNull().default(0),

    kind: taskKind("kind").notNull().default("standard"),
    priority: taskPriority("priority").notNull().default("normal"),

    status: taskStatus("status").notNull().default("backlog"),
    /** Bumped on every status write, so a stale view cannot overwrite a new one. */
    statusVersion: bigint("status_version", { mode: "number" }).notNull().default(0),
    /**
     * When this task most recently entered `blocked`.
     *
     * It looks like an audit column and is not: it is the cycle stamp that keeps
     * unblock wakes idempotent across a task being blocked more than once.
     */
    blockedTransitionAt: timestamp("blocked_transition_at", { withTimezone: true }),

    assigneeAgentId: uuid("assignee_agent_id"),
    /** The person every agent action on this task is ceilinged by. */
    responsibleUserId: text("responsible_user_id").notNull(),

    createdByAgentId: uuid("created_by_agent_id"),
    createdByRunId: uuid("created_by_run_id"),
    /** The objective this was spawned under, if any. */
    objectiveId: uuid("objective_id"),

    /** The claim. One live run owns a task, and this is what says so. */
    claimedByRunId: uuid("claimed_by_run_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    /** anyone | not_creator | human_only */
    reviewPolicy: text("review_policy").notNull().default("not_creator"),
    reviewStateJson: jsonb("review_state_json").$type<Record<string, unknown>>(),

    /** Runs that ended without moving this task or saying anything. */
    noProgressRuns: integer("no_progress_runs").notNull().default(0),
    lastRunId: uuid("last_run_id"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique(`${DB_TABLE_PREFIX}tasks_org_id_uq`).on(t.organizationId, t.id),
    uniqueIndex(`${DB_TABLE_PREFIX}tasks_project_number_key`).on(t.projectId, t.number),
    uniqueIndex(`${DB_TABLE_PREFIX}tasks_org_key_key`).on(t.organizationId, sql`upper(${t.key})`),

    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: `${DB_TABLE_PREFIX}tasks_org_project_fk`,
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.parentId],
      foreignColumns: [t.organizationId, t.id],
      name: `${DB_TABLE_PREFIX}tasks_org_parent_fk`,
    }).onDelete("set null"),
    foreignKey({
      columns: [t.organizationId, t.assigneeAgentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}tasks_org_assignee_fk`,
    }).onDelete("set null"),

    index(`${DB_TABLE_PREFIX}tasks_board_idx`).on(t.projectId, t.status, t.createdAt.desc()),
    index(`${DB_TABLE_PREFIX}tasks_parent_idx`).on(t.parentId),
    index(`${DB_TABLE_PREFIX}tasks_objective_idx`).on(t.objectiveId),
    // The queue an agent's next run reads. Partial, because a finished task is
    // never in it and the index should not carry the whole history.
    index(`${DB_TABLE_PREFIX}tasks_assignee_open_idx`)
      .on(t.assigneeAgentId, t.priority, t.createdAt)
      .where(sql`status not in ('done', 'cancelled')`),

    /**
     * Duplicate suppression among open siblings.
     *
     * A manager agent will file the same task twice across two runs, and this
     * turns the second into a clean conflict naming the first rather than a
     * board with two of everything.
     */
    uniqueIndex(`${DB_TABLE_PREFIX}tasks_open_dup_key`)
      // Doubled backslash on purpose: this is a TypeScript template literal, and
      // a single one is eaten before PostgreSQL ever sees it — which silently
      // turned the whitespace class into the letter "s".
      .on(t.projectId, t.parentId, sql`lower(regexp_replace(${t.title}, '\\s+', ' ', 'g'))`)
      .where(sql`status not in ('done', 'cancelled')`),
  ],
);

export const commentAuthorType = pgEnum(`${DB_TABLE_PREFIX}comment_author_type`, [
  "agent",
  "user",
  "system",
]);

/**
 * The thread. One substrate for everything anybody says about a task, so there
 * is one ordering and one place to read it.
 */
export const taskComments = pgTable(
  `${DB_TABLE_PREFIX}task_comments`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    taskId: uuid("task_id").notNull(),

    authorType: commentAuthorType("author_type").notNull(),
    authorAgentId: uuid("author_agent_id"),
    authorRunId: uuid("author_run_id"),
    authorUserId: text("author_user_id"),

    body: text("body").notNull(),
    /** note | progress | verdict | question | handoff | system */
    intent: text("intent").notNull().default("note"),
    /** internal | external — external content is never treated as instructions. */
    trust: text("trust").notNull().default("internal"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: `${DB_TABLE_PREFIX}task_comments_org_task_fk`,
    }).onDelete("cascade"),
    index(`${DB_TABLE_PREFIX}task_comments_task_idx`).on(t.taskId, t.createdAt, t.id),
    // The organization-wide feed: what every agent said, newest first.
    index(`${DB_TABLE_PREFIX}task_comments_org_recent_idx`).on(
      t.organizationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

/** Append-only record of every review verdict, and the reason given for it. */
export const taskReviewDecisions = pgTable(
  `${DB_TABLE_PREFIX}task_review_decisions`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    taskId: uuid("task_id").notNull(),
    round: integer("round").notNull(),
    /** approved | changes_requested */
    outcome: text("outcome").notNull(),
    /** Required, never empty: it is the only thing that makes the next attempt different. */
    body: text("body").notNull(),
    actorAgentId: uuid("actor_agent_id"),
    actorUserId: text("actor_user_id"),
    actorRunId: uuid("actor_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: `${DB_TABLE_PREFIX}task_review_decisions_org_task_fk`,
    }).onDelete("cascade"),
    index(`${DB_TABLE_PREFIX}task_review_decisions_task_idx`).on(t.taskId, t.createdAt),
  ],
);

/** `taskId` blocks `relatedTaskId`. The direction people get backwards. */
export const taskRelations = pgTable(
  `${DB_TABLE_PREFIX}task_relations`,
  {
    organizationId: uuid("organization_id").notNull(),
    taskId: uuid("task_id").notNull(),
    relatedTaskId: uuid("related_task_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.relatedTaskId] }),
    foreignKey({
      columns: [t.organizationId, t.taskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: `${DB_TABLE_PREFIX}task_relations_org_blocker_fk`,
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.relatedTaskId],
      foreignColumns: [tasks.organizationId, tasks.id],
      name: `${DB_TABLE_PREFIX}task_relations_org_dependent_fk`,
    }).onDelete("cascade"),
    index(`${DB_TABLE_PREFIX}task_relations_dependent_idx`).on(t.relatedTaskId),
  ],
);

/**
 * A run's credential.
 *
 * Minted with the lease and revoked with it, so a token that leaks from a
 * crashed run is inert within seconds. The plaintext lives only in the child's
 * environment; this row holds a hash of it.
 */
export const runCredentials = pgTable(
  `${DB_TABLE_PREFIX}run_credentials`,
  {
    runId: uuid("run_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    responsibleUserId: text("responsible_user_id").notNull(),
    /** This run may touch this many tasks other than the one it is working. */
    crossTaskWriteLimit: integer("cross_task_write_limit").notNull().default(20),
    crossTaskWriteCount: integer("cross_task_write_count").notNull().default(0),
    /** The task the run claimed, if it claimed one. */
    currentTaskId: uuid("current_task_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex(`${DB_TABLE_PREFIX}run_credentials_hash_key`).on(t.tokenHash),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [agentRuns.id],
      name: `${DB_TABLE_PREFIX}run_credentials_run_fk`,
    }).onDelete("cascade"),
  ],
);

export const objectiveStatus = pgEnum(`${DB_TABLE_PREFIX}objective_status`, [
  "active",
  "satisfied",
  "exhausted",
  "paused",
  "abandoned",
]);

/**
 * A standing instruction with an exit condition.
 *
 * "Keep going until it is clean" is not a task — a task finishes when its work
 * is done. This is the primitive that lets an agent carry an order across many
 * runs and still be guaranteed to stop: every way out is explicit, and one of
 * them is always reachable.
 */
export const objectives = pgTable(
  `${DB_TABLE_PREFIX}objectives`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),

    title: text("title").notNull(),
    /** What the person actually said, verbatim. The agent reads this every cycle. */
    directive: text("directive").notNull(),
    ownerAgentId: uuid("owner_agent_id").notNull(),
    /** How anyone will know it is finished, in the person's words. */
    exitCriteria: text("exit_criteria").notNull(),

    status: objectiveStatus("status").notNull().default("active"),

    maxCycles: integer("max_cycles").notNull().default(10),
    cycleCount: integer("cycle_count").notNull().default(0),
    budgetCents: integer("budget_cents").notNull().default(0),
    spentCents: integer("spent_cents").notNull().default(0),
    /** Cycles that produced no new task and no new comment. */
    maxIdleCycles: integer("max_idle_cycles").notNull().default(2),
    idleCycles: integer("idle_cycles").notNull().default(0),

    outcome: text("outcome"),
    reportTaskId: uuid("report_task_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    unique(`${DB_TABLE_PREFIX}objectives_org_id_uq`).on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: `${DB_TABLE_PREFIX}objectives_org_project_fk`,
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.ownerAgentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}objectives_org_owner_fk`,
    }).onDelete("restrict"),
    // One standing order per agent per project. Two is no order at all.
    uniqueIndex(`${DB_TABLE_PREFIX}objectives_active_owner_key`)
      .on(t.projectId, t.ownerAgentId)
      .where(sql`status = 'active'`),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskCommentRow = typeof taskComments.$inferSelect;
export type TaskReviewDecisionRow = typeof taskReviewDecisions.$inferSelect;
export type RunCredentialRow = typeof runCredentials.$inferSelect;
export type ObjectiveRow = typeof objectives.$inferSelect;
