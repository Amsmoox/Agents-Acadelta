// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { cn } from "@/lib/utils";

/**
 * The state vocabulary. An operator learns these four tones once and reads them
 * identically on every surface — dot, badge, row, chart.
 *
 * active    something is running or healthy
 * attention something is waiting on a person
 * danger    something failed or is over budget
 * idle      nothing is happening, and that is fine
 */
export type Tone = "active" | "attention" | "danger" | "idle";

const dotTone: Record<Tone, string> = {
  active: "bg-active",
  attention: "bg-attention",
  danger: "bg-danger",
  idle: "bg-idle",
};

const badgeTone: Record<Tone, string> = {
  active: "bg-active-soft text-active",
  attention: "bg-attention-soft text-attention",
  danger: "bg-danger-soft text-danger",
  idle: "bg-idle-soft text-idle",
};

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", dotTone[tone], className)}
    />
  );
}

export function Badge({
  tone = "idle",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5",
        "text-2xs font-medium",
        badgeTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Neutral chrome label — a count, a slug, a key. Never a state. */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "machine inline-flex items-center rounded-[var(--radius-sm)] border border-line",
        "px-1.5 py-0.5 text-2xs text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
