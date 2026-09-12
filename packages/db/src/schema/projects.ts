// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
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
import { organizations } from "./organizations.js";
import { agents } from "./agents.js";

export const projectStatus = pgEnum(`${DB_TABLE_PREFIX}project_status`, [
  "active",
  "paused",
  "archived",
]);

/**
 * A body of work.
 *
 * An organization is who works here; a project is what we are doing. The same
 * agents serve several projects at once, so an agent belongs to the
 * organization and a task belongs to a project — and membership below is the
 * separate relation that joins them.
 */
export const projects = pgTable(
  `${DB_TABLE_PREFIX}projects`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary"),
    /** Prose the agents read: what this is, who it is for, what "good" means. */
    brief: text("brief"),

    status: projectStatus("status").notNull().default("active"),

    /**
     * The sequence behind human-readable task keys, bumped inside the insert
     * that uses it. `select max(number)` would hand two concurrent creates the
     * same value and make the unique index reject a perfectly good task.
     */
    taskCounter: integer("task_counter").notNull().default(0),
    /** The "X" in X-14. Immutable once a task carries it. */
    taskPrefix: text("task_prefix").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // Not redundant with the primary key: it lets every child table declare a
    // composite foreign key (organization_id, project_id), which makes a
    // cross-tenant project reference impossible at the database level.
    unique(`${DB_TABLE_PREFIX}projects_org_id_uq`).on(t.organizationId, t.id),

    uniqueIndex(`${DB_TABLE_PREFIX}projects_org_slug_key`).on(
      t.organizationId,
      sql`lower(${t.slug})`,
    ),
    // Case-insensitive, because X-14 and x-14 must not name two different tasks.
    uniqueIndex(`${DB_TABLE_PREFIX}projects_org_prefix_key`).on(
      t.organizationId,
      sql`upper(${t.taskPrefix})`,
    ),
    index(`${DB_TABLE_PREFIX}projects_org_status_created_idx`).on(
      t.organizationId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

/**
 * Which agents may be assigned work on a project.
 *
 * Membership grants nothing on its own — it is the guard Phase 8 checks before
 * one agent files a task for another, not a record of who is busy.
 */
export const projectMembers = pgTable(
  `${DB_TABLE_PREFIX}project_members`,
  {
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    /** "lead" is where a question about the project as a whole goes. */
    role: text("role").notNull().default("member"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.agentId] }),

    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: `${DB_TABLE_PREFIX}project_members_org_project_fk`,
    }).onDelete("cascade"),
    // Composite again: an agent from another organization cannot be a member
    // here, and it is the database that refuses rather than a service check.
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}project_members_org_agent_fk`,
    }).onDelete("cascade"),

    // At most one lead. Two agents each believing they speak for the project is
    // a race between two concurrent writes, and only an index settles it.
    uniqueIndex(`${DB_TABLE_PREFIX}project_members_lead_key`)
      .on(t.projectId)
      .where(sql`role = 'lead'`),

    index(`${DB_TABLE_PREFIX}project_members_agent_idx`).on(t.agentId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
