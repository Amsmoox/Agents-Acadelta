// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { agents, projectMembers, projects, tasks } from "@agentco/db";
import {
  createCredentialRepository,
  createObjectiveRepository,
  createTaskRepository,
  createWorkflowService,
  type Actor,
  type RunIdentity,
} from "@agentco/core";
import { AppError, commentBodySchema, createTaskSchema } from "@agentco/shared";
import { TOOLS, resolveInvocation } from "@agentco/sandbox";

/**
 * What a running agent can do, and nothing else.
 *
 * A separate plugin with its own authentication hook, deliberately. A single
 * middleware with a branch for "session or run token" is how a run ends up able
 * to do something only a person should, so there are two doors and two keys:
 * a run token is refused everywhere else, and a session is refused here.
 *
 * The surface is small on purpose. An agent works on tasks, talks about tasks,
 * and hands tasks to other agents. It cannot change what an agent *is* —
 * configuration, budgets, membership and the organization itself are a
 * person's, permanently.
 */

declare module "fastify" {
  interface FastifyRequest {
    runIdentity?: RunIdentity;
  }
}

function identity(request: FastifyRequest): RunIdentity {
  const found = request.runIdentity;
  if (!found) throw new AppError("RUN_CREDENTIAL_INVALID");
  return found;
}

function actorOf(id: RunIdentity): Actor {
  return {
    type: "agent",
    agentId: id.agentId,
    runId: id.runId,
    userId: id.responsibleUserId,
  };
}

export async function registerAgentApiRoutes(instance: FastifyInstance) {
  const credentials = createCredentialRepository(instance.db);
  const repo = createTaskRepository(instance.db);
  const workflow = createWorkflowService(instance.db);
  const objectives = createObjectiveRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/agent/")) return;
    const header = request.headers.authorization;
    const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "") : "";
    if (!token) throw new AppError("RUN_CREDENTIAL_INVALID", { reason: "missing" });
    request.runIdentity = await credentials.resolve(token);
  });

  /**
   * Resolves a task the acting run is allowed to touch, and charges the write.
   *
   * A task in another organization answers 404 rather than 403: 403 confirms
   * that the row exists, which is the one thing a caller outside the tenant
   * should not be able to learn.
   */
  async function target(request: FastifyRequest, ref: string, write: boolean) {
    const id = identity(request);
    const row = await repo.requireRow(id.organizationId, ref).catch(() => null);
    if (!row) throw new AppError("TASK_NOT_FOUND", { ref });
    if (write) await credentials.chargeCrossTaskWrite(id.runId, row.id);
    return { id, row };
  }

  /** Who am I, what am I working on, and what does it say. */
  app.get("/agent/me", async (request) => {
    const id = identity(request);
    const [agent] = await instance.db
      .select({ id: agents.id, name: agents.name, role: agents.role, slug: agents.slug })
      .from(agents)
      .where(eq(agents.id, id.agentId))
      .limit(1);

    const current = id.currentTaskId
      ? await repo.get(id.organizationId, id.currentTaskId).catch(() => null)
      : null;

    return {
      agent,
      runId: id.runId,
      task: current,
      comments: current ? await repo.comments(id.organizationId, current.id) : [],
      crossTaskWrites: { used: id.crossTaskWriteCount, limit: id.crossTaskWriteLimit },
    };
  });

  /** Who else is on this project, and what they are for. */
  app.get("/agent/team", async (request) => {
    const id = identity(request);
    const task = id.currentTaskId
      ? await repo.requireRow(id.organizationId, id.currentTaskId).catch(() => null)
      : null;
    if (!task) return { data: [] };

    const rows = await instance.db
      .select({
        agentId: agents.id,
        name: agents.name,
        role: agents.role,
        title: agents.title,
        capabilities: agents.capabilities,
        status: agents.status,
        projectRole: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(agents, eq(agents.id, projectMembers.agentId))
      .where(
        and(
          eq(projectMembers.organizationId, id.organizationId),
          eq(projectMembers.projectId, task.projectId),
        ),
      );

    // Capabilities and roles only. What an agent costs or how it is configured
    // is not another agent's business.
    return { data: rows.filter((row) => row.status !== "terminated") };
  });

  app.get(
    "/agent/tasks",
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          mine: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) => {
      const id = identity(request);
      const current = id.currentTaskId
        ? await repo.requireRow(id.organizationId, id.currentTaskId).catch(() => null)
        : null;
      if (!current) return { data: [] };

      const all = await repo.list(id.organizationId, current.projectId, {
        limit: request.query.limit,
        ...(request.query.status
          ? { status: request.query.status as never }
          : {}),
        ...(request.query.mine ? { assigneeAgentId: id.agentId } : {}),
      });
      return { data: all };
    },
  );

  app.get("/agent/tasks/:ref", async (request) => {
    const { id, row } = await target(request as FastifyRequest, (request.params as { ref: string }).ref, false);
    const task = await repo.get(id.organizationId, row.id);
    return { ...task, comments: await repo.comments(id.organizationId, row.id) };
  });

  /**
   * Files a task, optionally for somebody else. This is delegation, and it is
   * one endpoint plus the rails around it: depth, cycles, duplicates,
   * membership and the per-run write budget.
   */
  app.post(
    "/agent/tasks",
    { schema: { body: createTaskSchema.omit({ status: true }) } },
    async (request, reply) => {
      const id = identity(request);
      const actor = actorOf(id);
      const current = id.currentTaskId
        ? await repo.requireRow(id.organizationId, id.currentTaskId).catch(() => null)
        : null;
      if (!current) throw new AppError("TASK_NOT_FOUND", { reason: "no current task" });

      await credentials.chargeCrossTaskWrite(id.runId, null);

      const task = await repo.createSafely(
        id.organizationId,
        current.projectId,
        {
          ...request.body,
          status: "todo",
          // Defaults to the task being worked, so delegation builds a tree
          // rather than a pile nobody can trace.
          parentId: request.body.parentId ?? current.id,
        },
        actor,
        { objectiveId: current.objectiveId },
      );

      if (task.assigneeAgentId) {
        await workflow.applyWakes(
          id.organizationId,
          [{ agentId: task.assigneeAgentId, reason: "task_assigned", detail: task.key }],
          actor,
        );
      }
      return reply.status(201).send(task);
    },
  );

  app.post(
    "/agent/tasks/:ref/comment",
    { schema: { body: z.object({ body: commentBodySchema, intent: z.string().optional() }) } },
    async (request, reply) => {
      const { id, row } = await target(
        request as FastifyRequest,
        (request.params as { ref: string }).ref,
        true,
      );
      const actor = actorOf(id);
      await repo.comment(
        id.organizationId,
        row.id,
        request.body.body,
        (request.body.intent as never) ?? "note",
        actor,
      );

      // An agent's own comment never wakes it. It is already awake, and the
      // loop that starts otherwise reads its own words and answers them.
      if (
        row.assigneeAgentId &&
        row.assigneeAgentId !== id.agentId &&
        row.status !== "done" &&
        row.status !== "cancelled"
      ) {
        await workflow.applyWakes(
          id.organizationId,
          [{ agentId: row.assigneeAgentId, reason: "task_comment", detail: row.key }],
          actor,
        );
      }
      return reply.status(201).send({ ok: true });
    },
  );

  app.post(
    "/agent/tasks/:ref/status",
    {
      schema: {
        body: z.object({
          status: z.enum(["in_progress", "in_review", "blocked", "done", "cancelled"]),
          comment: commentBodySchema.optional(),
        }),
      },
    },
    async (request) => {
      const { id, row } = await target(
        request as FastifyRequest,
        (request.params as { ref: string }).ref,
        true,
      );
      const actor = actorOf(id);
      const result = await workflow.move(
        id.organizationId,
        row.id,
        request.body.status,
        actor,
        request.body.comment,
      );
      await workflow.applyWakes(id.organizationId, result.wake, actor);
      return result.task;
    },
  );

  app.post(
    "/agent/tasks/:ref/assign",
    { schema: { body: z.object({ agentId: z.uuid(), comment: commentBodySchema.optional() }) } },
    async (request) => {
      const { id, row } = await target(
        request as FastifyRequest,
        (request.params as { ref: string }).ref,
        true,
      );
      const actor = actorOf(id);
      const task = await repo.update(
        id.organizationId,
        row.id,
        { assigneeAgentId: request.body.agentId },
        actor,
      );
      if (request.body.comment) {
        await repo.comment(id.organizationId, row.id, request.body.comment, "handoff", actor);
      }
      await workflow.applyWakes(
        id.organizationId,
        [{ agentId: request.body.agentId, reason: "task_assigned", detail: task.key }],
        actor,
      );
      return task;
    },
  );

  app.post(
    "/agent/tasks/:ref/block-on",
    { schema: { body: z.object({ blockerTaskId: z.uuid() }) } },
    async (request) => {
      const { id, row } = await target(
        request as FastifyRequest,
        (request.params as { ref: string }).ref,
        true,
      );
      await repo.addBlocker(id.organizationId, row.id, request.body.blockerTaskId);
      return repo.get(id.organizationId, row.id);
    },
  );

  app.get("/agent/objective", async (request) => {
    const id = identity(request);
    const row = await objectives.activeFor(id.agentId);
    if (!row) return null;
    return objectives.get(id.organizationId, row.id);
  });

  /**
   * The owner asking to stop.
   *
   * A request, not a conclusion. Open work under the objective is a fact and
   * the agent's confidence is a claim, so the fact decides — and the refusal
   * names what is still outstanding so the agent can go and finish it.
   */
  app.post(
    "/agent/objective/finish",
    { schema: { body: z.object({ summary: z.string().trim().max(20_000).default("") }) } },
    async (request, reply) => {
      const id = identity(request);
      const row = await objectives.activeFor(id.agentId);
      if (!row) throw new AppError("OBJECTIVE_NOT_FOUND", { reason: "you carry no objective" });

      const result = await objectives.declareSatisfied(
        id.organizationId,
        row.id,
        request.body.summary || "The owning agent reported the work complete.",
      );
      if (!result.accepted) {
        return reply.status(409).send({ ok: false, error: result.reason });
      }
      return { finished: true };
    },
  );

  /** The project's brief: what this is, who it is for, what good looks like. */
  app.get("/agent/project", async (request) => {
    const id = identity(request);
    const current = id.currentTaskId
      ? await repo.requireRow(id.organizationId, id.currentTaskId).catch(() => null)
      : null;
    if (!current) return null;

    const [project] = await instance.db
      .select({
        name: projects.name,
        summary: projects.summary,
        brief: projects.brief,
        taskPrefix: projects.taskPrefix,
      })
      .from(projects)
      .where(eq(projects.id, current.projectId))
      .limit(1);

    const open = await instance.db
      .select({ key: tasks.key, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, current.projectId),
          eq(tasks.organizationId, id.organizationId),
        ),
      )
      .limit(100);

    return { project, tasks: open };
  });

  /**
   * One command line, executed.
   *
   * The shim on the child's PATH does nothing but carry arguments and a
   * credential here, so this is where a command becomes a request. It replays
   * through the server's own routes rather than calling the repositories
   * directly, which means a tool cannot quietly skip a rule that the equivalent
   * endpoint enforces.
   */
  app.post(
    "/agent/exec",
    { schema: { body: z.object({ argv: z.array(z.string()).max(60) }) } },
    async (request, reply) => {
      const argv = request.body.argv;

      if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help") {
        return {
          ok: true,
          tools: TOOLS.map((tool) => ({ usage: tool.usage, summary: tool.summary })),
        };
      }

      const invocation = resolveInvocation(argv);
      // A refusal reaches the model as a sentence it can act on. A bare status
      // code is something it retries five times without changing anything.
      if (!invocation.ok) return reply.status(400).send({ ok: false, error: invocation.error });

      const inner = await instance.inject({
        method: invocation.method,
        url: invocation.path,
        headers: {
          authorization: request.headers.authorization ?? "",
          ...(invocation.body ? { "content-type": "application/json" } : {}),
        },
        ...(invocation.body ? { payload: invocation.body } : {}),
      });

      const payload = inner.json() as unknown;
      if (inner.statusCode >= 400) {
        const detail = payload as { error?: { message?: string; detail?: unknown } };
        return reply
          .status(inner.statusCode)
          .send({ ok: false, error: detail.error?.message ?? "That did not work.", detail: detail.error?.detail });
      }
      // The inner status is forwarded rather than flattened to 200: a caller
      // that cannot tell "created" from "already there" learns nothing from
      // either, and the shim reports the code as well as the body.
      return reply.status(inner.statusCode).send({ ok: true, result: payload });
    },
  );
}
