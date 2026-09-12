// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { cn } from "@/lib/utils";

/**
 * Initials, not a tinted circle.
 *
 * Colour in this console means state, so identity is carried by the letters
 * themselves. It also survives a rename, which a generated colour does not.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "machine flex shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
        "border border-line bg-surface font-medium text-muted",
        size === "sm" ? "size-4 text-[0.5rem]" : "size-5 text-[0.5625rem]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
