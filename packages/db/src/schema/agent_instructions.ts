// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import { foreignKey, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";
import { agents } from "./agents.js";

/**
 * An agent's instruction bundle: the files that are its identity.
 *
 * A bundle rather than one field, because an agent's identity is not one
 * paragraph. `AGENTS.md` is the entry file, and siblings such as `HEARTBEAT.md`
 * or `SOUL.md` are referenced from it — that is how a role is actually written.
 *
 * The database is the source of truth and disk is a cache, so a bundle survives
 * a redeploy, exports with the organization, and is reachable from a second
 * node. Keeping the bytes on disk only would make each of those a problem.
 */
export const agentInstructionFiles = pgTable(
  `${DB_TABLE_PREFIX}agent_instruction_files`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    /** Relative to the bundle root, e.g. `AGENTS.md` or `references/tone.md`. */
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}agent_instruction_files_org_agent_fk`,
    }).onDelete("cascade"),
    // Case-sensitive: these are file paths, and two files differing only in
    // case are two files on every filesystem this will ever be written to.
    uniqueIndex(`${DB_TABLE_PREFIX}agent_instruction_files_agent_path_key`).on(t.agentId, t.path),
  ],
);

export type AgentInstructionFileRow = typeof agentInstructionFiles.$inferSelect;
