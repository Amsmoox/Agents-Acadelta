// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-line bg-sunken p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[var(--radius-sm)] px-2 py-1 text-2xs font-medium transition-colors duration-75",
              selected ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)]" : "text-muted hover:text-ink",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className="machine ml-1.5 text-faint">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
