// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Tooltip as Base } from "@base-ui-components/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = Base.Provider;

/**
 * For a label that would not fit, or a machine value worth showing in full.
 * Never for something a person needs in order to use the control — that belongs
 * on screen.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner sideOffset={6} className="z-50">
          <Base.Popup
            className={cn(
              "rounded-[var(--radius-sm)] border border-line bg-surface px-2 py-1",
              "text-2xs text-ink shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)]",
              "transition-opacity duration-100",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
              className,
            )}
          >
            {content}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
