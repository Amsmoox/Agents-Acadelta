// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { ReactNode } from "react";
import type { Tone } from "./status";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  active: "border-active/30 bg-active-soft text-active",
  attention: "border-attention/30 bg-attention-soft text-attention",
  danger: "border-danger/30 bg-danger-soft text-danger",
  idle: "border-line bg-sunken text-muted",
};

/**
 * A statement about the current state of the thing on screen, with an optional
 * way to act on it. The tone comes from the state vocabulary, never from taste.
 */
export function Callout({
  tone = "idle",
  children,
  action,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs",
        TONE[tone],
        className,
      )}
    >
      <p className="min-w-0">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
