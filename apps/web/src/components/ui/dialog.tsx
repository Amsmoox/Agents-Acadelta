// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Dialog as Base } from "@base-ui-components/react/dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Base UI supplies the behaviour that is tedious to get right — focus trap,
 * escape, scroll lock, aria wiring. Everything visual is ours.
 *
 * The popup animates because the motion answers the person's action: it shows
 * where the panel came from. Nothing on this page moves on its own.
 */
export const DialogRoot = Base.Root;
export const DialogTrigger = Base.Trigger;
export const DialogClose = Base.Close;

export function DialogPanel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Base.Portal>
      <Base.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px] dark:bg-black/55",
          "transition-opacity duration-150",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      />
      <Base.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-100",
          "-translate-x-1/2 -translate-y-1/2",
          "rounded-[var(--radius-lg)] border border-line bg-surface",
          "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.22)]",
          "transition-[opacity,transform] duration-150 ease-out",
          "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
          "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
          className,
        )}
      >
        <div className="border-b border-line px-4 py-3">
          <Base.Title className="text-base font-semibold tracking-[-0.01em] text-ink">
            {title}
          </Base.Title>
          {description ? (
            <Base.Description className="mt-0.5 text-xs text-muted">{description}</Base.Description>
          ) : null}
        </div>
        {children}
      </Base.Popup>
    </Base.Portal>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-4", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-line bg-sunken px-4 py-3",
        "rounded-b-[var(--radius-lg)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
