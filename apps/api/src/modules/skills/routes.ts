// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createSkillSchema,
  installCatalogueSkillsSchema,
  setAgentSkillsSchema,
  updateSkillSchema,
  writeInstructionFileSchema,
} from "@agentco/shared";
import {
  catalogueCategories,
  catalogueSkills,
  getCatalogueSkill,
  searchCatalogue,
  suggestedForRole,
} from "@agentco/skills-catalogue";
import { createOrganizationRepository } from "../organizations/repository.js";
import { createAgentRepository } from "../agents/repository.js";
import { createInstructionRepository, createSkillRepository } from "@agentco/core";
import { AppError } from "@agentco/shared";

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
  /** Knowledge is configuration: readable while archived, not editable. */
  const activeOrgId = async (ref: string) => (await organizations.requireActiveByRef(ref)).id;
  const agentId = async (org: string, ref: string) => (await agents.get(org, ref)).id;

  // ---- the catalogue that ships with the product ----

  /**
   * Read without naming an organization: the catalogue is the same for
   * everybody, and it is the one part of this API that is not tenant data.
   */
  app.get(
    "/skill-catalogue",
    { schema: { querystring: z.object({ q: z.string().optional(), role: z.string().optional() }) } },
    async (request) => {
      const byRole = request.query.role ? suggestedForRole(request.query.role) : null;
      const matches = request.query.q ? searchCatalogue(request.query.q) : catalogueSkills();
      const data = byRole
        ? matches.filter((skill) => byRole.some((suggestion) => suggestion.slug === skill.slug))
        : matches;

      return { categories: catalogueCategories(), data };
    },
  );

  app.get(
    "/skill-catalogue/:slug",
    { schema: { params: z.object({ slug: z.string().min(1).max(63) }) } },
    async (request) => {
      const skill = getCatalogueSkill(request.params.slug);
      if (!skill) throw new AppError("SKILL_NOT_FOUND", { slug: request.params.slug });
      return skill;
    },
  );

  /**
   * The same catalogue, but told which of it this organization already has.
   *
   * One request rather than two and a client-side join, because the answer
   * differs per organization and getting it wrong shows an Install button on
   * something already installed.
   */
  app.get(
    "/organizations/:orgRef/skill-catalogue",
    {
      schema: {
        params: orgParams,
        querystring: z.object({ q: z.string().optional(), role: z.string().optional() }),
      },
    },
    async (request) => {
      const org = await orgId(request.params.orgRef);
      const owned = new Set(
        (await skills.list(org)).map((skill) => skill.catalogueSlug).filter(Boolean),
      );

      const byRole = request.query.role ? suggestedForRole(request.query.role) : null;
      const matches = request.query.q ? searchCatalogue(request.query.q) : catalogueSkills();
      const data = (
        byRole
          ? matches.filter((skill) => byRole.some((suggestion) => suggestion.slug === skill.slug))
          : matches
      ).map((skill) => ({ ...skill, installed: owned.has(skill.slug) }));

      return { categories: catalogueCategories(), data };
    },
  );

  app.post(
    "/organizations/:orgRef/skill-catalogue/install",
    { schema: { params: orgParams, body: installCatalogueSkillsSchema } },
    async (request) => {
      const org = await activeOrgId(request.params.orgRef);

      const entries = request.body.slugs.map((slug) => {
        const skill = getCatalogueSkill(slug);
        if (!skill) throw new AppError("SKILL_NOT_FOUND", { slug });
        return {
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          markdown: skill.markdown,
          contentHash: skill.contentHash,
        };
      });

      return skills.installFromCatalogue(org, entries);
    },
  );

  // ---- the organization's skill library ----

  app.post(
    "/organizations/:orgRef/skills",
    { schema: { params: orgParams, body: createSkillSchema } },
    async (request, reply) => {
      const skill = await skills.create(await activeOrgId(request.params.orgRef), request.body);
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
      skills.update(await activeOrgId(request.params.orgRef), request.params.ref, request.body),
  );

  app.delete(
    "/organizations/:orgRef/skills/:ref",
    { schema: { params: skillParams } },
    async (request, reply) => {
      await skills.remove(await activeOrgId(request.params.orgRef), request.params.ref);
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
      const org = await activeOrgId(request.params.orgRef);
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
      const org = await activeOrgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      return instructions.write(org, agent, request.body.path, request.body.content);
    },
  );

  // A wildcard, because an instruction path contains slashes.
  app.delete(
    "/organizations/:orgRef/agents/:ref/instructions/*",
    { schema: { params: filePathParams } },
    async (request, reply) => {
      const org = await activeOrgId(request.params.orgRef);
      const agent = await agentId(org, request.params.ref);
      await instructions.remove(org, agent, request.params["*"]);
      return reply.status(204).send();
    },
  );
}
