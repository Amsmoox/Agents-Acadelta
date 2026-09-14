// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createObjectiveRepository,
  createTaskRepository,
  createWorkflowService,
  type Actor,
} from "@agentco/core";
import {
  commentSchema,
  createObjectiveSchema,
  createTaskSchema,
  listTasksQuerySchema,
  moveTaskSchema,
  updateTaskSchema,
} from "@agentco/shared";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createProjectRepository } from "../projects/repository.js";

const orgParams = z.object({ orgRef: z.string().min(1).max(63) });
const projectParams = orgParams.extend({ ref: z.string().min(1).max(63) });
const taskParams = orgParams.extend({ taskRef: z.string().min(1).max(80) });

/**
 * There is no login yet, so the person acting is whoever the client says it is
 * and defaults to the owner. It exists as a column and a parameter from the
 * start because `responsible_user_id` is the ceiling every agent action is
 * measured against, and retrofitting an authority model is how you end up
 * without one.
 */
const OWNER = "owner";

function userActor(request: { headers: Record<string, unknown> }): Actor {
  const header = request.headers["x-agentco-user"];
  return { type: "user", userId: typeof header === "string" && header ? header : OWNER };
}

export async function registerTaskRoutes(instance: FastifyInstance) {
  const organizations = createOrganizationRepository(instance.db);
  const projectsRepo = createProjectRepository(instance.db);
  const repo = createTaskRepository(instance.db);
  const workflow = createWorkflowService(instance.db);
  const objectives = createObjectiveRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const orgId = async (ref: string) => (await organizations.requireByRef(ref)).id;
  const activeOrgId = async (ref: string) => (await organizations.requireActiveByRef(ref)).id;

  app.post(
    "/organizations/:orgRef/projects/:ref/tasks",
    { schema: { params: projectParams, body: createTaskSchema } },
    async (request, reply) => {
      const org = await activeOrgId(request.params.orgRef);
      const project = await projectsRepo.requireActive(org, request.params.ref);
      const actor = userActor(request);
      const task = await repo.createSafely(org, project.id, request.body, actor);

      if (task.assigneeAgentId) {
        await workflow.applyWakes(
          org,
          [{ agentId: task.assigneeAgentId, reason: "task_assigned", detail: task.key }],
          actor,
        );
      }
      return reply.status(201).send(task);
    },
  );

  app.get(
    "/organizations/:orgRef/projects/:ref/tasks",
    { schema: { params: projectParams, querystring: listTasksQuerySchema } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const project = await projectsRepo.get(org, request.params.ref);
      return { data: await repo.list(org, project.id, request.query) };
    },
  );

  app.get(
    "/organizations/:orgRef/tasks/:taskRef",
    { schema: { params: taskParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const task = await repo.get(org, request.params.taskRef);
      // The chain comes back with the task. Delegation is the whole shape of
      // this system, and a page that shows "3 children" as a number you cannot
      // follow is telling you there is a story and refusing to tell it.
      return {
        ...task,
        comments: await repo.comments(org, task.id),
        decisions: await repo.decisions(org, task.id),
        parent: task.parentId ? await repo.get(org, task.parentId).catch(() => null) : null,
        children: await repo.list(org, task.projectId, { limit: 100, parentId: task.id }),
      };
    },
  );

  app.patch(
    "/organizations/:orgRef/tasks/:taskRef",
    { schema: { params: taskParams, body: updateTaskSchema } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);
      const actor = userActor(request);
      const existing = await repo.requireRow(org, request.params.taskRef);
      const task = await repo.update(org, existing.id, request.body, actor);

      if (request.body.assigneeAgentId && request.body.assigneeAgentId !== existing.assigneeAgentId) {
        await workflow.applyWakes(
          org,
          [{ agentId: request.body.assigneeAgentId, reason: "task_assigned", detail: task.key }],
          actor,
        );
      }
      return task;
    },
  );

  app.post(
    "/organizations/:orgRef/tasks/:taskRef/move",
    { schema: { params: taskParams, body: moveTaskSchema } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);
      const actor = userActor(request);
      const existing = await repo.requireRow(org, request.params.taskRef);
      const result = await workflow.move(
        org,
        existing.id,
        request.body.status,
        actor,
        request.body.comment,
      );
      await workflow.applyWakes(org, result.wake, actor);
      return result.task;
    },
  );

  app.post(
    "/organizations/:orgRef/tasks/:taskRef/comments",
    { schema: { params: taskParams, body: commentSchema } },
    async (request, reply) => {
      const org = await activeOrgId(request.params.orgRef);
      const actor = userActor(request);
      const task = await repo.requireRow(org, request.params.taskRef);
      await repo.comment(org, task.id, request.body.body, request.body.intent, actor);

      // A person's comment wakes the agent holding the task; there is nobody
      // else it could be addressed to. A person saying something is also the
      // one thing that makes a stalled task worth another attempt, so the
      // counter is cleared rather than consulted.
      if (task.assigneeAgentId && task.status !== "done" && task.status !== "cancelled") {
        await repo.clearNoProgress(task.id);
        await workflow.applyWakes(
          org,
          [{ agentId: task.assigneeAgentId, reason: "task_comment", detail: task.key }],
          actor,
        );
      }
      return reply.status(201).send({ data: await repo.comments(org, task.id) });
    },
  );

  app.post(
    "/organizations/:orgRef/tasks/:taskRef/blockers",
    { schema: { params: taskParams, body: z.object({ blockerTaskId: z.uuid() }) } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);
      const task = await repo.requireRow(org, request.params.taskRef);
      // Resolved in this organization first, so a foreign id is "not found"
      // rather than a foreign key violation.
      const blocker = await repo.requireRow(org, request.body.blockerTaskId);
      await repo.addBlocker(org, task.id, blocker.id);
      return repo.get(org, task.id);
    },
  );

  app.delete(
    "/organizations/:orgRef/tasks/:taskRef/blockers/:blockerId",
    { schema: { params: taskParams.extend({ blockerId: z.uuid() }) } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);
      const task = await repo.requireRow(org, request.params.taskRef);
      await repo.removeBlocker(task.id, request.params.blockerId, org);
      return repo.get(org, task.id);
    },
  );

  // ---- objectives: a standing instruction with a way out ----

  app.post(
    "/organizations/:orgRef/projects/:ref/objectives",
    { schema: { params: projectParams, body: createObjectiveSchema } },
    async (request, reply) => {
      const org = await activeOrgId(request.params.orgRef);
      const project = await projectsRepo.requireActive(org, request.params.ref);
      const actor = userActor(request);
      const objective = await objectives.create(org, project.id, request.body, actor.userId);

      // Nothing happens until the owner is woken, so the order is given by
      // waking it — and every later cycle is triggered the same way.
      await workflow.applyWakes(
        org,
        [{ agentId: objective.ownerAgentId, reason: "objective_started", detail: objective.title }],
        actor,
      );
      return reply.status(201).send(objective);
    },
  );

  app.get(
    "/organizations/:orgRef/projects/:ref/objectives",
    { schema: { params: projectParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const project = await projectsRepo.get(org, request.params.ref);
      return { data: await objectives.list(org, project.id) };
    },
  );

  app.get(
    "/organizations/:orgRef/objectives/:id",
    { schema: { params: orgParams.extend({ id: z.uuid() }) } },
    async (request) => objectives.get(await orgId(request.params.orgRef), request.params.id),
  );

  /**
   * A person settling a check only a person can settle.
   *
   * The objective does not finish here — the next verification weighs this
   * alongside everything else, so one tick cannot skip the rest.
   */
  app.post(
    "/organizations/:orgRef/objectives/:id/checks/:checkId",
    {
      schema: {
        params: orgParams.extend({ id: z.uuid(), checkId: z.string().min(1).max(64) }),
        body: z.object({ passed: z.boolean(), note: z.string().trim().max(2000).default("") }),
      },
    },
    async (request) =>
      objectives.recordHumanCheck(
        await activeOrgId(request.params.orgRef),
        request.params.id,
        request.params.checkId,
        request.body.passed,
        request.body.note,
      ),
  );

  app.post(
    "/organizations/:orgRef/objectives/:id/stop",
    { schema: { params: orgParams.extend({ id: z.uuid() }) } },
    async (request) =>
      objectives.end(await activeOrgId(request.params.orgRef), request.params.id, {
        status: "abandoned",
        outcome: "Stopped by a person.",
      }),
  );

  app.post(
    "/organizations/:orgRef/objectives/:id/pause",
    { schema: { params: orgParams.extend({ id: z.uuid() }) } },
    async (request) =>
      objectives.setStatus(await activeOrgId(request.params.orgRef), request.params.id, "paused"),
  );

  app.post(
    "/organizations/:orgRef/objectives/:id/resume",
    { schema: { params: orgParams.extend({ id: z.uuid() }) } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);
      const objective = await objectives.setStatus(org, request.params.id, "active");
      await workflow.applyWakes(
        org,
        [{ agentId: objective.ownerAgentId, reason: "objective_resumed", detail: objective.title }],
        userActor(request),
      );
      return objective;
    },
  );

  /** Everything every agent has said, newest first. */
  app.get(
    "/organizations/:orgRef/communications",
    {
      schema: {
        params: orgParams,
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }),
      },
    },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      return { data: await repo.activity(org, request.query.limit) };
    },
  );
}
