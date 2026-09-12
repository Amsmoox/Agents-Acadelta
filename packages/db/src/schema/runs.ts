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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";
import { agents } from "./agents.js";

export const wakeupStatus = pgEnum(`${DB_TABLE_PREFIX}wakeup_status`, [
  "pending",
  "claimed",
  "skipped",
]);

export const runStatus = pgEnum(`${DB_TABLE_PREFIX}run_status`, [
  "leased",
  "running",
  "completed",
  "failed",
  "cancelled",
  "orphaned",
]);

/**
 * An agent's pending intent to run.
 *
 * The partial unique index below is the coalescing rule, and it is the whole
 * point of this table: at most one pending wakeup per agent, ever. Five
 * triggers arriving at once merge into one row rather than queueing five runs
 * that would each redo the others' work.
 */
export const agentWakeups = pgTable(
  `${DB_TABLE_PREFIX}agent_wakeups`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    /** Every trigger that merged into this one, in arrival order. */
    reasons: jsonb("reasons").$type<{ type: string; at: string; detail?: string }[]>()
      .notNull()
      .default([]),
    prompt: text("prompt"),
    status: wakeupStatus("status").notNull().default("pending"),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}agent_wakeups_org_agent_fk`,
    }).onDelete("cascade"),
    // THE coalescing primitive. A constraint, not application logic: only the
    // index can settle two triggers arriving in the same millisecond.
    uniqueIndex(`${DB_TABLE_PREFIX}agent_wakeups_pending_key`)
      .on(t.agentId)
      .where(sql`status = 'pending'`),
    index(`${DB_TABLE_PREFIX}agent_wakeups_ready_idx`).on(t.status, t.updatedAt),
  ],
);

/**
 * One execution. The lease that guarantees an agent is never running twice.
 */
export const agentRuns = pgTable(
  `${DB_TABLE_PREFIX}agent_runs`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    wakeupId: uuid("wakeup_id"),

    status: runStatus("status").notNull().default("leased"),
    /** Which runner process holds this run. */
    leasedBy: text("leased_by").notNull(),
    pid: integer("pid"),
    /** With the pid, tells a restarted runner whether the process is still ours. */
    pidStartedAt: timestamp("pid_started_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    /** Poison-pill counter: a run reaped repeatedly stops being retried. */
    reapCount: integer("reap_count").notNull().default(0),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),

    prompt: text("prompt").notNull(),
    systemPrompt: text("system_prompt"),
    transcriptPath: text("transcript_path"),

    exitCode: integer("exit_code"),
    stopReason: text("stop_reason"),
    error: text("error"),

    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),

    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}agent_runs_org_agent_fk`,
    }).onDelete("cascade"),
    // THE exactly-one-run primitive. Two dispatchers racing to start the same
    // agent: one insert wins, the other fails cleanly and moves on.
    uniqueIndex(`${DB_TABLE_PREFIX}agent_runs_active_key`)
      .on(t.agentId)
      .where(sql`status in ('leased', 'running')`),
    index(`${DB_TABLE_PREFIX}agent_runs_agent_created_idx`).on(t.agentId, t.createdAt.desc()),
    index(`${DB_TABLE_PREFIX}agent_runs_live_idx`).on(t.status, t.heartbeatAt),
  ],
);

/**
 * The run's transcript, as an append-only sequence.
 *
 * `seq` is monotonic per run so a reconnecting reader can resume from exactly
 * where it stopped rather than replaying the whole run or missing the middle.
 */
export const runEvents = pgTable(
  `${DB_TABLE_PREFIX}run_events`,
  {
    runId: uuid("run_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    foreignKey({
      columns: [t.runId],
      foreignColumns: [agentRuns.id],
      name: `${DB_TABLE_PREFIX}run_events_run_fk`,
    }).onDelete("cascade"),
  ],
);

export type AgentWakeupRow = typeof agentWakeups.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
