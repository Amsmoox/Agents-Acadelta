// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationListSchema,
  organizationSchema,
  updateOrganizationSchema,
} from "@agentco/shared";
import { createOrganizationRepository } from "./repository.js";

const refParamsSchema = z.object({
  // A UUID or a slug — the repository decides which.
  ref: z.string().min(1).max(63),
});

export async function registerOrganizationRoutes(instance: FastifyInstance) {
  const repo = createOrganizationRepository(instance.db);
  // Routes are declared on the Zod-typed view of the instance so that request
  // bodies, params and querystrings are inferred from the schemas above.
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/organizations",
    { schema: { body: createOrganizationSchema, response: { 201: organizationSchema } } },
    async (request, reply) => {
      const organization = await repo.create(request.body);
      return reply.status(201).send(organization);
    },
  );

  app.get(
    "/organizations",
    { schema: { querystring: listOrganizationsQuerySchema, response: { 200: organizationListSchema } } },
    async (request) => repo.list(request.query),
  );

  app.get(
    "/organizations/:ref",
    { schema: { params: refParamsSchema, response: { 200: organizationSchema } } },
    async (request) => repo.requireByRef(request.params.ref),
  );

  app.patch(
    "/organizations/:ref",
    {
      schema: {
        params: refParamsSchema,
        body: updateOrganizationSchema,
        response: { 200: organizationSchema },
      },
    },
    async (request) => repo.update(request.params.ref, request.body),
  );

  // POST, not DELETE: archiving is a state change that keeps every task, run and
  // audit row in the tenant intact. Nothing here destroys data.
  app.post(
    "/organizations/:ref/archive",
    { schema: { params: refParamsSchema, response: { 200: organizationSchema } } },
    async (request) => repo.setArchived(request.params.ref, true),
  );

  app.post(
    "/organizations/:ref/restore",
    { schema: { params: refParamsSchema, response: { 200: organizationSchema } } },
    async (request) => repo.setArchived(request.params.ref, false),
  );
}
