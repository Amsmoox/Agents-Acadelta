// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSkillDocument } from "@agentco/shared";
import { readCatalogue, render } from "./compile.js";
import {
  catalogueCategories,
  catalogueSkills,
  getCatalogueSkill,
  searchCatalogue,
  suggestedForRole,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("the shipped catalogue", () => {
  it("has not drifted from the documents it was generated from", async () => {
    // The markdown files are the source and the generated module is a build
    // artefact. Without this, editing a skill and forgetting to regenerate
    // ships the old text — silently, because everything still compiles.
    const generated = await readFile(join(here, "generated.ts"), "utf8");
    expect(render(await readCatalogue())).toBe(generated);
  });

  it("ships skills across every discipline it claims to cover", () => {
    expect(catalogueCategories()).toEqual([
      "data",
      "design",
      "engineering",
      "marketing",
      "operations",
      "product",
      "quality",
      "security",
      "teamwork",
    ]);
  });

  it("has a unique slug for every skill", () => {
    const slugs = catalogueSkills().map((skill) => skill.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("every skill in it", () => {
  const skills = catalogueSkills();

  it.each(skills.map((skill) => [`${skill.category}/${skill.slug}`, skill] as const))(
    "%s is a valid skill document",
    (_label, skill) => {
      const document = readSkillDocument(skill.markdown);
      expect(document.valid).toBe(true);
      // The header names the file's own directory, so a copied skill that was
      // never renamed cannot slip through.
      expect(document.frontmatter["name"]).toBe(skill.slug);
    },
  );

  it.each(skills.map((skill) => [skill.slug, skill] as const))(
    "%s has a description that can route to it",
    (_slug, skill) => {
      // Only the description reaches the prompt for a skill that is not open, so
      // it has to be long enough to say when the skill applies and short enough
      // that thirty of them do not crowd out the work.
      expect(skill.description.length).toBeGreaterThanOrEqual(40);
      expect(skill.description.length).toBeLessThanOrEqual(300);
    },
  );

  it.each(skills.map((skill) => [skill.slug, skill] as const))(
    "%s says who it is for",
    (_slug, skill) => {
      expect(skill.recommendedForRoles.length).toBeGreaterThan(0);
      expect(skill.tags.length).toBeGreaterThan(0);
    },
  );

  it.each(skills.map((skill) => [skill.slug, skill] as const))(
    "%s is short enough to stay in context",
    (_slug, skill) => {
      // A skill's body sits in the prompt for the rest of the run once it is
      // opened, so every line is paid for on every turn.
      expect(skill.markdown.split("\n").length).toBeLessThanOrEqual(500);
    },
  );
});

describe("finding a skill", () => {
  it("suggests by role without installing anything", () => {
    const forQa = suggestedForRole("qa").map((skill) => skill.slug);
    expect(forQa).toContain("test-planning");
    expect(forQa).toContain("bug-reporting");
    expect(forQa).not.toContain("landing-page-copy");
  });

  it("suggests something for every role an agent can have", () => {
    // A role with nothing to suggest makes the catalogue look broken on the one
    // screen where somebody is deciding what an agent should know.
    for (const role of ["engineer", "qa", "devops", "designer", "pm", "cmo", "security", "cto"]) {
      expect(suggestedForRole(role).length).toBeGreaterThan(0);
    }
  });

  it("searches name, description, tags and role together", () => {
    expect(searchCatalogue("rollback").map((s) => s.slug)).toContain("release-and-rollback");
    expect(searchCatalogue("seo").map((s) => s.slug)).toContain("seo-audit");
    // Found by tag rather than by anything in its name.
    expect(searchCatalogue("accessibility").map((s) => s.slug)).toContain("accessibility-audit");
  });

  it("returns everything for an empty search", () => {
    expect(searchCatalogue("   ")).toHaveLength(catalogueSkills().length);
  });

  it("looks one up by slug", () => {
    expect(getCatalogueSkill("debugging")?.category).toBe("engineering");
    expect(getCatalogueSkill("no-such-skill")).toBeUndefined();
  });
});
