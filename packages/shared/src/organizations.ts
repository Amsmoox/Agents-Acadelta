// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";

/**
 * An organization is the tenant boundary. Every other entity in the system —
 * projects, agents, tasks, runs, costs — is reachable only through exactly one
 * organization, and no query may span two.
 *
 * Agents belong to the organization rather than to a project. Which agents work
 * on which projects is a separate membership relation, so an agent can serve one
 * project, several, or none without any change to this model.
 */

export const ORGANIZATION_STATUSES = ["active", "archived"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/**
 * Slugs appear in URLs and in the CLI, so the rules are deliberately narrow:
 * lowercase, digits and single inner hyphens. Reserved words are refused to keep
 * `/organizations/new` style routes free forever.
 */
export const RESERVED_SLUGS = new Set([
  "new", "edit", "admin", "api", "health", "login", "logout", "settings",
  "me", "internal", "static", "assets", "null", "undefined",
]);

export const organizationSlugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters.")
  .max(63, "Slug must be at most 63 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, digits and single hyphens.")
  .refine((s) => !RESERVED_SLUGS.has(s), "That slug is reserved.");

export const organizationNameSchema = z.string().trim().min(1).max(120);
export const organizationMissionSchema = z.string().trim().max(2000);

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
  // Omit to derive one from the name.
  slug: organizationSlugSchema.optional(),
  mission: organizationMissionSchema.optional(),
});

/**
 * Slug is absent on purpose: it is an identifier that appears in URLs, CLI
 * invocations and anything users bookmark. Renaming is a separate, explicit
 * operation rather than a side effect of editing a title.
 */
export const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema.optional(),
    mission: organizationMissionSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

export const listOrganizationsQuerySchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Opaque keyset cursor from a previous page, not an offset.
  cursor: z.string().optional(),
});

export const organizationSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  mission: z.string().nullable(),
  status: z.enum(ORGANIZATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export const organizationListSchema = z.object({
  data: z.array(organizationSchema),
  nextCursor: z.string().nullable(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export type Organization = z.infer<typeof organizationSchema>;

/**
 * Derives a candidate slug from a display name. Unicode is folded to ASCII so
 * that "Écoles Réunies" and "Ecoles Reunies" produce the same slug rather than
 * one that silently drops characters.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
