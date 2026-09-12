// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { TaskPriority, TaskStatus } from "@agentco/shared";
import type { Tone } from "@/components/ui/status";

/** One mapping from task status to tone, imported everywhere it is drawn. */
export const TASK_TONE: Record<TaskStatus, Tone> = {
  backlog: "idle",
  todo: "idle",
  in_progress: "active",
  in_review: "attention",
  blocked: "danger",
  done: "idle",
  cancelled: "idle",
};

/** The columns of the board, in the order work moves through them. */
export const BOARD_COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: "todo", label: "To do", hint: "Waiting for somebody to pick it up" },
  { status: "in_progress", label: "In progress", hint: "Somebody is working on it" },
  { status: "in_review", label: "In review", hint: "Waiting for a verdict" },
  { status: "blocked", label: "Blocked", hint: "Cannot proceed" },
  { status: "done", label: "Done", hint: "Finished" },
];

/**
 * Priority is shown only when it is not the default.
 *
 * Four labels on every card and none of them mean anything; one label on the
 * two that are urgent and it reads instantly.
 */
export const PRIORITY_TONE: Partial<Record<TaskPriority, Tone>> = {
  urgent: "danger",
  high: "attention",
};

export const INTENT_LABEL: Record<string, string> = {
  note: "said",
  progress: "reported",
  verdict: "decided",
  question: "asked",
  handoff: "handed over",
  system: "",
};
