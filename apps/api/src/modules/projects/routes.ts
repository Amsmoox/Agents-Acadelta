// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  setProjectMembersSchema,
  updateProjectSchema,
} from "@agentco/shared";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createProjectRepository } from "./repository.js";

const orgParams = z.object({ orgRef: z.string().min(1).max(63) });
const projectParams = orgParams.extend({ ref: z.string().min(1).max(63) });

/**
 * Projects live under an organization in the URL because they live under one in
 * the model, and no route reaches a project without naming its organization.
 */
export async function registerProjectRoutes(instance: FastifyInstance) {
  const organizations = createOrganizationRepository(instance.db);
  const repo = createProjectRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const orgId = async (ref: string) => (await organizations.requireByRef(ref)).id;
  /** Same rule as everywhere else: an archived organization is read-only. */
  const activeOrgId = async (ref: string) => (await organizations.requireActiveByRef(ref)).id;

  app.post(
    "/organizations/:orgRef/projects",
    { schema: { params: orgParams, body: createProjectSchema } },
    async (request, reply) => {
      const project = await repo.create(await activeOrgId(request.params.orgRef), request.body);
      return reply.status(201).send(project);
    },
  );

  app.get(
    "/organizations/:orgRef/projects",
    { schema: { params: orgParams, querystring: listProjectsQuerySchema } },
    async (request) => repo.list(await orgId(request.params.orgRef), request.query),
  );

  app.get(
    "/organizations/:orgRef/projects/:ref",
    { schema: { params: projectParams } },
    async (request) => repo.get(await orgId(request.params.orgRef), request.params.ref),
  );

  app.patch(
    "/organizations/:orgRef/projects/:ref",
    { schema: { params: projectParams, body: updateProjectSchema } },
    async (request) =>
      repo.update(await activeOrgId(request.params.orgRef), request.params.ref, request.body),
  );

  // POST, not DELETE. Archiving keeps every task, run and comment the project
  // ever held; those are the history the record exists for.
  app.post(
    "/organizations/:orgRef/projects/:ref/archive",
    { schema: { params: projectParams } },
    async (request) => repo.setArchived(await activeOrgId(request.params.orgRef), request.params.ref, true),
  );

  app.post(
    "/organizations/:orgRef/projects/:ref/restore",
    { schema: { params: projectParams } },
    async (request) =>
      repo.setArchived(await activeOrgId(request.params.orgRef), request.params.ref, false),
  );

  app.get(
    "/organizations/:orgRef/projects/:ref/members",
    { schema: { params: projectParams } },
    async (request) => ({
      data: await repo.members(await orgId(request.params.orgRef), request.params.ref),
    }),
  );

  // PUT, because the body is the complete membership. Sending it whole is what
  // keeps two callers from each adding a lead and both succeeding.
  app.put(
    "/organizations/:orgRef/projects/:ref/members",
    { schema: { params: projectParams, body: setProjectMembersSchema } },
    async (request) => ({
      data: await repo.setMembers(
        await activeOrgId(request.params.orgRef),
        request.params.ref,
        request.body,
      ),
    }),
  );
}
