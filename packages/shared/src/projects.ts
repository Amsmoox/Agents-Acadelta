// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";
import { slugify } from "./organizations.js";

/**
 * A project is a body of work inside one organization.
 *
 * Agents belong to the organization, not to a project, so which agents may be
 * assigned work here is a separate membership relation. Membership is a guard,
 * not a record of activity: being a member means "may be given work on this",
 * and nothing else follows from it.
 */

export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_MEMBER_ROLES = ["lead", "member"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const projectSlugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters.")
  .max(63, "Slug must be at most 63 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits and single hyphens.");

/**
 * The prefix on every task key in the project: the "X" in X-14.
 *
 * Short because it is typed and read constantly, and letters-first because a
 * key beginning with a digit reads as a number rather than a name.
 */
export const taskPrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(1, "Prefix must be at least 1 character.")
      .max(6, "Prefix must be at most 6 characters.")
      .regex(/^[A-Z][A-Z0-9]*$/, "Prefix must start with a letter and use only letters and digits."),
  );

export const projectNameSchema = z.string().trim().min(1).max(120);
export const projectSummarySchema = z.string().trim().max(500);
export const projectBriefSchema = z.string().trim().max(20_000);

export const createProjectSchema = z.object({
  name: projectNameSchema,
  // Omit either to derive one from the name.
  slug: projectSlugSchema.optional(),
  taskPrefix: taskPrefixSchema.optional(),
  summary: projectSummarySchema.optional(),
  brief: projectBriefSchema.optional(),
});

/**
 * Slug and taskPrefix are absent on purpose. Both appear in things people
 * bookmark and quote at each other — a URL, and every task key ever written
 * down — so neither changes as a side effect of editing a title.
 */
export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    summary: projectSummarySchema.nullable().optional(),
    brief: projectBriefSchema.nullable().optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

export const listProjectsQuerySchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

/**
 * The complete membership, sent whole rather than as add/remove operations.
 *
 * One statement replacing the set cannot interleave with another the way two
 * callers each adding a member can, and it is the same reason an agent's
 * enabled skills are written the same way.
 */
export const setProjectMembersSchema = z.object({
  members: z
    .array(
      z.object({
        agentId: z.uuid(),
        role: z.enum(PROJECT_MEMBER_ROLES).default("member"),
      }),
    )
    .max(200)
    .refine(
      (members) => new Set(members.map((m) => m.agentId)).size === members.length,
      "An agent can only appear once.",
    )
    .refine(
      (members) => members.filter((m) => m.role === "lead").length <= 1,
      "A project has at most one lead.",
    ),
});

export const projectSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  brief: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  taskPrefix: z.string(),
  memberCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export const projectMemberSchema = z.object({
  agentId: z.uuid(),
  role: z.enum(PROJECT_MEMBER_ROLES),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  adapterType: z.string(),
  title: z.string().nullable(),
  /**
   * The company reporting line, carried so the project can draw its team as a
   * tree. A project has no hierarchy of its own — it draws the organization's,
   * filtered to its members — and two structures that could disagree is
   * precisely what that avoids.
   */
  reportsTo: z.uuid().nullable(),
  addedAt: z.iso.datetime(),
});

export const projectListSchema = z.object({
  data: z.array(projectSchema),
  nextCursor: z.string().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type SetProjectMembersInput = z.infer<typeof setProjectMembersSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectSlugify = slugify;

/**
 * Suggests a task prefix from a project name.
 *
 * Initials for a name with several words, because "Checkout Rewrite" reading as
 * CR is how people already abbreviate it out loud; the opening letters
 * otherwise. Only ever a suggestion — the prefix is permanent, so the person
 * creating the project gets the final say.
 */
export function deriveTaskPrefix(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  if (words.length === 0) return "";

  const initials = words.map((word) => word[0] ?? "").join("");
  const candidate = initials.length >= 2 ? initials : (words[0] ?? "").slice(0, 3);

  // Leading digits would make the key read as a number; drop them rather than
  // produce something the schema will only reject.
  return candidate.replace(/^[0-9]+/, "").slice(0, 6);
}
