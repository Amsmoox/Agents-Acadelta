// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The console's only button.
 *
 * `primary` is ink on paper rather than a brand colour, because colour in this
 * interface is reserved for state. `danger` is the one exception: a destructive
 * action is itself a state worth colouring.
 */
const button = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-[var(--radius-md)] border font-medium",
    "transition-[background-color,border-color,color] duration-100",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "border-ink bg-ink text-inverse hover:bg-ink/88",
        secondary: "border-line bg-surface text-ink hover:bg-sunken hover:border-line-strong",
        ghost: "border-transparent bg-transparent text-muted hover:bg-sunken hover:text-ink",
        danger: "border-transparent bg-danger text-white hover:bg-danger/88",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
