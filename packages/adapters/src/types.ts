// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * An adapter describes how to run one kind of agent.
 *
 * Adapters DECLARE their configuration rather than shipping a form. One generic
 * renderer walks the declaration, and the same declaration generates the
 * validator — so the form and the API can never disagree about what is valid,
 * and adding an adapter touches no UI code.
 *
 * The alternative, hand-writing each adapter's fields as components, is what
 * produces a four-thousand-line configuration form.
 */

export type FieldSection = "connection" | "runtime" | "advanced";

export type FieldOption = { value: string; label: string };

export type FieldSpec = {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select" | "path" | "textarea";
  section: FieldSection;
  required?: boolean;
  default?: string | number | boolean;
  options?: FieldOption[];
  placeholder?: string;
  help?: string;
  /** Shown only when another field holds a given value. Declarative, not code. */
  visibleWhen?: { key: string; equals: string | number | boolean };
  /** Accepts a reference to a stored secret instead of a literal value. */
  secretRef?: boolean;
  min?: number;
  max?: number;
};

export type AdapterDefinition = {
  type: string;
  label: string;
  /** One line, shown on the adapter tile during creation. */
  summary: string;
  /** Hidden from the picker but still valid for existing agents. */
  hidden?: boolean;
  experimental?: boolean;
  configSchema: FieldSpec[];

  // Capability flags. The server reads these instead of branching on `type`,
  // so an adapter added later needs no server change.
  supportsSessionResume?: boolean;
  supportsInstructionsBundle?: boolean;
  requiresMaterializedSkills?: boolean;
  runtimeToolDelivery?: "native_mcp" | "environment" | "invocation_context";
};

/**
 * Fields common to every adapter that runs a local command. Declared once so
 * the same knob never drifts between adapters.
 */
export const COMMON_LOCAL_FIELDS: FieldSpec[] = [
  {
    key: "cwd",
    label: "Working directory",
    type: "path",
    section: "runtime",
    placeholder: "/Users/you/code/project",
    help: "Where the agent runs. Leave empty to use the project workspace.",
  },
  {
    key: "timeoutSec",
    label: "Timeout",
    type: "number",
    section: "advanced",
    default: 0,
    min: -1,
    help: "Seconds before a run is cancelled. 0 uses the target default; -1 disables it entirely.",
  },
  {
    key: "graceSec",
    label: "Interrupt grace period",
    type: "number",
    section: "advanced",
    default: 15,
    min: 1,
    help: "Seconds to wait after asking a run to stop, before forcing it.",
  },
];
