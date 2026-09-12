// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered surface with an optional quiet title bar and footer. */
export function Card({
  title,
  actions,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface", className)}
    >
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-2xs font-medium text-faint">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="px-4 py-4">{children}</div>
      {footer ? (
        <footer className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-4 py-2.5">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** Label-and-value pairs. Values align right so a column of them scans. */
export function DescriptionList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

export function DescriptionRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-xs text-ink">{value}</dd>
    </div>
  );
}
