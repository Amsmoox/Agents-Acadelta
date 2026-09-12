// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agents,
  projectMembers,
  projects,
  type Database,
  type ProjectRow,
} from "@agentco/db";
import {
  AppError,
  HIDDEN_AGENT_STATUSES,
  deriveTaskPrefix,
  slugify,
  type CreateProjectInput,
  type ListProjectsQuery,
  type Project,
  type ProjectMember,
  type SetProjectMembersInput,
  type UpdateProjectInput,
} from "@agentco/shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";
const MAX_ATTEMPTS = 6;

/** Drizzle wraps driver errors, so the SQLSTATE sits down the cause chain. */
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

/** Which of the two unique indexes rejected the insert. */
function violatedConstraint(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current === "object" && "constraint" in current) {
      const name = (current as { constraint?: unknown }).constraint;
      if (typeof name === "string") return name;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function toProject(row: ProjectRow, memberCount: number): Project {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    brief: row.brief,
    status: row.status,
    taskPrefix: row.taskPrefix,
    memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function encodeCursor(row: ProjectRow): string {
  return Buffer.from(row.id, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_RE.test(id)) {
    throw new AppError("VALIDATION_FAILED", { cursor: "Cursor is not valid." });
  }
  return id;
}

export function createProjectRepository(db: Database) {
  async function findRow(organizationId: string, ref: string): Promise<ProjectRow | null> {
    const match = UUID_RE.test(ref)
      ? eq(projects.id, ref)
      : eq(sql`lower(${projects.slug})`, ref.toLowerCase());
    const [row] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), match))
      .limit(1);
    return row ?? null;
  }

  async function requireRow(organizationId: string, ref: string): Promise<ProjectRow> {
    const row = await findRow(organizationId, ref);
    if (!row) throw new AppError("PROJECT_NOT_FOUND", { ref });
    return row;
  }

  async function memberCount(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    return row?.value ?? 0;
  }

  async function insertOnce(values: {
    organizationId: string;
    slug: string;
    taskPrefix: string;
    input: CreateProjectInput;
  }): Promise<ProjectRow> {
    const [row] = await db
      .insert(projects)
      .values({
        organizationId: values.organizationId,
        slug: values.slug,
        taskPrefix: values.taskPrefix,
        name: values.input.name,
        summary: values.input.summary ?? null,
        brief: values.input.brief ?? null,
      })
      .returning();
    if (!row) throw new AppError("INTERNAL");
    return row;
  }

  return {
    /**
     * Insert-and-retry rather than check-then-insert: two concurrent creates of
     * the same name both find nothing free, and only the unique index can
     * settle which of them gets it.
     *
     * There are two names to settle here, not one. An explicit value is taken
     * at face value and a collision is reported; a derived one is suffixed and
     * retried, and the constraint name says which of the two to vary.
     */
    async create(organizationId: string, input: CreateProjectInput): Promise<Project> {
      const explicitSlug = input.slug;
      const explicitPrefix = input.taskPrefix;

      const baseSlug = explicitSlug ?? slugify(input.name);
      if (!explicitSlug && baseSlug.length < 2) {
        throw new AppError("PROJECT_SLUG_UNAVAILABLE", { name: input.name });
      }

      const basePrefix = explicitPrefix ?? deriveTaskPrefix(input.name);
      if (!explicitPrefix && basePrefix.length < 1) {
        throw new AppError("PROJECT_PREFIX_UNAVAILABLE", { name: input.name });
      }

      let slugAttempt = 0;
      let prefixAttempt = 0;

      for (let attempt = 0; attempt < MAX_ATTEMPTS * 2; attempt += 1) {
        const slugSuffix = slugAttempt === 0 ? "" : `-${slugAttempt + 1}`;
        const slug = explicitSlug ?? `${baseSlug.slice(0, 63 - slugSuffix.length)}${slugSuffix}`;

        const prefixSuffix = prefixAttempt === 0 ? "" : String(prefixAttempt + 1);
        const taskPrefix =
          explicitPrefix ?? `${basePrefix.slice(0, 6 - prefixSuffix.length)}${prefixSuffix}`;

        try {
          const row = await insertOnce({ organizationId, slug, taskPrefix, input });
          return toProject(row, 0);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;

          const constraint = violatedConstraint(error) ?? "";
          const prefixClashed = constraint.includes("prefix");

          if (prefixClashed) {
            if (explicitPrefix) throw new AppError("PROJECT_PREFIX_TAKEN", { taskPrefix });
            prefixAttempt += 1;
            if (prefixAttempt >= MAX_ATTEMPTS) {
              throw new AppError("PROJECT_PREFIX_UNAVAILABLE", { name: input.name });
            }
          } else {
            if (explicitSlug) throw new AppError("PROJECT_SLUG_TAKEN", { slug });
            slugAttempt += 1;
            if (slugAttempt >= MAX_ATTEMPTS) {
              throw new AppError("PROJECT_SLUG_UNAVAILABLE", { name: input.name });
            }
          }
        }
      }

      throw new AppError("PROJECT_SLUG_UNAVAILABLE", { name: input.name });
    },

    async list(
      organizationId: string,
      query: ListProjectsQuery,
    ): Promise<{ data: Project[]; nextCursor: string | null }> {
      const filters = [eq(projects.organizationId, organizationId)];
      if (query.status) filters.push(eq(projects.status, query.status));

      if (query.cursor) {
        const id = decodeCursor(query.cursor);
        const [anchor] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, id)))
          .limit(1);
        if (!anchor) throw new AppError("PAGE_CURSOR_EXPIRED");

        filters.push(
          sql`(${projects.createdAt}, ${projects.id}) < (
            select ${projects.createdAt}, ${projects.id} from ${projects}
             where ${projects.id} = ${id}::uuid
               and ${projects.organizationId} = ${organizationId}::uuid
          )`,
        );
      }

      const rows = await db
        .select()
        .from(projects)
        .where(and(...filters))
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);

      // One grouped count rather than a query per row: a list of twenty
      // projects should not be twenty-one round trips.
      const counts = new Map<string, number>();
      if (page.length > 0) {
        const grouped = await db
          .select({ projectId: projectMembers.projectId, value: count() })
          .from(projectMembers)
          .where(eq(projectMembers.organizationId, organizationId))
          .groupBy(projectMembers.projectId);
        for (const row of grouped) counts.set(row.projectId, row.value);
      }

      const last = page.at(-1);
      return {
        data: page.map((row) => toProject(row, counts.get(row.id) ?? 0)),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      };
    },

    async get(organizationId: string, ref: string): Promise<Project> {
      const row = await requireRow(organizationId, ref);
      return toProject(row, await memberCount(row.id));
    },

    async requireActive(organizationId: string, ref: string): Promise<ProjectRow> {
      const row = await requireRow(organizationId, ref);
      if (row.status === "archived") throw new AppError("PROJECT_ARCHIVED", { slug: row.slug });
      return row;
    },

    async update(
      organizationId: string,
      ref: string,
      input: UpdateProjectInput,
    ): Promise<Project> {
      const existing = await this.requireActive(organizationId, ref);

      const [row] = await db
        .update(projects)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.brief !== undefined ? { brief: input.brief } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        })
        .where(eq(projects.id, existing.id))
        .returning();
      if (!row) throw new AppError("PROJECT_NOT_FOUND", { ref });
      return toProject(row, await memberCount(row.id));
    },

    /**
     * Archiving refuses while work is still open, and says how much.
     *
     * Tasks arrive in the next phase; until they do there is nothing to count,
     * and the guard is written here so that adding the count is one query
     * rather than a rule somebody has to remember to add.
     */
    async setArchived(organizationId: string, ref: string, archived: boolean): Promise<Project> {
      const existing = await requireRow(organizationId, ref);

      if (archived) {
        const open = await this.countOpenWork(existing.id);
        if (open > 0) throw new AppError("PROJECT_HAS_OPEN_WORK", { open, slug: existing.slug });
      }

      const [row] = await db
        .update(projects)
        .set({
          status: archived ? "archived" : "active",
          archivedAt: archived ? new Date() : null,
        })
        .where(eq(projects.id, existing.id))
        .returning();
      if (!row) throw new AppError("PROJECT_NOT_FOUND", { ref });
      return toProject(row, await memberCount(row.id));
    },

    /** Non-terminal tasks in the project. Zero until tasks exist. */
    async countOpenWork(_projectId: string): Promise<number> {
      return 0;
    },

    async members(organizationId: string, ref: string): Promise<ProjectMember[]> {
      const project = await requireRow(organizationId, ref);

      const rows = await db
        .select({
          agentId: projectMembers.agentId,
          role: projectMembers.role,
          addedAt: projectMembers.addedAt,
          name: agents.name,
          slug: agents.slug,
          status: agents.status,
          adapterType: agents.adapterType,
          title: agents.title,
        })
        .from(projectMembers)
        .innerJoin(agents, eq(agents.id, projectMembers.agentId))
        .where(eq(projectMembers.projectId, project.id))
        // The lead first, then by name: a roster is read, not scrolled.
        .orderBy(desc(sql`${projectMembers.role} = 'lead'`), asc(agents.name));

      return rows.map((row) => ({
        agentId: row.agentId,
        role: row.role as ProjectMember["role"],
        name: row.name,
        slug: row.slug,
        status: row.status,
        adapterType: row.adapterType,
        title: row.title,
        addedAt: row.addedAt.toISOString(),
      }));
    },

    /**
     * Replaces the membership whole.
     *
     * In one transaction, so a reader never sees a project with no members
     * between the delete and the insert — and so two callers writing different
     * leads cannot both succeed.
     */
    async setMembers(
      organizationId: string,
      ref: string,
      input: SetProjectMembersInput,
    ): Promise<ProjectMember[]> {
      const project = await this.requireActive(organizationId, ref);

      if (input.members.length > 0) {
        const ids = input.members.map((member) => member.agentId);
        const found = await db
          .select({ id: agents.id, status: agents.status, name: agents.name })
          .from(agents)
          .where(and(eq(agents.organizationId, organizationId), inArray(agents.id, ids)));

        // Named rather than counted: "one of these does not exist" is not
        // something anyone can act on.
        const foundIds = new Set(found.map((row) => row.id));
        const missing = ids.filter((id) => !foundIds.has(id));
        if (missing.length > 0) throw new AppError("AGENT_NOT_FOUND", { agentIds: missing });

        const unusable = found.filter((row) => HIDDEN_AGENT_STATUSES.includes(row.status));
        if (unusable.length > 0) {
          throw new AppError("PROJECT_MEMBER_NOT_ASSIGNABLE", {
            agents: unusable.map((row) => ({ id: row.id, name: row.name, status: row.status })),
          });
        }
      }

      await db.transaction(async (tx) => {
        await tx.delete(projectMembers).where(eq(projectMembers.projectId, project.id));
        if (input.members.length > 0) {
          await tx.insert(projectMembers).values(
            input.members.map((member) => ({
              organizationId,
              projectId: project.id,
              agentId: member.agentId,
              role: member.role,
            })),
          );
        }
      });

      return this.members(organizationId, ref);
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
