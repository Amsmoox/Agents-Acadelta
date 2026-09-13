// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
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

/**
 * The organization's skill library.
 *
 * The markdown is the skill: a `SKILL.md` whose header declares a name and a
 * description, and whose body is read only when an agent decides it applies.
 * Name and description are also stored as columns because they are read on
 * every prompt assembly, and parsing every document to build one manifest line
 * each would be wasteful.
 */
export const skills = pgTable(
  `${DB_TABLE_PREFIX}skills`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(),
    /**
     * The catalogue skill this was installed from, if any.
     *
     * Kept so the library can say where a document came from and whether it has
     * been changed since — not so the copy can be overwritten. Once installed
     * the skill belongs to the organization, and a catalogue that silently
     * rewrites somebody's edits is one nobody would trust enough to use.
     */
    catalogueSlug: text("catalogue_slug"),
    /** sha256 of the document as it shipped, to tell a modified copy from a pristine one. */
    catalogueHash: text("catalogue_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Lets child tables compose the organization into their foreign key, so a
    // skill can never be attached to an agent in another tenant.
    unique(`${DB_TABLE_PREFIX}skills_org_id_uq`).on(t.organizationId, t.id),
    uniqueIndex(`${DB_TABLE_PREFIX}skills_org_slug_key`).on(
      t.organizationId,
      sql`lower(${t.slug})`,
    ),
    index(`${DB_TABLE_PREFIX}skills_org_created_idx`).on(
      t.organizationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

/**
 * Which skills an agent has enabled.
 *
 * Enabling is what decides whether a skill is mounted into the agent's
 * workspace. Every skill in the organization still appears in the agent's
 * manifest, marked as not enabled — otherwise an agent cannot tell an
 * unavailable skill from one that does not exist.
 */
export const agentSkills = pgTable(
  `${DB_TABLE_PREFIX}agent_skills`,
  {
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    foreignKey({
      columns: [t.organizationId, t.agentId],
      foreignColumns: [agents.organizationId, agents.id],
      name: `${DB_TABLE_PREFIX}agent_skills_org_agent_fk`,
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.skillId],
      foreignColumns: [skills.organizationId, skills.id],
      name: `${DB_TABLE_PREFIX}agent_skills_org_skill_fk`,
    }).onDelete("cascade"),
    index(`${DB_TABLE_PREFIX}agent_skills_skill_idx`).on(t.skillId),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type AgentSkillRow = typeof agentSkills.$inferSelect;
