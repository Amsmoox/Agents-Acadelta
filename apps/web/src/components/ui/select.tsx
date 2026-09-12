// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * A native select, styled.
 *
 * Native because it is the one control that already works correctly on a phone,
 * with a keyboard, and with a screen reader, and nothing here needs multi-select
 * or search. A custom listbox would be three of those behaviours reimplemented
 * and one of them subtly wrong.
 */
export function Select({
  options,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <div className="relative inline-flex w-full max-w-96">
      <select
        className={cn(
          "h-8 w-full appearance-none rounded-[var(--radius-md)] border border-line bg-surface",
          "py-0 pl-2.5 pr-7 text-sm text-ink",
          "transition-colors duration-100 hover:border-line-strong",
          "focus:border-ink focus:outline-none focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-danger",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-faint"
      />
    </div>
  );
}
