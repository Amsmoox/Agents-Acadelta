// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createHash } from "node:crypto";
import { readSkillDocument } from "@agentco/shared";
import { CATALOGUE_SOURCES } from "./generated.js";

/**
 * Skills that ship with the product.
 *
 * They are ordinary `SKILL.md` documents, written to the same format anybody
 * can write by hand — there is no privileged built-in format, and that is
 * deliberate: a catalogue skill you cannot read, edit or replace is a black box
 * in the middle of an agent's instructions.
 *
 * Installing one copies it into the organization's own library. From that moment
 * it belongs to the organization and can be edited freely; the catalogue keeps
 * the hash of what was installed so the difference is visible, not so the copy
 * can be overwritten.
 */

export type CatalogueSkill = {
  slug: string;
  category: string;
  name: string;
  description: string;
  tags: string[];
  recommendedForRoles: string[];
  markdown: string;
  /** Of the document as shipped, so a modified copy can be told from a pristine one. */
  contentHash: string;
};

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.trim() !== "") return [value];
  return [];
}

function build(): CatalogueSkill[] {
  return CATALOGUE_SOURCES.map((source) => {
    const document = readSkillDocument(source.markdown);
    const header = document.frontmatter;

    return {
      slug: source.slug,
      category: source.category,
      name: typeof header["name"] === "string" ? header["name"] : source.slug,
      description: typeof header["description"] === "string" ? header["description"] : "",
      tags: list(header["tags"]),
      recommendedForRoles: list(header["recommendedForRoles"]),
      markdown: source.markdown,
      contentHash: createHash("sha256").update(source.markdown).digest("hex"),
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));
}

const CATALOGUE = build();

export function catalogueSkills(): CatalogueSkill[] {
  return CATALOGUE;
}

export function catalogueCategories(): string[] {
  return [...new Set(CATALOGUE.map((skill) => skill.category))].sort();
}

export function getCatalogueSkill(slug: string): CatalogueSkill | undefined {
  return CATALOGUE.find((skill) => skill.slug === slug);
}

/**
 * The skills worth suggesting for a role.
 *
 * A suggestion, never an installation: which skills an agent has is a decision
 * somebody makes, and a catalogue that silently attaches things is one nobody
 * can reason about.
 */
export function suggestedForRole(role: string): CatalogueSkill[] {
  return CATALOGUE.filter((skill) => skill.recommendedForRoles.includes(role));
}

/** Substring match across everything a person might type. */
export function searchCatalogue(query: string): CatalogueSkill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CATALOGUE;
  return CATALOGUE.filter((skill) =>
    [skill.slug, skill.name, skill.description, skill.category, ...skill.tags, ...skill.recommendedForRoles]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

export { CATALOGUE_SOURCES };
