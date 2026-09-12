// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";

/**
 * An agent is four separable things: identity (who it is), harness (how it
 * runs), knowledge (what it knows — Phase 2) and governance (who controls it).
 * Keeping them apart is what stops the configuration surface collapsing into
 * one unmanageable form.
 */

/**
 * Roles are a closed set because delegation routes on them. A free-text role
 * cannot be routed on, and every system that tried ends up pattern-matching
 * strings. The human-readable job description lives in `title`, which is free.
 */
export const AGENT_ROLES = [
  "ceo", "cto", "cmo", "cfo",
  "engineer", "designer", "pm", "qa", "devops", "researcher", "security",
  "general",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO", cto: "CTO", cmo: "CMO", cfo: "CFO",
  engineer: "Engineer", designer: "Designer", pm: "Product manager",
  qa: "QA", devops: "DevOps", researcher: "Researcher", security: "Security",
  general: "General",
};

export const AGENT_STATUSES = [
  "pending_approval",
  "idle",
  "running",
  "paused",
  "error",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Never listed in a roster or org tree, at any filter. */
export const HIDDEN_AGENT_STATUSES: readonly AgentStatus[] = ["terminated"];

/** A run may not start while the agent is in one of these. */
export const NON_INVOKABLE_STATUSES: readonly AgentStatus[] = [
  "paused",
  "terminated",
  "pending_approval",
];

export const PAUSE_REASONS = ["manual", "budget", "system"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export const agentNameSchema = z.string().trim().min(1).max(120);
export const agentSlugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits and single hyphens.");

export const agentPermissionsSchema = z
  .object({
    canCreateAgents: z.boolean().optional(),
    canCreateSkills: z.boolean().optional(),
    canAssignTasks: z.boolean().optional(),
  })
  .catchall(z.unknown());

export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;

/**
 * Defaults differ by context on purpose. A freshly created agent may be given
 * authority; a stored record that simply omits the field must never be read as
 * granting it, or a permission can appear through a schema change.
 */
export function defaultAgentPermissions(context: "create" | "stored"): Required<
  Pick<AgentPermissions, "canCreateAgents" | "canCreateSkills" | "canAssignTasks">
> {
  return {
    canCreateAgents: context === "create",
    canCreateSkills: true,
    canAssignTasks: context === "create",
  };
}

export const createAgentSchema = z.object({
  name: agentNameSchema,
  slug: agentSlugSchema.optional(),
  role: z.enum(AGENT_ROLES).default("general"),
  title: z.string().trim().max(120).optional(),
  icon: z.string().trim().max(60).optional(),
  capabilities: z.string().trim().max(2000).optional(),
  reportsTo: z.uuid().nullable().optional(),
  adapterType: z.string().min(1).max(60),
  adapterConfig: z.record(z.string(), z.unknown()).default({}),
  budgetMonthlyCents: z.number().int().min(0).default(0),
  permissions: agentPermissionsSchema.optional(),
});

export const updateAgentSchema = z
  .object({
    name: agentNameSchema.optional(),
    role: z.enum(AGENT_ROLES).optional(),
    title: z.string().trim().max(120).nullable().optional(),
    icon: z.string().trim().max(60).nullable().optional(),
    capabilities: z.string().trim().max(2000).nullable().optional(),
    reportsTo: z.uuid().nullable().optional(),
    adapterType: z.string().min(1).max(60).optional(),
    adapterConfig: z.record(z.string(), z.unknown()).optional(),
    budgetMonthlyCents: z.number().int().min(0).optional(),
    permissions: agentPermissionsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

/** Fields that are versioned. Lifecycle and spend are not configuration. */
export const CONFIG_REVISION_FIELDS = [
  "name", "role", "title", "icon", "capabilities", "reportsTo",
  "adapterType", "adapterConfig", "budgetMonthlyCents",
] as const;
export type ConfigRevisionField = (typeof CONFIG_REVISION_FIELDS)[number];

export const agentSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: z.enum(AGENT_ROLES),
  title: z.string().nullable(),
  icon: z.string().nullable(),
  capabilities: z.string().nullable(),
  reportsTo: z.uuid().nullable(),
  adapterType: z.string(),
  adapterConfig: z.record(z.string(), z.unknown()),
  status: z.enum(AGENT_STATUSES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  pausedAt: z.iso.datetime().nullable(),
  errorReason: z.string().nullable(),
  permissions: agentPermissionsSchema,
  budgetMonthlyCents: z.number().int(),
  spentMonthlyCents: z.number().int(),
  lastHeartbeatAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Agent = z.infer<typeof agentSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const listAgentsQuerySchema = z.object({
  status: z.enum(AGENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const pauseAgentSchema = z.object({
  reason: z.enum(PAUSE_REASONS).default("manual"),
});
