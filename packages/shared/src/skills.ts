// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * A skill is a document an agent reads when it decides the skill applies: a
 * `SKILL.md` with a small front-matter header and prose beneath it.
 *
 * The header is deliberately thin. Only `name` and `description` are required,
 * because those two are all an agent needs in order to decide whether to read
 * the rest — which is the whole point of keeping skill bodies out of the prompt.
 */

export const SKILL_ENTRY_FILE = "SKILL.md";

export const skillSlugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens.");

export const skillFrontmatterSchema = z.object({
  name: skillSlugSchema,
  description: z.string().trim().min(1).max(500),
  tags: z.array(z.string()).optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export const createSkillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: skillSlugSchema.optional(),
  description: z.string().trim().max(500).optional(),
  markdown: z.string().max(200_000).optional(),
});

export const updateSkillSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    markdown: z.string().max(200_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

export const skillSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  markdown: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Skill = z.infer<typeof skillSchema>;
export type CreateSkillInput = z.infer<typeof createSkillSchema>;
export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;

export const setAgentSkillsSchema = z.object({
  /** The complete enabled set; sending it whole avoids add/remove races. */
  skillIds: z.array(z.uuid()).max(500),
});

/**
 * Reads a `SKILL.md`, reporting what the header claims and whether it is valid.
 *
 * An invalid header is reported rather than thrown. A skill someone is still
 * writing should stay visible and be marked as incomplete, not disappear.
 */
export function readSkillDocument(markdown: string): {
  frontmatter: Partial<SkillFrontmatter>;
  body: string;
  valid: boolean;
  issues: string[];
} {
  const parsed = parseFrontmatter(markdown);
  const result = skillFrontmatterSchema.safeParse(parsed.frontmatter);

  return {
    frontmatter: result.success ? result.data : (parsed.frontmatter as Partial<SkillFrontmatter>),
    body: parsed.body,
    valid: result.success,
    issues: result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join(".") || "header"}: ${issue.message}`),
  };
}

export function skillTemplate(slug: string, description: string): string {
  return `---
name: ${slug}
description: ${description}
---

# ${slug}

## When to use

## When not to use

## Steps
`;
}
