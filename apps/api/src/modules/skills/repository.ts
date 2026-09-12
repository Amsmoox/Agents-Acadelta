// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agentSkills, skills, type Database, type SkillRow } from "@agentco/db";
import {
  AppError,
  buildSkillManifest,
  readSkillDocument,
  skillTemplate,
  slugify,
  type CreateSkillInput,
  type ManifestEntry,
  type Skill,
  type UpdateSkillInput,
} from "@agentco/shared";

const UNIQUE_VIOLATION = "23505";
const MAX_SLUG_ATTEMPTS = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    markdown: row.markdown,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createSkillRepository(db: Database) {
  async function findRow(organizationId: string, ref: string): Promise<SkillRow | null> {
    const match = UUID_RE.test(ref)
      ? eq(skills.id, ref)
      : eq(sql`lower(${skills.slug})`, ref.toLowerCase());
    const [row] = await db
      .select()
      .from(skills)
      .where(and(eq(skills.organizationId, organizationId), match))
      .limit(1);
    return row ?? null;
  }

  async function requireRow(organizationId: string, ref: string): Promise<SkillRow> {
    const row = await findRow(organizationId, ref);
    if (!row) throw new AppError("SKILL_NOT_FOUND", { ref });
    return row;
  }

  /**
   * The header is the contract: name and description are what an agent reads
   * before deciding whether to open the body, and they are what the manifest
   * line is built from. A document whose header does not parse is refused here
   * rather than producing a skill nothing can describe.
   */
  function headerFrom(markdown: string, fallbackSlug: string, fallbackName: string) {
    const document = readSkillDocument(markdown);
    if (!document.valid) {
      throw new AppError("SKILL_HEADER_INVALID", { issues: document.issues });
    }
    return {
      slug: document.frontmatter.name ?? fallbackSlug,
      description: document.frontmatter.description ?? null,
      name: fallbackName,
    };
  }

  return {
    async create(organizationId: string, input: CreateSkillInput): Promise<Skill> {
      const base = input.slug ?? slugify(input.name);
      if (base.length < 2) throw new AppError("SKILL_SLUG_TAKEN", { name: input.name });

      const insert = async (slug: string) => {
        const markdown =
          input.markdown ?? skillTemplate(slug, input.description ?? `What ${input.name} does.`);
        const header = headerFrom(markdown, slug, input.name);

        const [row] = await db
          .insert(skills)
          .values({
            organizationId,
            // The header is authoritative: the document and the row must agree,
            // or the manifest describes something the agent will not find.
            slug: header.slug,
            name: input.name,
            description: input.description ?? header.description,
            markdown,
          })
          .returning();
        if (!row) throw new AppError("INTERNAL");
        return toSkill(row);
      };

      if (input.slug) {
        try {
          return await insert(input.slug);
        } catch (error) {
          if (isUniqueViolation(error)) throw new AppError("SKILL_SLUG_TAKEN", { slug: input.slug });
          throw error;
        }
      }

      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        try {
          return await insert(`${base.slice(0, 63 - suffix.length)}${suffix}`);
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
      }
      throw new AppError("SKILL_SLUG_TAKEN", { name: input.name });
    },

    async list(organizationId: string): Promise<Skill[]> {
      const rows = await db
        .select()
        .from(skills)
        .where(eq(skills.organizationId, organizationId))
        .orderBy(desc(skills.createdAt), desc(skills.id))
        .limit(500);
      return rows.map(toSkill);
    },

    async get(organizationId: string, ref: string): Promise<Skill> {
      return toSkill(await requireRow(organizationId, ref));
    },

    async update(organizationId: string, ref: string, input: UpdateSkillInput): Promise<Skill> {
      const existing = await requireRow(organizationId, ref);
      const markdown = input.markdown ?? existing.markdown;
      const header =
        input.markdown !== undefined
          ? headerFrom(markdown, existing.slug, input.name ?? existing.name)
          : null;

      const [row] = await db
        .update(skills)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.markdown !== undefined
            ? { markdown, slug: header?.slug ?? existing.slug, description: header?.description ?? existing.description }
            : {}),
        })
        .where(eq(skills.id, existing.id))
        .returning();
      if (!row) throw new AppError("SKILL_NOT_FOUND", { ref });
      return toSkill(row);
    },

    async remove(organizationId: string, ref: string): Promise<void> {
      const existing = await requireRow(organizationId, ref);
      // Enabled rows fall with it through the composite foreign key, so no
      // agent is left pointing at a skill that no longer exists.
      await db.delete(skills).where(eq(skills.id, existing.id));
    },

    async enabledFor(organizationId: string, agentId: string): Promise<string[]> {
      const rows = await db
        .select({ skillId: agentSkills.skillId })
        .from(agentSkills)
        .where(
          and(eq(agentSkills.organizationId, organizationId), eq(agentSkills.agentId, agentId)),
        );
      return rows.map((row) => row.skillId);
    },

    /**
     * Replaces the whole enabled set rather than adding and removing one at a
     * time, so two people editing the same agent cannot interleave into a state
     * neither of them chose.
     */
    async setEnabled(
      organizationId: string,
      agentId: string,
      skillIds: string[],
    ): Promise<string[]> {
      const unique = [...new Set(skillIds)];

      if (unique.length > 0) {
        const found = await db
          .select({ id: skills.id })
          .from(skills)
          .where(and(eq(skills.organizationId, organizationId), inArray(skills.id, unique)));
        if (found.length !== unique.length) {
          const known = new Set(found.map((row) => row.id));
          throw new AppError("SKILL_NOT_FOUND", {
            unknown: unique.filter((id) => !known.has(id)),
          });
        }
      }

      return db.transaction(async (tx) => {
        await tx
          .delete(agentSkills)
          .where(
            and(eq(agentSkills.organizationId, organizationId), eq(agentSkills.agentId, agentId)),
          );
        if (unique.length > 0) {
          await tx
            .insert(agentSkills)
            .values(unique.map((skillId) => ({ organizationId, agentId, skillId })));
        }
        return unique;
      });
    },

    /**
     * The manifest lists every skill in the organization, not only the enabled
     * ones — an agent that cannot see a skill it has not been given will report
     * it as nonexistent.
     */
    async manifestFor(organizationId: string, agentId: string): Promise<string> {
      const [library, enabled] = await Promise.all([
        this.list(organizationId),
        this.enabledFor(organizationId, agentId),
      ]);
      const enabledIds = new Set(enabled);

      const entries: ManifestEntry[] = library.map((skill) => ({
        slug: skill.slug,
        description: skill.description ?? "",
        availability: enabledIds.has(skill.id) ? { state: "enabled" } : { state: "not_enabled" },
      }));

      return buildSkillManifest(entries);
    },
  };
}

export type SkillRepository = ReturnType<typeof createSkillRepository>;
