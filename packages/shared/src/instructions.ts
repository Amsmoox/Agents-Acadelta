// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";

/** The file an agent's identity is read from. Always present. */
export const INSTRUCTIONS_ENTRY_FILE = "AGENTS.md";

const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]");
const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const MARKDOWN_FILE = /\.(md|markdown|txt)$/i;

/**
 * Instruction paths are relative paths inside one agent's bundle, and that
 * bundle is written to disk before a run. Anything that could climb out of it,
 * name an absolute location, or resolve differently on another filesystem is
 * refused here rather than where it would do damage.
 */
export const instructionPathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.startsWith("/"), "Use a path relative to the bundle.")
  .refine((value) => !WINDOWS_DRIVE.test(value), "Use a path relative to the bundle.")
  .refine(
    (value) => !value.split("/").some((segment) => segment === ".." || segment === "."),
    "Paths cannot navigate outside the bundle.",
  )
  .refine((value) => !value.includes(String.fromCharCode(92)), "Use forward slashes.")
  .refine((value) => !CONTROL_CHARS.test(value), "Paths cannot contain control characters.")
  .refine((value) => !value.endsWith("/"), "That is a directory, not a file.")
  .refine((value) => MARKDOWN_FILE.test(value), "Instruction files must be markdown.");

export const writeInstructionFileSchema = z.object({
  path: instructionPathSchema,
  content: z.string().max(500_000),
});

export const instructionFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  updatedAt: z.iso.datetime(),
});

export type InstructionFile = z.infer<typeof instructionFileSchema>;
export type WriteInstructionFileInput = z.infer<typeof writeInstructionFileSchema>;

/** What a new agent starts with, so it never runs with no identity at all. */
export function defaultInstructions(agentName: string, role: string): string {
  return `# ${agentName}

You are ${agentName}, a ${role} in this organization.

## What you do

Describe this agent's job in a sentence or two. Be specific about what it owns,
and about what it does not.

## How you work

- Read the task and its parent chain before starting, so you know why the work
  matters and not only what was asked.
- When something is ambiguous, ask once and clearly, and keep working on the
  parts that are not blocked by the answer.
- Finish by stating what you did and what you deliberately did not do.

## What you never do

List what this agent must escalate rather than decide on its own.
`;
}
