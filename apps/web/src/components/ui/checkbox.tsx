// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-3.5 shrink-0 rounded-[2px] border-line accent-[var(--ink)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A checkbox with its label and description, clickable as one target. */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <Checkbox {...props} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-2xs text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** A boolean that takes effect immediately, rather than on save. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-100",
        checked ? "bg-ink" : "bg-line-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "block size-3 rounded-full bg-surface transition-transform duration-100",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
