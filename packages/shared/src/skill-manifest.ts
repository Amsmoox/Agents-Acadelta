// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * The skill manifest: one line per skill, placed in the agent's system prompt.
 *
 * Skill bodies are never inlined. They are mounted as files and read on demand,
 * so the context window is not spent on skills the agent is not using.
 *
 * The manifest covers the WHOLE library, including skills this agent cannot
 * use. From inside a sandbox, an installed-but-not-enabled skill is
 * indistinguishable from one that does not exist, and agents then tell people
 * that a skill they just installed "is not installed".
 */

export type SkillAvailability =
  | { state: "enabled" }
  | { state: "not_enabled" }
  | { state: "unavailable"; detail: string };

export type ManifestEntry = {
  slug: string;
  description: string;
  availability: SkillAvailability;
};

const NEWLINES = /[\r\n\u2028\u2029]+/g;
// eslint-disable-next-line no-control-regex -- stripping these is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Skill text reaches another agent's system prompt, which makes a skill author
 * an untrusted input here: a newline in a name or an error string would let
 * them append arbitrary instruction lines to that prompt.
 */
export function sanitizeManifestText(value: string, maxLength = 200): string {
  const flattened = value
    .replace(NEWLINES, " ")
    .replace(CONTROL, "")
    .trim()
    .replace(/\s{2,}/g, " ");
  return flattened.length > maxLength ? `${flattened.slice(0, maxLength - 3)}...` : flattened;
}

function describe(availability: SkillAvailability): string {
  switch (availability.state) {
    case "enabled":
      return "enabled";
    case "not_enabled":
      return "in this organization's library, not enabled for you";
    case "unavailable":
      return `enabled but unavailable: ${sanitizeManifestText(availability.detail, 120)}`;
  }
}

export function buildSkillManifest(entries: readonly ManifestEntry[]): string {
  if (entries.length === 0) {
    return "## Organization skill library\n\nThis organization has no skills yet.\n";
  }

  const lines = entries
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((entry) => {
      const slug = sanitizeManifestText(entry.slug, 80);
      const description = entry.description
        ? ` - ${sanitizeManifestText(entry.description, 160)}`
        : "";
      return `- ${slug} (${describe(entry.availability)})${description}`;
    });

  return [
    "## Organization skill library",
    "",
    "Skills marked enabled are mounted in your workspace; read one when it applies.",
    "",
    ...lines,
    "",
  ].join("\n");
}

/**
 * The system prompt, in order: who the agent is, where its instruction files
 * live, and what skills exist.
 *
 * Sent once per fresh session and never re-sent on resume — repeating it costs
 * thousands of tokens a turn for text the model already has.
 */
export function composeSystemPrompt(input: {
  instructions: string;
  instructionsPath: string;
  manifest: string;
}): string {
  return [
    input.instructions.trimEnd(),
    "",
    `The instructions above were loaded from ${input.instructionsPath}. Resolve relative references from its directory; sibling files there are authoritative.`,
    "",
    input.manifest.trimEnd(),
    "",
  ].join("\n");
}
