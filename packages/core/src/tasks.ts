// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  agents,
  projectMembers,
  projects,
  taskComments,
  taskRelations,
  taskReviewDecisions,
  tasks,
  type Database,
  type TaskRow,
} from "@agentco/db";
import {
  AppError,
  CLAIMABLE_STATUSES,
  MAX_NO_PROGRESS_RUNS,
  MAX_REVIEW_ROUNDS,
  MAX_TASK_DEPTH,
  isTerminalTaskStatus,
  taskStatusSideEffects,
  type CommentIntent,
  type CreateTaskInput,
  type ListTasksQuery,
  type ReviewPolicy,
  type ReviewState,
  type Task,
  type TaskComment,
  type TaskStatus,
  type UpdateTaskInput,
} from "@agentco/shared";

const UNIQUE_VIOLATION = "23505";

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

export type Actor =
  | { type: "user"; userId: string }
  | { type: "agent"; agentId: string; runId: string; userId: string };

function actorAgentId(actor: Actor): string | null {
  return actor.type === "agent" ? actor.agentId : null;
}

function actorRunId(actor: Actor): string | null {
  return actor.type === "agent" ? actor.runId : null;
}

export function createTaskRepository(db: Database) {
  /**
   * Reads a task with everything a screen or a prompt needs beside it, so
   * neither has to make five more round trips to render one row.
   */
  async function hydrate(rows: TaskRow[]): Promise<Task[]> {
    if (rows.length === 0) return [];

    const agentIds = [
      ...new Set(
        rows.flatMap((r) => [r.assigneeAgentId, r.createdByAgentId].filter(Boolean) as string[]),
      ),
    ];
    const people =
      agentIds.length > 0
        ? await db
            .select({ id: agents.id, name: agents.name, slug: agents.slug })
            .from(agents)
            .where(inArray(agents.id, agentIds))
        : [];
    const byId = new Map(people.map((p) => [p.id, p]));

    const ids = rows.map((r) => r.id);
    const blockers = await db
      .select({
        dependent: taskRelations.relatedTaskId,
        id: tasks.id,
        key: tasks.key,
        title: tasks.title,
        status: tasks.status,
      })
      .from(taskRelations)
      .innerJoin(tasks, eq(tasks.id, taskRelations.taskId))
      .where(inArray(taskRelations.relatedTaskId, ids));

    const children = await db
      .select({ parentId: tasks.parentId, value: sql<number>`count(*)::int` })
      .from(tasks)
      .where(inArray(tasks.parentId, ids))
      .groupBy(tasks.parentId);
    const childCount = new Map(children.map((c) => [c.parentId as string, c.value]));

    return rows.map((row) => {
      const assignee = row.assigneeAgentId ? byId.get(row.assigneeAgentId) : undefined;
      const creator = row.createdByAgentId ? byId.get(row.createdByAgentId) : undefined;
      return {
        id: row.id,
        organizationId: row.organizationId,
        projectId: row.projectId,
        key: row.key,
        number: row.number,
        title: row.title,
        description: row.description,
        kind: row.kind,
        priority: row.priority,
        status: row.status,
        parentId: row.parentId,
        depth: row.depth,
        assigneeAgentId: row.assigneeAgentId,
        assigneeName: assignee?.name ?? null,
        assigneeSlug: assignee?.slug ?? null,
        responsibleUserId: row.responsibleUserId,
        createdByAgentId: row.createdByAgentId,
        createdByName: creator?.name ?? null,
        createdByRunId: row.createdByRunId,
        objectiveId: row.objectiveId,
        reviewPolicy: row.reviewPolicy as ReviewPolicy,
        reviewState: (row.reviewStateJson as ReviewState | null) ?? null,
        blockedBy: blockers
          .filter((b) => b.dependent === row.id)
          .map((b) => ({ id: b.id, key: b.key, title: b.title, status: b.status })),
        childCount: childCount.get(row.id) ?? 0,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async function requireRow(organizationId: string, ref: string): Promise<TaskRow> {
    const [row] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          sql`(${tasks.id}::text = ${ref} or upper(${tasks.key}) = upper(${ref}))`,
        ),
      )
      .limit(1);
    if (!row) throw new AppError("TASK_NOT_FOUND", { ref });
    return row;
  }

  /**
   * Refuses a delegation that closes a loop.
   *
   * Two agents that each believe the other is the expert will hand the same
   * work back and forth forever, quietly, at full price — and because every
   * task in the chain stays open, nothing ever reports it.
   */
  async function assertNoDelegationCycle(
    organizationId: string,
    parentId: string | null,
    targetAgentId: string | null,
  ): Promise<void> {
    if (!parentId || !targetAgentId) return;

    const rows = await db.execute<{ id: string }>(sql`
      with recursive chain as (
        select id, parent_id, assignee_agent_id, created_by_agent_id, status
          from ${tasks} where id = ${parentId}::uuid and organization_id = ${organizationId}::uuid
        union all
        select t.id, t.parent_id, t.assignee_agent_id, t.created_by_agent_id, t.status
          from ${tasks} t join chain c on t.id = c.parent_id
      )
      select id from chain
       where status not in ('done', 'cancelled')
         and (assignee_agent_id = ${targetAgentId}::uuid
              or created_by_agent_id = ${targetAgentId}::uuid)
       limit 1
    `);
    if (rows.rows.length > 0) throw new AppError("TASK_DELEGATION_CYCLE", { agentId: targetAgentId });
  }

  async function assertMember(
    organizationId: string,
    projectId: string,
    agentId: string,
  ): Promise<void> {
    const [row] = await db
      .select({ agentId: projectMembers.agentId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.organizationId, organizationId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.agentId, agentId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError("TASK_ASSIGNEE_NOT_MEMBER", { agentId });
  }

  return {
    hydrate,
    requireRow,

    /**
     * Creates a task.
     *
     * The number comes from bumping a counter on the project inside this
     * transaction. `select max(number)` hands two concurrent creates the same
     * value, and the unique index then rejects one of them for no good reason.
     */
    async create(
      organizationId: string,
      projectId: string,
      input: CreateTaskInput,
      actor: Actor,
      options: { objectiveId?: string | null } = {},
    ): Promise<Task> {
      let parent: TaskRow | null = null;
      if (input.parentId) {
        const [row] = await db
          .select()
          .from(tasks)
          .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, input.parentId)))
          .limit(1);
        if (!row) throw new AppError("TASK_NOT_FOUND", { ref: input.parentId });
        parent = row;
      }

      const depth = parent ? parent.depth + 1 : 0;
      if (depth > MAX_TASK_DEPTH) throw new AppError("TASK_DEPTH_EXCEEDED", { depth });

      if (input.assigneeAgentId) {
        await assertMember(organizationId, projectId, input.assigneeAgentId);
        await assertNoDelegationCycle(organizationId, input.parentId ?? null, input.assigneeAgentId);
      }

      // Authority is inherited, never supplied. An agent cannot delegate itself
      // more than it has, so a chain of tasks cannot launder permission.
      const responsibleUserId = parent ? parent.responsibleUserId : actor.userId;

      const row = await db.transaction(async (tx) => {
        const [project] = await tx
          .update(projects)
          .set({ taskCounter: sql`${projects.taskCounter} + 1` })
          .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId)))
          .returning({ counter: projects.taskCounter, prefix: projects.taskPrefix });
        if (!project) throw new AppError("PROJECT_NOT_FOUND", { ref: projectId });

        const [created] = await tx
          .insert(tasks)
          .values({
            organizationId,
            projectId,
            number: project.counter,
            key: `${project.prefix}-${project.counter}`,
            title: input.title,
            description: input.description ?? null,
            kind: input.kind,
            priority: input.priority,
            status: input.status,
            parentId: input.parentId ?? null,
            depth,
            assigneeAgentId: input.assigneeAgentId ?? null,
            responsibleUserId,
            createdByAgentId: actorAgentId(actor),
            createdByRunId: actorRunId(actor),
            ...(options.objectiveId ? { objectiveId: options.objectiveId } : {}),
            ...(input.reviewPolicy ? { reviewPolicy: input.reviewPolicy } : {}),
          })
          .returning();
        if (!created) throw new AppError("INTERNAL");
        return created;
      });

      // After the insert, and deliberately so: a cycle check needs the row to
      // exist. A failure here leaves a real task with fewer blockers than
      // asked for rather than a phantom, so it is reported against the task
      // rather than swallowed.
      if (input.blockedBy?.length) {
        for (const blockerId of input.blockedBy) {
          await this.addBlocker(organizationId, row.id, blockerId);
        }
      }

      const [task] = await hydrate([row]);
      return task!;
    },

    async createSafely(
      organizationId: string,
      projectId: string,
      input: CreateTaskInput,
      actor: Actor,
      options: { objectiveId?: string | null } = {},
    ): Promise<Task> {
      try {
        return await this.create(organizationId, projectId, input, actor, options);
      } catch (error) {
        // The open-duplicate index did its job. Tell the caller which task
        // already covers it — a model given a bare conflict retries five times.
        if (isUniqueViolation(error)) {
          const existing = await db
            .select({ key: tasks.key })
            .from(tasks)
            .where(
              and(
                eq(tasks.projectId, projectId),
                sql`lower(regexp_replace(${tasks.title}, '\\s+', ' ', 'g')) = lower(regexp_replace(${input.title}, '\\s+', ' ', 'g'))`,
                sql`${tasks.status} not in ('done','cancelled')`,
              ),
            )
            .limit(1);
          throw new AppError("TASK_DUPLICATE", { existing: existing[0]?.key ?? null });
        }
        throw error;
      }
    },

    async list(
      organizationId: string,
      projectId: string | null,
      query: ListTasksQuery,
    ): Promise<Task[]> {
      const filters = [eq(tasks.organizationId, organizationId)];
      if (projectId) filters.push(eq(tasks.projectId, projectId));
      if (query.status) filters.push(eq(tasks.status, query.status));
      if (query.assigneeAgentId) filters.push(eq(tasks.assigneeAgentId, query.assigneeAgentId));
      if (query.kind) filters.push(eq(tasks.kind, query.kind));
      if (query.objectiveId) filters.push(eq(tasks.objectiveId, query.objectiveId));
      if (query.parentId) filters.push(eq(tasks.parentId, query.parentId));

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...filters))
        .orderBy(asc(tasks.number))
        .limit(query.limit);

      return hydrate(rows);
    },

    async get(organizationId: string, ref: string): Promise<Task> {
      const [task] = await hydrate([await requireRow(organizationId, ref)]);
      return task!;
    },

    async update(
      organizationId: string,
      ref: string,
      input: UpdateTaskInput,
      actor: Actor,
    ): Promise<Task> {
      const existing = await requireRow(organizationId, ref);
      if (isTerminalTaskStatus(existing.status)) throw new AppError("TASK_TERMINAL");

      if (input.assigneeAgentId) {
        await assertMember(organizationId, existing.projectId, input.assigneeAgentId);
        // The same guard filing has. Handing a task to an agent that already
        // owns an open ancestor of it closes the loop just as surely as filing
        // one would, and this route was the way around it.
        await assertNoDelegationCycle(organizationId, existing.parentId, input.assigneeAgentId);
      }

      // Moving an in-review task to somebody else changes who is judging it, so
      // the recorded reviewer moves with it; otherwise the state would name an
      // agent who no longer holds the task.
      const reviewState =
        existing.status === "in_review" && input.assigneeAgentId !== undefined
          ? {
              ...((existing.reviewStateJson as ReviewState | null) ?? {
                status: "pending" as const,
                changesRequestedCount: 0,
              }),
              reviewerAgentId: input.assigneeAgentId,
            }
          : null;

      const [row] = await db
        .update(tasks)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.assigneeAgentId !== undefined
            ? { assigneeAgentId: input.assigneeAgentId }
            : {}),
          ...(input.reviewPolicy !== undefined ? { reviewPolicy: input.reviewPolicy } : {}),
          ...(reviewState ? { reviewStateJson: reviewState } : {}),
        })
        .where(eq(tasks.id, existing.id))
        .returning();
      if (!row) throw new AppError("TASK_NOT_FOUND", { ref });

      if (input.assigneeAgentId && input.assigneeAgentId !== existing.assigneeAgentId) {
        await this.comment(
          organizationId,
          row.id,
          `Assigned to this agent.`,
          "handoff",
          actor,
        );
      }

      const [task] = await hydrate([row]);
      return task!;
    },

    /**
     * Claims a task for a run. One statement, and the WHERE is the lock.
     *
     * There is no SELECT before it: between a read and a write another runner
     * can take the same task, and the only thing that settles that is the row's
     * own pre-image being part of the update's condition. Zero rows back means
     * somebody else has it.
     */
    async claim(taskId: string, runId: string, agentId: string): Promise<TaskRow | null> {
      const [row] = await db
        .update(tasks)
        .set({
          // Picking up work starts it — unless it is in review, which is
          // already the right place for it and where the reviewer expects it.
          status: sql`case when ${tasks.status} = 'in_review'
                           then 'in_review'::${sql.raw(`${"agc_"}task_status`)}
                           else 'in_progress'::${sql.raw(`${"agc_"}task_status`)} end`,
          claimedByRunId: runId,
          claimedAt: new Date(),
          lastRunId: runId,
          startedAt: sql`coalesce(${tasks.startedAt}, now())`,
          statusVersion: sql`${tasks.statusVersion} + 1`,
        })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.assigneeAgentId, agentId),
            inArray(tasks.status, [...CLAIMABLE_STATUSES]),
            sql`(${tasks.claimedByRunId} is null or ${tasks.claimedByRunId} = ${runId}::uuid)`,
          ),
        )
        .returning();
      return row ?? null;
    },

    /**
     * The next task a run should pick up: highest priority, then oldest.
     *
     * Tries each candidate in turn rather than only the first, because between
     * choosing one and claiming it somebody else may have taken it — and the
     * second-best task is a better outcome than an idle run.
     */
    async claimNextFor(agentId: string, runId: string): Promise<TaskRow | null> {
      // Ordered in SQL, because the limit is applied after the sort. Taking the
      // ten oldest and *then* ranking them meant an agent with ten old tasks
      // could never reach an urgent one filed this morning — the exact opposite
      // of what this is for.
      const ordered = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeAgentId, agentId),
            inArray(tasks.status, [...CLAIMABLE_STATUSES]),
            sql`(${tasks.claimedByRunId} is null or ${tasks.claimedByRunId} = ${runId}::uuid)`,
          ),
        )
        .orderBy(
          sql`case ${tasks.priority}
                when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
          asc(tasks.createdAt),
        )
        .limit(10);

      for (const candidate of ordered) {
        const claimed = await this.claim(candidate.id, runId, agentId);
        if (claimed) return claimed;
      }
      return null;
    },

    /** Releases a claim held by a run that is over. A compare-and-swap, never a blind clear. */
    async releaseClaim(taskId: string, runId: string): Promise<void> {
      await db
        .update(tasks)
        .set({ claimedByRunId: null, claimedAt: null })
        .where(and(eq(tasks.id, taskId), eq(tasks.claimedByRunId, runId)));
    },

    /**
     * Records whether a run got anywhere on the task it held, and stops the
     * task waking anybody once enough runs in a row have not.
     *
     * Progress is deliberately generous: a status change, or a word said about
     * it. Anything less and the next wake would only buy the same silence.
     */
    async noteRunOutcome(
      organizationId: string,
      taskId: string,
      runId: string,
      statusBefore: TaskStatus,
    ): Promise<{ stalled: boolean }> {
      const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!row) return { stalled: false };

      const [said] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(taskComments)
        .where(and(eq(taskComments.taskId, taskId), eq(taskComments.authorRunId, runId)));

      const progressed = row.status !== statusBefore || (said?.value ?? 0) > 0;
      if (progressed) {
        await db.update(tasks).set({ noProgressRuns: 0 }).where(eq(tasks.id, taskId));
        return { stalled: false };
      }

      const [updated] = await db
        .update(tasks)
        .set({ noProgressRuns: sql`${tasks.noProgressRuns} + 1` })
        .where(eq(tasks.id, taskId))
        .returning({ count: tasks.noProgressRuns });

      if ((updated?.count ?? 0) < MAX_NO_PROGRESS_RUNS) return { stalled: false };
      if (isTerminalTaskStatus(row.status) || row.status === "blocked") return { stalled: true };

      await this.setStatus(taskId, "blocked", { claimedByRunId: null, claimedAt: null });
      await this.comment(
        organizationId,
        taskId,
        `${updated?.count ?? 0} runs in a row ended without moving this or saying anything about it. It needs a person to look.`,
        "system",
        { type: "system" },
      );
      return { stalled: true };
    },

    /**
     * Forgets that a task was stuck.
     *
     * A person saying something is new information, which is exactly what the
     * agent did not have on the five runs that got nowhere.
     */
    async clearNoProgress(taskId: string): Promise<void> {
      await db.update(tasks).set({ noProgressRuns: 0 }).where(eq(tasks.id, taskId));
    },

    /** Whether waking somebody for this task is still worth the run. */
    async worthWaking(taskId: string): Promise<boolean> {
      const [row] = await db
        .select({ count: tasks.noProgressRuns, status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      if (!row) return false;
      return row.count < MAX_NO_PROGRESS_RUNS && !isTerminalTaskStatus(row.status);
    },

    async releaseClaimsOfRun(runId: string): Promise<void> {
      await db
        .update(tasks)
        .set({ claimedByRunId: null, claimedAt: null })
        .where(eq(tasks.claimedByRunId, runId));
    },

    async comment(
      organizationId: string,
      taskId: string,
      body: string,
      intent: CommentIntent,
      actor: Actor | { type: "system" },
    ): Promise<void> {
      await db.insert(taskComments).values({
        organizationId,
        taskId,
        authorType: actor.type,
        ...(actor.type === "agent" ? { authorAgentId: actor.agentId, authorRunId: actor.runId } : {}),
        ...(actor.type === "user" ? { authorUserId: actor.userId } : {}),
        body,
        intent,
      });
    },

    async comments(organizationId: string, taskId: string, limit = 200): Promise<TaskComment[]> {
      const rows = await db
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          taskKey: tasks.key,
          authorType: taskComments.authorType,
          authorAgentId: taskComments.authorAgentId,
          authorName: agents.name,
          authorRunId: taskComments.authorRunId,
          body: taskComments.body,
          intent: taskComments.intent,
          trust: taskComments.trust,
          createdAt: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .leftJoin(agents, eq(agents.id, taskComments.authorAgentId))
        .where(
          and(eq(taskComments.organizationId, organizationId), eq(taskComments.taskId, taskId)),
        )
        .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        intent: row.intent as CommentIntent,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    /** Everything said across the organization, newest first. */
    async activity(organizationId: string, limit = 100): Promise<TaskComment[]> {
      const rows = await db
        .select({
          id: taskComments.id,
          taskId: taskComments.taskId,
          taskKey: tasks.key,
          authorType: taskComments.authorType,
          authorAgentId: taskComments.authorAgentId,
          authorName: agents.name,
          authorRunId: taskComments.authorRunId,
          body: taskComments.body,
          intent: taskComments.intent,
          trust: taskComments.trust,
          createdAt: taskComments.createdAt,
        })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .leftJoin(agents, eq(agents.id, taskComments.authorAgentId))
        .where(eq(taskComments.organizationId, organizationId))
        .orderBy(desc(taskComments.createdAt), desc(taskComments.id))
        .limit(limit);

      return rows.map((row) => ({
        ...row,
        intent: row.intent as CommentIntent,
        createdAt: row.createdAt.toISOString(),
      }));
    },

    async addBlocker(organizationId: string, dependentId: string, blockerId: string): Promise<void> {
      if (dependentId === blockerId) throw new AppError("TASK_DEPENDENCY_CYCLE");

      // Would the blocker already be waiting, directly or transitively, on the
      // dependent? Then this edge closes a loop and neither would ever start.
      const reach = await db.execute<{ id: string }>(sql`
        with recursive downstream as (
          select related_task_id as id from ${taskRelations} where task_id = ${dependentId}::uuid
          union
          select r.related_task_id from ${taskRelations} r join downstream d on r.task_id = d.id
        )
        select id from downstream where id = ${blockerId}::uuid limit 1
      `);
      if (reach.rows.length > 0) throw new AppError("TASK_DEPENDENCY_CYCLE");

      await db
        .insert(taskRelations)
        .values({ organizationId, taskId: blockerId, relatedTaskId: dependentId })
        .onConflictDoNothing();

      await this.refreshBlockedState(organizationId, dependentId);
    },

    async removeBlocker(dependentId: string, blockerId: string, organizationId: string) {
      await db
        .delete(taskRelations)
        .where(
          and(eq(taskRelations.taskId, blockerId), eq(taskRelations.relatedTaskId, dependentId)),
        );
      await this.refreshBlockedState(organizationId, dependentId);
    },

    /**
     * Only a *done* blocker resolves a dependent.
     *
     * A cancelled blocker leaves it waiting on purpose: cancelling is a
     * statement that the work will not happen, and starting the dependent
     * anyway means building on something that does not exist. Somebody has to
     * decide what happens instead.
     */
    async unresolvedBlockers(taskId: string): Promise<number> {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(taskRelations)
        .innerJoin(tasks, eq(tasks.id, taskRelations.taskId))
        .where(and(eq(taskRelations.relatedTaskId, taskId), sql`${tasks.status} <> 'done'`));
      return row?.value ?? 0;
    },

    async refreshBlockedState(organizationId: string, taskId: string): Promise<TaskStatus | null> {
      const row = await requireRow(organizationId, taskId);
      if (isTerminalTaskStatus(row.status) || row.status === "in_review") return null;

      const unresolved = await this.unresolvedBlockers(taskId);

      if (unresolved > 0 && row.status !== "blocked") {
        await db
          .update(tasks)
          .set({
            status: "blocked",
            statusVersion: sql`${tasks.statusVersion} + 1`,
            ...taskStatusSideEffects("blocked", new Date()),
          })
          .where(eq(tasks.id, taskId));
        return "blocked";
      }

      if (unresolved === 0 && row.status === "blocked") {
        await db
          .update(tasks)
          .set({ status: "todo", statusVersion: sql`${tasks.statusVersion} + 1` })
          .where(eq(tasks.id, taskId));
        return "todo";
      }

      return null;
    },

    /** Dependents of a finished task that are now fully ready to start. */
    async dependentsNowReady(taskId: string): Promise<TaskRow[]> {
      const dependents = await db
        .select({ id: taskRelations.relatedTaskId })
        .from(taskRelations)
        .where(eq(taskRelations.taskId, taskId));
      if (dependents.length === 0) return [];

      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            inArray(
              tasks.id,
              dependents.map((d) => d.id),
            ),
            sql`${tasks.status} not in ('done','cancelled')`,
            sql`${tasks.assigneeAgentId} is not null`,
          ),
        );

      // One blocker of several finishing does not make a dependent ready, so
      // each candidate is re-checked against its whole set rather than assumed.
      const ready: TaskRow[] = [];
      for (const candidate of rows) {
        if ((await this.unresolvedBlockers(candidate.id)) === 0) ready.push(candidate);
      }
      return ready;
    },

    async recordDecision(
      organizationId: string,
      taskId: string,
      round: number,
      outcome: "approved" | "changes_requested",
      body: string,
      actor: Actor,
    ): Promise<void> {
      await db.insert(taskReviewDecisions).values({
        organizationId,
        taskId,
        round,
        outcome,
        body,
        actorAgentId: actorAgentId(actor),
        actorRunId: actorRunId(actor),
        ...(actor.type === "user" ? { actorUserId: actor.userId } : {}),
      });
    },

    async decisions(organizationId: string, taskId: string) {
      return db
        .select({
          id: taskReviewDecisions.id,
          round: taskReviewDecisions.round,
          outcome: taskReviewDecisions.outcome,
          body: taskReviewDecisions.body,
          actorAgentId: taskReviewDecisions.actorAgentId,
          actorName: agents.name,
          actorUserId: taskReviewDecisions.actorUserId,
          createdAt: taskReviewDecisions.createdAt,
        })
        .from(taskReviewDecisions)
        .leftJoin(agents, eq(agents.id, taskReviewDecisions.actorAgentId))
        .where(
          and(
            eq(taskReviewDecisions.organizationId, organizationId),
            eq(taskReviewDecisions.taskId, taskId),
          ),
        )
        .orderBy(asc(taskReviewDecisions.createdAt));
    },

    async setStatus(
      taskId: string,
      status: TaskStatus,
      patch: Partial<{
        assigneeAgentId: string | null;
        reviewStateJson: ReviewState | null;
        claimedByRunId: string | null;
        claimedAt: Date | null;
      }> = {},
    ): Promise<TaskRow> {
      const [row] = await db
        .update(tasks)
        .set({
          status,
          statusVersion: sql`${tasks.statusVersion} + 1`,
          ...taskStatusSideEffects(status, new Date()),
          ...patch,
        })
        .where(eq(tasks.id, taskId))
        .returning();
      if (!row) throw new AppError("TASK_NOT_FOUND", { ref: taskId });
      return row;
    },

    reviewRoundCap: MAX_REVIEW_ROUNDS,

    async openTaskCount(projectId: string): Promise<number> {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), sql`${tasks.status} not in ('done','cancelled')`));
      return row?.value ?? 0;
    },

    /** Tasks with no assignee at all, which nothing will ever pick up. */
    async unassigned(organizationId: string, projectId: string): Promise<number> {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.organizationId, organizationId),
            eq(tasks.projectId, projectId),
            isNull(tasks.assigneeAgentId),
            sql`${tasks.status} not in ('done','cancelled')`,
          ),
        );
      return row?.value ?? 0;
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
