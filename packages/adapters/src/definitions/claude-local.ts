// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AdapterDefinition } from "../types.js";
import { COMMON_LOCAL_FIELDS } from "../types.js";

export const claudeLocal: AdapterDefinition = {
  type: "claude_local",
  label: "Claude Code",
  summary: "Runs the Claude Code CLI installed on this machine.",
  supportsSessionResume: true,
  supportsInstructionsBundle: true,
  requiresMaterializedSkills: true,
  runtimeToolDelivery: "native_mcp",
  configSchema: [
    {
      key: "model",
      label: "Model",
      type: "select",
      section: "runtime",
      options: [
        { value: "", label: "CLI default" },
        { value: "claude-opus-5", label: "Opus 5" },
        { value: "claude-sonnet-5", label: "Sonnet 5" },
        { value: "claude-haiku-4-5", label: "Haiku 4.5" },
      ],
      help: "Leave on CLI default to follow whatever the CLI is configured with.",
    },
    ...COMMON_LOCAL_FIELDS,
    {
      key: "maxTurnsPerRun",
      label: "Max turns per run",
      type: "number",
      section: "advanced",
      default: 1000,
      min: 1,
      help: "Stops a run that will not converge.",
    },
    {
      key: "dangerouslySkipPermissions",
      label: "Skip permission prompts",
      type: "boolean",
      section: "advanced",
      default: false,
      help: "The agent will not ask before editing files or running commands. Only for a sandboxed workspace.",
    },
    {
      key: "extraArgs",
      label: "Extra CLI arguments",
      type: "text",
      section: "advanced",
      placeholder: "--verbose",
    },
  ],
};
