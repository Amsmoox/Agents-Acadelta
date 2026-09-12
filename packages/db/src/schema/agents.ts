// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";
import { organizations } from "./organizations.js";

export const agentStatus = pgEnum(`${DB_TABLE_PREFIX}agent_status`, [
  "pending_approval",
  "idle",
  "running",
  "paused",
  "error",
  "terminated",
]);

/**
 * An agent is four separable things in one row: identity (name, role, title,
 * reporting line), harness (adapter type and its config), governance (status,
 * permissions, budget) and live state (last heartbeat).
 *
 * `adapter_config` is deliberately schemaless at this layer. Its shape is owned
 * by the adapter definition, which declares the fields and generates both the
 * validator and the form — so a new adapter needs no migration here.
 */
export const agents = pgTable(
  `${DB_TABLE_PREFIX}agents`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),

    // identity
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    role: text("role").notNull().default("general"),
    title: text("title"),
    icon: text("icon"),
    capabilities: text("capabilities"),
    reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id, {
      onDelete: "set null",
    }),

    // harness
    adapterType: text("adapter_type").notNull(),
    adapterConfig: jsonb("adapter_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    // governance
    status: agentStatus("status").notNull().default("idle"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    errorReason: text("error_reason"),
    permissions: jsonb("permissions").$type<Record<string, unknown>>().notNull().default({}),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),

    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Not redundant with the primary key. This lets every child table declare a
    // COMPOSITE foreign key (organization_id, agent_id), which makes a
    // cross-tenant agent reference impossible at the database level. A plain
    // `agent_id REFERENCES agents(id)` will happily point at another org's agent.
    unique(`${DB_TABLE_PREFIX}agents_org_id_uq`).on(t.organizationId, t.id),

    uniqueIndex(`${DB_TABLE_PREFIX}agents_org_slug_key`).on(t.organizationId, sql`lower(${t.slug})`),
    index(`${DB_TABLE_PREFIX}agents_org_status_idx`).on(t.organizationId, t.status),
    index(`${DB_TABLE_PREFIX}agents_org_reports_to_idx`).on(t.organizationId, t.reportsTo),
    index(`${DB_TABLE_PREFIX}agents_org_created_idx`).on(
      t.organizationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
