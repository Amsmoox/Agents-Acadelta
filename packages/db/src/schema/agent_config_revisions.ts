// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import { foreignKey, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";
import { organizations } from "./organizations.js";
import { agents } from "./agents.js";

/**
 * Append-only history of an agent's configuration.
 *
 * Full before/after snapshots rather than diffs: a diff is only meaningful
 * against a schema that has not changed, and this history has to stay readable
 * across versions. A rollback writes a NEW revision pointing at the one it
 * replayed — history is never rewritten, so undoing a rollback is just another
 * rollback.
 */
export const agentConfigRevisions = pgTable(
  `${DB_TABLE_PREFIX}agent_config_revisions`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),

    /** Where the change came from: "patch" or "rollback". */
    source: text("source").notNull().default("patch"),
    rolledBackFromRevisionId: uuid("rolled_back_from_revision_id"),

    /** Only the fields that actually differed. An unchanged save writes nothing. */
    changedKeys: jsonb("changed_keys").$type<string[]>().notNull().default([]),
    beforeConfig: jsonb("before_config").$type<Record<string, unknown>>().notNull(),
    afterConfig: jsonb("after_config").$type<Record<string, unknown>>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The composite reference the unique constraint on agents exists for: a
    // revision can only ever point at an agent inside its own organization.
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}agent_config_revisions_org_agent_fk`,
    }).onDelete("cascade"),

    index(`${DB_TABLE_PREFIX}agent_config_revisions_agent_created_idx`).on(
      t.agentId,
      t.createdAt.desc(),
    ),
  ],
);

export type AgentConfigRevisionRow = typeof agentConfigRevisions.$inferSelect;
