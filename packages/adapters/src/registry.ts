// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";
import type { AdapterDefinition, FieldSpec } from "./types.js";
import { claudeLocal } from "./definitions/claude-local.js";
import { codexLocal } from "./definitions/codex-local.js";
import { processAdapter } from "./definitions/process.js";
import { httpAdapter } from "./definitions/http.js";

const definitions = new Map<string, AdapterDefinition>();

export function registerAdapter(definition: AdapterDefinition): void {
  definitions.set(definition.type, definition);
}

for (const definition of [claudeLocal, codexLocal, processAdapter, httpAdapter]) {
  registerAdapter(definition);
}

export function listAdapters(): AdapterDefinition[] {
  return [...definitions.values()];
}

export function getAdapter(type: string): AdapterDefinition | null {
  return definitions.get(type) ?? null;
}

export function isKnownAdapter(type: string): boolean {
  return definitions.has(type);
}

/** A field only applies when its `visibleWhen` condition holds. */
export function isFieldActive(field: FieldSpec, config: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  return config[field.visibleWhen.key] === field.visibleWhen.equals;
}

function fieldValidator(field: FieldSpec): z.ZodType {
  switch (field.type) {
    case "number": {
      let schema = z.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case "boolean":
      return z.boolean();
    case "select":
      return field.options && field.options.length > 0
        ? z.enum(field.options.map((o) => o.value) as [string, ...string[]])
        : z.string();
    default:
      return z.string();
  }
}

/**
 * Builds the validator for an adapter's config from the same declaration that
 * renders the form, so the two can never drift apart.
 *
 * Unknown keys are preserved rather than stripped: a config written by a newer
 * version, or by an adapter that has since been unregistered, must survive a
 * round trip through an older one instead of being silently erased.
 */
export function adapterConfigValidator(type: string): z.ZodType<Record<string, unknown>> {
  const definition = getAdapter(type);
  if (!definition) return z.record(z.string(), z.unknown());

  return z.record(z.string(), z.unknown()).superRefine((config, ctx) => {
    for (const field of definition.configSchema) {
      if (!isFieldActive(field, config)) continue;

      const value = config[field.key];
      const missing = value === undefined || value === null || value === "";

      if (missing) {
        if (field.required) {
          ctx.addIssue({ code: "custom", path: [field.key], message: `${field.label} is required.` });
        }
        continue;
      }

      const result = fieldValidator(field).safeParse(value);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: [field.key],
          message: `${field.label}: ${result.error.issues[0]?.message ?? "invalid value"}`,
        });
      }
    }
  });
}

/** Declared defaults, for a config that has not been saved yet. */
export function adapterConfigDefaults(type: string): Record<string, unknown> {
  const definition = getAdapter(type);
  if (!definition) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of definition.configSchema) {
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
}

/**
 * Fields whose change invalidates a resumed session. Continuing a conversation
 * against a different model or command produces confusing results rather than
 * an error, so the session is dropped instead.
 */
export const SESSION_INVALIDATING_KEYS = ["model", "provider", "command", "permissionMode"];
