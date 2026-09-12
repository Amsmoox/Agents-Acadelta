// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";

/**
 * Work, and everything said about it.
 *
 * The status set is small on purpose. `blocked` means the assignee cannot
 * proceed; it does not mean the news is bad. An investigation that finds eleven
 * defects succeeded — the verdict is its deliverable — and marking it blocked
 * would make every audit read as a failure to whatever rolls it up.
 */

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["done", "cancelled"];

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Ordering for the queue an agent's next run reads. */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const TASK_KINDS = ["standard", "investigate", "review", "report"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  standard: "Do the work",
  investigate: "Look and report",
  review: "Judge someone's output",
  report: "Summarise, for a person",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const REVIEW_POLICIES = ["anyone", "not_creator", "human_only"] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];

export const COMMENT_INTENTS = [
  "note",
  "progress",
  "verdict",
  "question",
  "handoff",
  "system",
] as const;
export type CommentIntent = (typeof COMMENT_INTENTS)[number];

/** A delegation chain this deep is a bug, not a plan. */
export const MAX_TASK_DEPTH = 12;

/** What one run may create or change beyond the task it is working. */
export const DEFAULT_CROSS_TASK_WRITE_LIMIT = 20;

/**
 * Consecutive runs achieving nothing on a task before it stops waking anybody.
 *
 * An agent that has woken five times and each time ended without moving the
 * task or saying anything about it is stuck on something it cannot see its way
 * past. Every further attempt costs a full run and produces the same nothing.
 */
export const MAX_NO_PROGRESS_RUNS = 5;

/**
 * Consecutive agent-initiated rejections on one task before it goes to a person.
 *
 * The cap exists to stop unattended agent-to-agent ping-pong, not to limit a
 * human reviewer: a person's decision resets the count.
 */
export const MAX_REVIEW_ROUNDS = 3;

export type ReviewState = {
  status: "idle" | "pending" | "changes_requested" | "completed";
  /** Who to hand it back to on a rejection. Captured when it is submitted. */
  returnAssigneeAgentId?: string | null;
  /** Who moved it into review, so `not_creator` can be enforced without guessing. */
  submittedByAgentId?: string | null;
  submittedByUserId?: string | null;
  reviewerAgentId?: string | null;
  changesRequestedCount: number;
};

export const taskTitleSchema = z.string().trim().min(1).max(200);
export const taskDescriptionSchema = z.string().trim().max(20_000);
export const commentBodySchema = z.string().trim().min(1).max(20_000);

export const createTaskSchema = z.object({
  title: taskTitleSchema,
  description: taskDescriptionSchema.optional(),
  kind: z.enum(TASK_KINDS).default("standard"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  status: z.enum(["backlog", "todo"]).default("todo"),
  assigneeAgentId: z.uuid().nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  reviewPolicy: z.enum(REVIEW_POLICIES).optional(),
  blockedBy: z.array(z.uuid()).max(50).optional(),
});

export const updateTaskSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    kind: z.enum(TASK_KINDS).optional(),
    assigneeAgentId: z.uuid().nullable().optional(),
    reviewPolicy: z.enum(REVIEW_POLICIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update.");

/**
 * Moving a task.
 *
 * A comment is required on every review verdict in both directions. On a
 * rejection it is the only thing that makes the next attempt different from the
 * last one; on an approval it is the record of what was actually checked.
 */
export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  comment: commentBodySchema.optional(),
});

export const commentSchema = z.object({
  body: commentBodySchema,
  intent: z.enum(COMMENT_INTENTS).default("note"),
});

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeAgentId: z.uuid().optional(),
  kind: z.enum(TASK_KINDS).optional(),
  parentId: z.uuid().optional(),
  objectiveId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

export const createObjectiveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  directive: z.string().trim().min(1).max(20_000),
  exitCriteria: z.string().trim().min(1).max(20_000),
  ownerAgentId: z.uuid(),
  maxCycles: z.coerce.number().int().min(1).max(100).default(10),
  budgetCents: z.coerce.number().int().min(0).max(1_000_000).default(0),
  maxIdleCycles: z.coerce.number().int().min(1).max(10).default(2),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;

export type Task = {
  id: string;
  organizationId: string;
  projectId: string;
  key: string;
  number: number;
  title: string;
  description: string | null;
  kind: TaskKind;
  priority: TaskPriority;
  status: TaskStatus;
  parentId: string | null;
  depth: number;
  assigneeAgentId: string | null;
  assigneeName: string | null;
  assigneeSlug: string | null;
  responsibleUserId: string;
  createdByAgentId: string | null;
  createdByName: string | null;
  createdByRunId: string | null;
  objectiveId: string | null;
  reviewPolicy: ReviewPolicy;
  reviewState: ReviewState | null;
  blockedBy: { id: string; key: string; title: string; status: TaskStatus }[];
  childCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskComment = {
  id: string;
  taskId: string;
  taskKey: string;
  authorType: "agent" | "user" | "system";
  authorAgentId: string | null;
  authorName: string | null;
  authorRunId: string | null;
  body: string;
  intent: CommentIntent;
  trust: string;
  createdAt: string;
};

export type Objective = {
  id: string;
  projectId: string;
  title: string;
  directive: string;
  exitCriteria: string;
  ownerAgentId: string;
  ownerName: string | null;
  status: "active" | "satisfied" | "exhausted" | "paused" | "abandoned";
  maxCycles: number;
  cycleCount: number;
  budgetCents: number;
  spentCents: number;
  maxIdleCycles: number;
  idleCycles: number;
  outcome: string | null;
  reportTaskId: string | null;
  taskCount: number;
  openTaskCount: number;
  createdAt: string;
  endedAt: string | null;
};

/**
 * Which statuses a run may pick a task up from.
 *
 * `in_review` is in the list, and it has to be: submitting for review hands the
 * task to the reviewer, so the reviewer *is* the assignee, and leaving it out
 * meant a review could be requested and then never picked up by anybody. The
 * claim is still scoped to the assignee, so nobody else can take it — and
 * claiming does not move a task that is in review, because it is already where
 * it belongs.
 */
export const CLAIMABLE_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "in_review"];

/** Side effects of a status, applied in one place so they cannot drift. */
export function taskStatusSideEffects(status: TaskStatus, now: Date) {
  return {
    ...(status === "in_progress" ? { startedAt: now } : {}),
    ...(status === "done" ? { completedAt: now } : {}),
    ...(status === "cancelled" ? { cancelledAt: now } : {}),
    ...(status === "blocked" ? { blockedTransitionAt: now } : {}),
  };
}
