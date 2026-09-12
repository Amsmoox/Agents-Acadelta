// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createSkillSchema,
  setAgentSkillsSchema,
  updateSkillSchema,
  writeInstructionFileSchema,
} from "@agentco/shared";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createAgentRepository } from "../agents/repository.js";
import { createInstructionRepository, createSkillRepository } from "@agentco/core";

const orgParams = z.object({ orgRef: z.string().min(1).max(63) });
const skillParams = orgParams.extend({ ref: z.string().min(1).max(63) });
const agentParams = orgParams.extend({ ref: z.string().min(1).max(63) });
const filePathParams = agentParams.extend({ "*": z.string().min(1).max(200) });

/**
 * What an agent knows: its instruction bundle, and which of the organization's
 * skills it has enabled.
 */
export async function registerKnowledgeRoutes(instance: FastifyInstance) {
  const organizations = createOrganizationRepository(instance.db);
  const agents = createAgentRepository(instance.db);
  const skills = createSkillRepository(instance.db);
  const instructions = createInstructionRepository(instance.db);
  const app = instance.withTypeProvider<ZodTypeProvider>();

  const orgId = async (ref: string) => (await organizations.requireByRef(ref)).id;
  const agentId = async (org: string, ref: string) => (await agents.get(org, ref)).id;

  // ---- the organization's skill library ----

  app.post(
    "/organizations/:orgRef/skills",
    { schema: { params: orgParams, body: createSkillSchema } },
    async (request, reply) => {
      const skill = await skills.create(await orgId(request.params.orgRef), request.body);
      return reply.status(201).send(skill);
    },
  );

  app.get(
    "/organizations/:orgRef/skills",
    { schema: { params: orgParams } },
    async (request) => ({ data: await skills.list(await orgId(request.params.orgRef)) }),
  );

  app.get(
    "/organizations/:orgRef/skills/:ref",
    { schema: { params: skillParams } },
    async (request) => skills.get(await orgId(request.params.orgRef), request.params.ref),
  );

  app.patch(
    "/organizations/:orgRef/skills/:ref",
    { schema: { params: skillParams, body: updateSkillSchema } },
    async (request) =>
      skills.update(await orgId(request.params.orgRef), request.params.ref, request.body),
  );

  app.delete(
    "/organizations/:orgRef/skills/:ref",
    { schema: { params: skillParams } },
    async (request, reply) => {
      await skills.remove(await orgId(request.params.orgRef), request.params.ref);
      return reply.status(204).send();
    },
  );

  // ---- which skills an agent has ----

  app.get(
    "/organizations/:orgRef/agents/:ref/skills",
    { schema: { params: agentParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return { data: await skills.enabledFor(org, agent) };
    },
  );

  app.put(
    "/organizations/:orgRef/agents/:ref/skills",
    { schema: { params: agentParams, body: setAgentSkillsSchema } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return { data: await skills.setEnabled(org, agent, request.body.skillIds) };
    },
  );

  /**
   * The manifest exactly as it will appear in the agent's system prompt.
   *
   * Exposed because a prompt an operator cannot read is a prompt they cannot
   * debug, and because it makes the sanitising testable from outside.
   */
  app.get(
    "/organizations/:orgRef/agents/:ref/skills/manifest",
    { schema: { params: agentParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return { manifest: await skills.manifestFor(org, agent) };
    },
  );

  // ---- the agent's instruction bundle ----

  app.get(
    "/organizations/:orgRef/agents/:ref/instructions",
    { schema: { params: agentParams } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return { data: await instructions.list(org, agent) };
    },
  );

  app.put(
    "/organizations/:orgRef/agents/:ref/instructions",
    { schema: { params: agentParams, body: writeInstructionFileSchema } },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return instructions.write(org, agent, request.body.path, request.body.content);
    },
  );

  // A wildcard, because an instruction path contains slashes.
  app.delete(
    "/organizations/:orgRef/agents/:ref/instructions/*",
    { schema: { params: filePathParams } },
    async (request, reply) => {
      const org = await orgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      await instructions.remove(org, agent, request.params["*"]);
      return reply.status(204).send();
    },
  );
}
