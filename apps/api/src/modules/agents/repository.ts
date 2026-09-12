// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agentConfigRevisions,
  agents,
  type AgentConfigRevisionRow,
  type AgentRow,
  type Database,
} from "@agentco/db";
import {
  AppError,
  CONFIG_REVISION_FIELDS,
  HIDDEN_AGENT_STATUSES,
  buildOrgTree,
  computeEligibility,
  computeOrgChainHealth,
  defaultAgentPermissions,
  slugify,
  type Agent,
  type AgentStatus,
  type CreateAgentInput,
  type ListAgentsQuery,
  type OrgChainNode,
  type PauseReason,
  type UpdateAgentInput,
} from "@agentco/shared";
import { adapterConfigValidator, isKnownAdapter } from "@agentco/adapters";
import { createInstructionRepository } from "@agentco/core";

const UNIQUE_VIOLATION = "23505";
const MAX_SLUG_ATTEMPTS = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    role: row.role as Agent["role"],
    title: row.title,
    icon: row.icon,
    capabilities: row.capabilities,
    reportsTo: row.reportsTo,
    adapterType: row.adapterType,
    adapterConfig: row.adapterConfig,
    status: row.status,
    pauseReason: (row.pauseReason as PauseReason | null) ?? null,
    pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
    errorReason: row.errorReason,
    permissions: row.permissions,
    budgetMonthlyCents: row.budgetMonthlyCents,
    spentMonthlyCents: row.spentMonthlyCents,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function encodeCursor(row: AgentRow): string {
  return Buffer.from(row.id, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_RE.test(id)) {
    throw new AppError("VALIDATION_FAILED", { cursor: "Cursor is not valid." });
  }
  return id;
}

type ConfigSnapshot = Record<string, unknown>;

function configSnapshot(row: AgentRow): ConfigSnapshot {
  const snapshot: ConfigSnapshot = {};
  for (const field of CONFIG_REVISION_FIELDS) snapshot[field] = row[field];
  return snapshot;
}

function changedConfigKeys(before: ConfigSnapshot, after: ConfigSnapshot): string[] {
  return CONFIG_REVISION_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

export function createAgentRepository(db: Database) {
  const instructions = createInstructionRepository(db);

  /** Every read is organization-scoped; no query may span two tenants. */
  async function findRow(organizationId: string, ref: string): Promise<AgentRow | null> {
    const match = UUID_RE.test(ref)
      ? eq(agents.id, ref)
      : eq(sql`lower(${agents.slug})`, ref.toLowerCase());
    const [row] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), match))
      .limit(1);
    return row ?? null;
  }

  async function requireRow(organizationId: string, ref: string): Promise<AgentRow> {
    const row = await findRow(organizationId, ref);
    if (!row) throw new AppError("AGENT_NOT_FOUND", { ref });
    return row;
  }

  async function orgNodes(organizationId: string): Promise<Map<string, OrgChainNode>> {
    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        status: agents.status,
        reportsTo: agents.reportsTo,
      })
      .from(agents)
      .where(eq(agents.organizationId, organizationId));
    return new Map(rows.map((row) => [row.id, row as OrgChainNode]));
  }

  /**
   * Refuses a reporting line that would close a loop, and a manager belonging
   * to another organization. The manager check cannot be a foreign key: the
   * reference is same-table, so there is no second column to compose against.
   */
  async function assertManagerValid(
    organizationId: string,
    agentId: string | null,
    reportsTo: string | null,
  ): Promise<void> {
    if (!reportsTo) return;
    if (reportsTo === agentId) {
      throw new AppError("AGENT_REPORTING_CYCLE", { detail: "An agent cannot report to itself." });
    }

    const nodes = await orgNodes(organizationId);
    if (!nodes.has(reportsTo)) throw new AppError("AGENT_MANAGER_NOT_FOUND", { reportsTo });
    if (!agentId) return;

    const seen = new Set<string>([agentId]);
    let cursor: string | null = reportsTo;
    while (cursor) {
      if (seen.has(cursor)) throw new AppError("AGENT_REPORTING_CYCLE", { agentId, reportsTo });
      seen.add(cursor);
      cursor = nodes.get(cursor)?.reportsTo ?? null;
    }
  }

  function assertAdapterConfigValid(adapterType: string, config: Record<string, unknown>): void {
    if (!isKnownAdapter(adapterType)) throw new AppError("UNKNOWN_ADAPTER", { adapterType });
    const result = adapterConfigValidator(adapterType).safeParse(config);
    if (!result.success) {
      throw new AppError("AGENT_ADAPTER_CONFIG_INVALID", {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
  }

  async function insertOnce(values: {
    organizationId: string;
    slug: string;
    input: CreateAgentInput;
  }): Promise<AgentRow> {
    const [row] = await db
      .insert(agents)
      .values({
        organizationId: values.organizationId,
        slug: values.slug,
        name: values.input.name,
        role: values.input.role,
        title: values.input.title ?? null,
        icon: values.input.icon ?? null,
        capabilities: values.input.capabilities ?? null,
        reportsTo: values.input.reportsTo ?? null,
        adapterType: values.input.adapterType,
        adapterConfig: values.input.adapterConfig,
        budgetMonthlyCents: values.input.budgetMonthlyCents,
        permissions: values.input.permissions ?? defaultAgentPermissions("create"),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL");
    return row;
  }

  return {
    async create(organizationId: string, input: CreateAgentInput): Promise<Agent> {
      assertAdapterConfigValid(input.adapterType, input.adapterConfig);
      await assertManagerValid(organizationId, null, input.reportsTo ?? null);

      // A hired agent always starts with an identity to read; an agent with no
      // instructions at all has nothing to be.
      const withInstructions = async (row: AgentRow) => {
        await instructions.seed(organizationId, row.id, row.name, row.role);
        return toAgent(row);
      };

      if (input.slug) {
        try {
          return await withInstructions(await insertOnce({ organizationId, slug: input.slug, input }));
        } catch (error) {
          if (isUniqueViolation(error)) throw new AppError("AGENT_SLUG_TAKEN", { slug: input.slug });
          throw error;
        }
      }

      const base = slugify(input.name);
      if (base.length < 2) throw new AppError("AGENT_SLUG_TAKEN", { name: input.name });

      // Insert-and-retry, not check-then-insert: only the unique index can
      // settle a race between two concurrent creates of the same name.
      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const slug = `${base.slice(0, 63 - suffix.length)}${suffix}`;
        try {
          return await withInstructions(await insertOnce({ organizationId, slug, input }));
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
      }
      throw new AppError("AGENT_SLUG_TAKEN", { name: input.name });
    },

    async list(
      organizationId: string,
      query: ListAgentsQuery,
    ): Promise<{ data: Agent[]; nextCursor: string | null }> {
      const filters = [eq(agents.organizationId, organizationId)];
      if (query.status) filters.push(eq(agents.status, query.status));
      // Terminated agents are structurally excluded, never merely filtered.
      else filters.push(sql`${agents.status} not in ('terminated')`);

      if (query.cursor) {
        const id = decodeCursor(query.cursor);
        filters.push(
          sql`(${agents.createdAt}, ${agents.id}) < (
            select ${agents.createdAt}, ${agents.id} from ${agents} where ${agents.id} = ${id}::uuid
          )`,
        );
      }

      const rows = await db
        .select()
        .from(agents)
        .where(and(...filters))
        .orderBy(desc(agents.createdAt), desc(agents.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        data: page.map(toAgent),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      };
    },

    async get(organizationId: string, ref: string) {
      const row = await requireRow(organizationId, ref);
      const nodes = await orgNodes(organizationId);
      const health = computeOrgChainHealth(row.id, nodes);
      const manager = row.reportsTo ? (nodes.get(row.reportsTo) ?? null) : null;

      return {
        ...toAgent(row),
        // Resolved here rather than on the client: a detail page should not have
        // to fetch the whole roster to render one name.
        manager: manager ? { id: manager.id, name: manager.name, status: manager.status } : null,
        orgChainHealth: health,
        eligibility: computeEligibility(row.status, health),
      };
    },

    /** Display tree. Agents whose manager is hidden are promoted, never lost. */
    async orgTree(organizationId: string) {
      const nodes = await orgNodes(organizationId);
      const visible = [...nodes.values()].filter(
        (node) => !HIDDEN_AGENT_STATUSES.includes(node.status),
      );
      return buildOrgTree(visible);
    },

    /**
     * One write path for every edit, so a rollback passes exactly the guards a
     * manual edit does and is recorded the same way.
     *
     * `source` is decided by the caller and written with the revision rather
     * than corrected afterwards. Relabelling the newest revision after the fact
     * looked equivalent and was not: a rollback that changed nothing writes no
     * revision at all, and the update then stamped "rollback" onto whatever
     * unrelated edit happened to be newest.
     */
    async applyUpdate(
      organizationId: string,
      ref: string,
      input: UpdateAgentInput,
      provenance: { source: "patch" | "rollback"; rolledBackFromRevisionId?: string },
    ): Promise<Agent> {
      const existing = await requireRow(organizationId, ref);

      if (existing.status === "terminated") throw new AppError("AGENT_TERMINATED");
      // An agent awaiting approval is frozen: otherwise the thing approved is
      // not the thing that runs.
      if (existing.status === "pending_approval") throw new AppError("AGENT_CONFIG_FROZEN");

      if (input.reportsTo !== undefined) {
        await assertManagerValid(organizationId, existing.id, input.reportsTo);
      }

      const adapterType = input.adapterType ?? existing.adapterType;
      const adapterConfig = input.adapterConfig ?? existing.adapterConfig;
      if (input.adapterType !== undefined || input.adapterConfig !== undefined) {
        assertAdapterConfigValid(adapterType, adapterConfig);
      }

      const before = configSnapshot(existing);

      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(agents)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.role !== undefined ? { role: input.role } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.icon !== undefined ? { icon: input.icon } : {}),
            ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
            ...(input.reportsTo !== undefined ? { reportsTo: input.reportsTo } : {}),
            ...(input.adapterType !== undefined ? { adapterType: input.adapterType } : {}),
            ...(input.adapterConfig !== undefined ? { adapterConfig: input.adapterConfig } : {}),
            ...(input.budgetMonthlyCents !== undefined
              ? { budgetMonthlyCents: input.budgetMonthlyCents }
              : {}),
            ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
          })
          .where(eq(agents.id, existing.id))
          .returning();
        if (!row) throw new AppError("AGENT_NOT_FOUND", { ref });

        const after = configSnapshot(row);
        const changedKeys = changedConfigKeys(before, after);

        // An unchanged save writes no revision — the history stays readable.
        if (changedKeys.length > 0) {
          await tx.insert(agentConfigRevisions).values({
            organizationId,
            agentId: row.id,
            source: provenance.source,
            ...(provenance.rolledBackFromRevisionId
              ? { rolledBackFromRevisionId: provenance.rolledBackFromRevisionId }
              : {}),
            changedKeys,
            beforeConfig: before,
            afterConfig: after,
          });
        }

        return toAgent(row);
      });
    },

    async update(organizationId: string, ref: string, input: UpdateAgentInput): Promise<Agent> {
      return this.applyUpdate(organizationId, ref, input, { source: "patch" });
    },

    /**
     * Status changes are atomic conditional updates, never read-then-write. A
     * transition landing between a read and a write would otherwise resurrect
     * an agent someone just paused.
     */
    async setStatus(
      organizationId: string,
      ref: string,
      next: AgentStatus,
      options: { from?: AgentStatus[]; pauseReason?: PauseReason } = {},
    ): Promise<Agent> {
      const existing = await requireRow(organizationId, ref);
      if (existing.status === "terminated" && next !== "terminated") {
        throw new AppError("AGENT_TERMINATED");
      }

      const guards = [eq(agents.id, existing.id)];
      if (options.from) guards.push(inArray(agents.status, options.from));

      const [row] = await db
        .update(agents)
        .set({
          status: next,
          pauseReason: next === "paused" ? (options.pauseReason ?? "manual") : null,
          pausedAt: next === "paused" ? new Date() : null,
          ...(next !== "error" ? { errorReason: null } : {}),
        })
        .where(and(...guards))
        .returning();

      if (!row) {
        // Zero rows means the guard failed, not that the agent vanished.
        if (next === "idle" && options.from?.includes("error")) {
          throw new AppError("AGENT_NOT_IN_ERROR");
        }
        throw new AppError("CONFLICT", { status: existing.status });
      }
      return toAgent(row);
    },

    async listRevisions(organizationId: string, ref: string): Promise<AgentConfigRevisionRow[]> {
      const existing = await requireRow(organizationId, ref);
      return db
        .select()
        .from(agentConfigRevisions)
        .where(
          and(
            eq(agentConfigRevisions.organizationId, organizationId),
            eq(agentConfigRevisions.agentId, existing.id),
          ),
        )
        .orderBy(desc(agentConfigRevisions.createdAt))
        .limit(100);
    },

    /**
     * Replays a revision's `after` snapshot as an ordinary patch, so a rollback
     * passes every guard a manual edit would. The result is recorded as a NEW
     * revision pointing at the one replayed — history is append-only, so
     * undoing a rollback is just another rollback.
     */
    async rollback(organizationId: string, ref: string, revisionId: string): Promise<Agent> {
      const existing = await requireRow(organizationId, ref);
      const [revision] = await db
        .select()
        .from(agentConfigRevisions)
        .where(
          and(
            eq(agentConfigRevisions.id, revisionId),
            eq(agentConfigRevisions.agentId, existing.id),
            eq(agentConfigRevisions.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!revision) throw new AppError("AGENT_REVISION_NOT_FOUND", { revisionId });

      const snapshot = revision.afterConfig;
      const patch: UpdateAgentInput = {
        name: snapshot["name"] as string,
        role: snapshot["role"] as UpdateAgentInput["role"],
        title: (snapshot["title"] as string | null) ?? null,
        icon: (snapshot["icon"] as string | null) ?? null,
        capabilities: (snapshot["capabilities"] as string | null) ?? null,
        reportsTo: (snapshot["reportsTo"] as string | null) ?? null,
        adapterType: snapshot["adapterType"] as string,
        adapterConfig: snapshot["adapterConfig"] as Record<string, unknown>,
        budgetMonthlyCents: snapshot["budgetMonthlyCents"] as number,
      };

      return this.applyUpdate(organizationId, ref, patch, {
        source: "rollback",
        rolledBackFromRevisionId: revision.id,
      });
    },
  };
}

export type AgentRepository = ReturnType<typeof createAgentRepository>;
