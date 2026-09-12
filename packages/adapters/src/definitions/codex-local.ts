// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AdapterDefinition } from "../types.js";
import { COMMON_LOCAL_FIELDS } from "../types.js";

export const codexLocal: AdapterDefinition = {
  type: "codex_local",
  label: "Codex",
  summary: "Runs the OpenAI Codex CLI installed on this machine.",
  supportsSessionResume: true,
  supportsInstructionsBundle: true,
  requiresMaterializedSkills: true,
  runtimeToolDelivery: "invocation_context",
  configSchema: [
    {
      key: "model",
      label: "Model",
      type: "text",
      section: "runtime",
      placeholder: "gpt-5-codex",
      help: "Leave empty to follow the CLI's configured model.",
    },
    {
      key: "permissionMode",
      label: "Permission mode",
      type: "select",
      section: "runtime",
      default: "workspace-write",
      options: [
        { value: "read-only", label: "Read only" },
        { value: "workspace-write", label: "Write inside the workspace" },
        { value: "danger-full-access", label: "Full access" },
      ],
    },
    ...COMMON_LOCAL_FIELDS,
    {
      key: "maxIterations",
      label: "Maximum iterations",
      type: "number",
      section: "advanced",
      default: 200,
      min: 1,
    },
    {
      key: "extraArgs",
      label: "Extra CLI arguments",
      type: "text",
      section: "advanced",
    },
  ],
};
