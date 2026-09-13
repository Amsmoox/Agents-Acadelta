// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogueSource } from "./generated.js";

/**
 * Compiles the catalogue of SKILL.md files into one TypeScript module.
 *
 * The markdown files are the source: a skill is a document, and it should be
 * readable, diffable and editable as one. Reading them from disk at run time
 * would mean shipping them beside the bundle and getting the path right in
 * three deployment shapes, so they are baked in instead.
 *
 * `catalogue.test.ts` fails when the generated module drifts from the
 * documents, which is what stops this being a copy that quietly goes stale.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_ROOT = join(here, "..", "catalogue");
export const GENERATED_FILE = join(here, "generated.ts");

export async function readCatalogue(): Promise<CatalogueSource[]> {
  const categories = (await readdir(CATALOGUE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const skills: CatalogueSource[] = [];
  for (const category of categories) {
    const slugs = (await readdir(join(CATALOGUE_ROOT, category), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const slug of slugs) {
      const markdown = await readFile(join(CATALOGUE_ROOT, category, slug, "SKILL.md"), "utf8");
      skills.push({ slug, category, markdown });
    }
  }
  return skills;
}

export function render(sources: CatalogueSource[]): string {
  const entries = sources
    .map(
      (source) =>
        `  {\n    slug: ${JSON.stringify(source.slug)},\n    category: ${JSON.stringify(source.category)},\n    markdown: ${JSON.stringify(source.markdown)},\n  },`,
    )
    .join("\n");

  return `// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

// GENERATED FILE \u2014 do not edit.
// Source: packages/skills-catalogue/catalogue/<category>/<slug>/SKILL.md
// Regenerate with: pnpm --filter @agentco/skills-catalogue build:catalogue

export type CatalogueSource = {
  slug: string;
  category: string;
  markdown: string;
};

export const CATALOGUE_SOURCES: CatalogueSource[] = [
${entries}
];
`;
}
