// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field = [
  "w-full rounded-[var(--radius-md)] border border-line bg-surface",
  "px-2.5 text-sm text-ink placeholder:text-faint",
  "transition-colors duration-100",
  "hover:border-line-strong",
  "focus:border-ink focus:outline-none focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-danger",
].join(" ");

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "min-h-20 resize-y py-2 leading-5", className)} {...props} />;
}
