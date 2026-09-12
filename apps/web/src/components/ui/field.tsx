// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = {
  label: string;
  /** Shown under the control until an error replaces it. */
  hint?: string | undefined;
  error?: string | undefined;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string }) => ReactNode;
};

/**
 * Label, control and message as one unit, wired together by id so the message
 * is announced with the control rather than sitting next to it visually only.
 */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-xs font-medium text-ink">
        {label}
        {optional ? <span className="text-2xs font-normal text-faint">optional</span> : null}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": messageId })}
      {message ? (
        <p id={messageId} className={cn("text-2xs", error ? "text-danger" : "text-faint")}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
