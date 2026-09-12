// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Menu as Base } from "@base-ui-components/react/menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const MenuRoot = Base.Root;
export const MenuTrigger = Base.Trigger;

export function MenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={4} align="end" className="z-50">
        <Base.Popup
          className={cn(
            "min-w-40 rounded-[var(--radius-md)] border border-line bg-surface p-1",
            "shadow-[0_10px_28px_-10px_rgb(0_0_0/0.2)]",
            "transition-[opacity,transform] duration-100 ease-out",
            "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0",
            className,
          )}
        >
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

export function MenuItem({
  children,
  onClick,
  tone = "default",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <Base.Item
      {...(onClick ? { onClick } : {})}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)]",
        "px-2 py-1.5 text-xs outline-none",
        "data-[highlighted]:bg-sunken",
        tone === "danger" ? "text-danger" : "text-ink",
      )}
    >
      {children}
    </Base.Item>
  );
}

export function MenuSeparator() {
  return <Base.Separator className="my-1 h-px bg-line" />;
}
