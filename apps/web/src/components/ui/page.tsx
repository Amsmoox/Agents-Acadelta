// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  meta,
  actions,
  back,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        {back ? <div className="mb-1.5">{back}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {meta ? <div className="mt-1 flex items-center gap-2 text-xs text-muted">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-5xl px-6 py-6", className)}>{children}</div>;
}
