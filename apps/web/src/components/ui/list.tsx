// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dense rows separated by hairlines, not a grid of cards.
 *
 * Cards would give every row its own border, radius and shadow — three visual
 * layers to say what one rule already says. Rows also let an operator scan a
 * column of names, which a card grid breaks.
 */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListRow({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0",
        interactive && "transition-colors duration-75 hover:bg-sunken",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-line bg-sunken px-3 py-1.5",
        "text-2xs font-medium text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}
