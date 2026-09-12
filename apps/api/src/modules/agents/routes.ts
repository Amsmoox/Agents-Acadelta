// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createAgentSchema,
  listAgentsQuerySchema,
  pauseAgentSchema,
  updateAgentSchema,
} from "@agentco/shared";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createAgentRepository } from "./repository.js";

const orgParams = z.object({ orgRef: z.string().min(1).max(63) });
const agentParams = orgParams.extend({ ref: z.string().min(1).max(63) });
const revisionParams = agentParams.extend({ revisionId: z.uuid() });

/**
 * Agents live under an organization in the URL because they live under one in
 * the model. There is no route that reaches an agent without naming its
 * organization, so a query can never accidentally span two tenants.
 */
export async function registerAgentRoutes(instance: FastifyInstance) {
  const organizations = createOrganizationRepository(instance.db);
  const repo = createAgentRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const orgId = async (ref: string) => (await organizations.requireByRef(ref)).id;

  /**
   * For anything that starts work, spends money, or changes configuration.
   *
   * An archived organization stays fully readable, and you can still stop
   * things inside it — pausing and terminating only ever reduce activity. What
   * it will not do any more is let you hire, edit, re-enable or invoke.
   */
  const activeOrgId = async (ref: string) => (await organizations.requireActiveByRef(ref)).id;

  app.post(
    "/organizations/:orgRef/agents",
    { schema: { params: orgParams, body: createAgentSchema } },
    async (request, reply) => {
      const agent = await repo.create(await activeOrgId(request.params.orgRef), request.body);
      return reply.status(201).send(agent);
    },
  );

  app.get(
    "/organizations/:orgRef/agents",
    { schema: { params: orgParams, querystring: listAgentsQuerySchema } },
    async (request) => repo.list(await orgId(request.params.orgRef), request.query),
  );

  app.get(
    "/organizations/:orgRef/agents/org-tree",
    { schema: { params: orgParams } },
    async (request) => ({ data: await repo.orgTree(await orgId(request.params.orgRef)) }),
  );

  app.get(
    "/organizations/:orgRef/agents/:ref",
    { schema: { params: agentParams } },
    async (request) => repo.get(await orgId(request.params.orgRef), request.params.ref),
  );

  app.patch(
    "/organizations/:orgRef/agents/:ref",
    { schema: { params: agentParams, body: updateAgentSchema } },
    async (request) =>
      repo.update(await activeOrgId(request.params.orgRef), request.params.ref, request.body),
  );

  app.post(
    "/organizations/:orgRef/agents/:ref/pause",
    { schema: { params: agentParams, body: pauseAgentSchema } },
    async (request) =>
      repo.setStatus(await orgId(request.params.orgRef), request.params.ref, "paused", {
        pauseReason: request.body.reason,
      }),
  );

  app.post(
    "/organizations/:orgRef/agents/:ref/resume",
    { schema: { params: agentParams } },
    async (request) =>
      repo.setStatus(await activeOrgId(request.params.orgRef), request.params.ref, "idle", {
        from: ["paused"],
      }),
  );

  app.post(
    "/organizations/:orgRef/agents/:ref/clear-error",
    { schema: { params: agentParams } },
    async (request) =>
      repo.setStatus(await activeOrgId(request.params.orgRef), request.params.ref, "idle", {
        from: ["error"],
      }),
  );

  app.post(
    "/organizations/:orgRef/agents/:ref/approve",
    { schema: { params: agentParams } },
    async (request) =>
      repo.setStatus(await activeOrgId(request.params.orgRef), request.params.ref, "idle", {
        from: ["pending_approval"],
      }),
  );

  // POST, not DELETE: termination is a state the audit trail keeps, not a
  // deletion. It is also one-way.
  app.post(
    "/organizations/:orgRef/agents/:ref/terminate",
    { schema: { params: agentParams } },
    async (request) =>
      repo.setStatus(await orgId(request.params.orgRef), request.params.ref, "terminated"),
  );

  app.get(
    "/organizations/:orgRef/agents/:ref/revisions",
    { schema: { params: agentParams } },
    async (request) => ({
      data: await repo.listRevisions(await orgId(request.params.orgRef), request.params.ref),
    }),
  );

  app.post(
    "/organizations/:orgRef/agents/:ref/revisions/:revisionId/rollback",
    { schema: { params: revisionParams } },
    async (request) =>
      repo.rollback(
        await activeOrgId(request.params.orgRef),
        request.params.ref,
        request.params.revisionId,
      ),
  );
}
