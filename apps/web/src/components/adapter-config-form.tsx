// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FieldSpec } from "@agentco/adapters";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Renders an agent's settings from the adapter's own declaration.
 *
 * There is no per-adapter component anywhere in this app. Adding an agent type
 * is a server-side declaration and nothing else — which is what stops this file
 * growing into the thousand-line conditional that every configuration form
 * eventually becomes.
 */

const SECTION_LABEL: Record<FieldSpec["section"], string> = {
  connection: "Connection",
  runtime: "Runtime",
  advanced: "Advanced",
};

const SECTION_ORDER: FieldSpec["section"][] = ["connection", "runtime", "advanced"];

function isVisible(field: FieldSpec, config: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  return config[field.visibleWhen.key] === field.visibleWhen.equals;
}

function Control({
  field,
  value,
  onChange,
  props,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined };
}) {
  switch (field.type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            {...props}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="size-3.5 rounded-[2px] border-line accent-[var(--ink)]"
          />
          {field.help ?? field.label}
        </label>
      );

    case "select":
      return (
        <select
          {...props}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-8 w-full max-w-96 rounded-[var(--radius-md)] border border-line bg-surface",
            "px-2 text-sm text-ink hover:border-line-strong focus:border-ink focus:outline-none",
          )}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "number":
      return (
        <Input
          {...props}
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          placeholder={field.placeholder ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
          className="max-w-40"
        />
      );

    case "textarea":
      return (
        <Textarea
          {...props}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="max-w-120"
        />
      );

    default:
      return (
        <Input
          {...props}
          type={field.type === "password" ? "password" : "text"}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={cn("max-w-120", field.type === "path" && "machine")}
        />
      );
  }
}

export function AdapterConfigForm({
  schema,
  config,
  onChange,
  errors,
  disabled,
}: {
  schema: FieldSpec[];
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const setField = (key: string, value: unknown) => {
    const next = { ...config };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {SECTION_ORDER.map((section) => {
        const fields = schema.filter((f) => f.section === section && isVisible(f, config));
        if (fields.length === 0) return null;

        return (
          <fieldset key={section} disabled={disabled} className="flex flex-col gap-4">
            <legend className="pb-1 text-2xs font-medium text-faint">
              {SECTION_LABEL[section]}
            </legend>

            {fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                {...(field.required ? {} : { optional: true })}
                {...(field.type !== "boolean" && field.help ? { hint: field.help } : {})}
                {...(errors?.[field.key] ? { error: errors[field.key] } : {})}
              >
                {(props) => (
                  <Control
                    field={field}
                    value={config[field.key]}
                    onChange={(value) => setField(field.key, value)}
                    props={props}
                  />
                )}
              </Field>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
