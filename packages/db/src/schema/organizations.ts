// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DB_TABLE_PREFIX } from "@agentco/shared";

export const organizationStatus = pgEnum(`${DB_TABLE_PREFIX}organization_status`, [
  "active",
  "archived",
]);

/**
 * The tenant boundary. Every other table in this system carries an
 * `organization_id` referencing this one, and no query may span two rows here.
 *
 * Identifiers are UUIDv7: time-ordered, so they cluster well in a btree the way
 * a serial does, without exposing a guessable sequence in URLs. `uuidv7()` is a
 * PostgreSQL 18 builtin — this schema requires PG 18 or newer.
 *
 * Organizations are archived, never deleted. A delete would cascade across every
 * task, run, cost event and audit row in the tenant, which is precisely the
 * history an audit trail exists to keep.
 */
export const organizations = pgTable(
  `${DB_TABLE_PREFIX}organizations`,
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    mission: text("mission"),
    status: organizationStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // Case-insensitive uniqueness: "Acme" and "acme" must not both exist, and
    // the database is what guarantees it — not a check-then-insert in the app.
    uniqueIndex(`${DB_TABLE_PREFIX}organizations_slug_lower_key`).on(sql`lower(${t.slug})`),
    // Serves the default listing: active organizations, newest first, keyset
    // paginated on (created_at, id).
    index(`${DB_TABLE_PREFIX}organizations_status_created_idx`).on(
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
