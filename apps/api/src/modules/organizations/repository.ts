// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, desc, eq, sql } from "drizzle-orm";
import { organizations, type Database, type OrganizationRow } from "@agentco/db";
import {
  AppError,
  slugify,
  type CreateOrganizationInput,
  type ListOrganizationsQuery,
  type Organization,
  type UpdateOrganizationInput,
} from "@agentco/shared";

const UNIQUE_VIOLATION = "23505";
const MAX_SLUG_ATTEMPTS = 6;

/**
 * Drizzle wraps driver errors, so the PostgreSQL SQLSTATE is not on the error
 * it throws — it sits further down the `cause` chain. Walk it rather than
 * reading `error.code` off the top, which silently never matches.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    mission: row.mission,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

/**
 * Keyset cursors carry the exact sort key of the last row seen, so a page never
 * skips or repeats a row when the table is written to between requests — which
 * OFFSET cannot promise.
 */
function encodeCursor(row: OrganizationRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.lastIndexOf("|");
  const createdAt = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (sep === -1 || Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new AppError("VALIDATION_FAILED", { cursor: "Cursor is not valid." });
  }
  return { createdAt, id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createOrganizationRepository(db: Database) {
  async function insertOnce(values: {
    slug: string;
    name: string;
    mission: string | null;
  }): Promise<OrganizationRow> {
    const [row] = await db.insert(organizations).values(values).returning();
    if (!row) throw new AppError("INTERNAL");
    return row;
  }

  return {
    async create(input: CreateOrganizationInput): Promise<Organization> {
      const mission = input.mission ?? null;

      // An explicit slug is taken at face value: a collision is the caller's
      // problem to resolve, not something to paper over with a suffix.
      if (input.slug) {
        try {
          return toOrganization(await insertOnce({ slug: input.slug, name: input.name, mission }));
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new AppError("ORGANIZATION_SLUG_TAKEN", { slug: input.slug });
          }
          throw error;
        }
      }

      const base = slugify(input.name);
      if (base.length < 2) {
        throw new AppError("ORGANIZATION_SLUG_UNAVAILABLE", { name: input.name });
      }

      // Insert-and-retry rather than check-then-insert: only the unique index
      // can settle a race between two concurrent creates of the same name.
      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const slug = `${base.slice(0, 63 - suffix.length)}${suffix}`;
        try {
          return toOrganization(await insertOnce({ slug, name: input.name, mission }));
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
      }
      throw new AppError("ORGANIZATION_SLUG_UNAVAILABLE", { name: input.name });
    },

    /** Accepts either a UUID or a slug, so URLs stay human-readable. */
    async findByRef(ref: string): Promise<Organization | null> {
      const where = UUID_RE.test(ref)
        ? eq(organizations.id, ref)
        : eq(sql`lower(${organizations.slug})`, ref.toLowerCase());
      const [row] = await db.select().from(organizations).where(where).limit(1);
      return row ? toOrganization(row) : null;
    },

    async requireByRef(ref: string): Promise<Organization> {
      const found = await this.findByRef(ref);
      if (!found) throw new AppError("ORGANIZATION_NOT_FOUND", { ref });
      return found;
    },

    async list(query: ListOrganizationsQuery): Promise<{
      data: Organization[];
      nextCursor: string | null;
    }> {
      const filters = [];
      if (query.status) filters.push(eq(organizations.status, query.status));
      if (query.cursor) {
        const { createdAt, id } = decodeCursor(query.cursor);
        filters.push(
          sql`(${organizations.createdAt}, ${organizations.id}) < (${createdAt.toISOString()}::timestamptz, ${id}::uuid)`,
        );
      }

      // Fetch one extra row to learn whether another page exists without a
      // second count query.
      const rows = await db
        .select()
        .from(organizations)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(organizations.createdAt), desc(organizations.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        data: page.map(toOrganization),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      };
    },

    async update(ref: string, input: UpdateOrganizationInput): Promise<Organization> {
      const existing = await this.requireByRef(ref);
      if (existing.status === "archived") {
        throw new AppError("ORGANIZATION_ARCHIVED", { slug: existing.slug });
      }

      const [row] = await db
        .update(organizations)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.mission !== undefined ? { mission: input.mission } : {}),
        })
        .where(eq(organizations.id, existing.id))
        .returning();
      if (!row) throw new AppError("ORGANIZATION_NOT_FOUND", { ref });
      return toOrganization(row);
    },

    /** Archive and restore are idempotent: repeating one is not an error. */
    async setArchived(ref: string, archived: boolean): Promise<Organization> {
      const existing = await this.requireByRef(ref);
      const [row] = await db
        .update(organizations)
        .set({
          status: archived ? "archived" : "active",
          archivedAt: archived ? new Date() : null,
        })
        .where(eq(organizations.id, existing.id))
        .returning();
      if (!row) throw new AppError("ORGANIZATION_NOT_FOUND", { ref });
      return toOrganization(row);
    },
  };
}

export type OrganizationRepository = ReturnType<typeof createOrganizationRepository>;
