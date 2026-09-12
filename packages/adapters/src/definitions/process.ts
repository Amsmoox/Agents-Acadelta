// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AdapterDefinition } from "../types.js";
import { COMMON_LOCAL_FIELDS } from "../types.js";

/** Any command that reads a prompt and writes output. The escape hatch. */
export const processAdapter: AdapterDefinition = {
  type: "process",
  label: "Shell command",
  summary: "Runs any command you give it. Use when nothing else fits.",
  configSchema: [
    {
      key: "command",
      label: "Command",
      type: "text",
      section: "connection",
      required: true,
      placeholder: "/usr/local/bin/my-agent",
    },
    {
      key: "args",
      label: "Arguments",
      type: "text",
      section: "connection",
      placeholder: "--flag, value",
      help: "Comma separated.",
    },
    ...COMMON_LOCAL_FIELDS,
  ],
};
