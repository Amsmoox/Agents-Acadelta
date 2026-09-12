// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommentIntent,
  CreateObjectiveInput,
  CreateTaskInput,
  Objective,
  Task,
  TaskComment,
  TaskStatus,
  UpdateTaskInput,
} from "@agentco/shared";
import { request } from "@/lib/api";

export type ReviewDecision = {
  id: string;
  round: number;
  outcome: string;
  body: string;
  actorAgentId: string | null;
  actorName: string | null;
  actorUserId: string | null;
  createdAt: string;
};

export type TaskDetail = Task & {
  comments: TaskComment[];
  decisions: ReviewDecision[];
  parent: Task | null;
  children: Task[];
};

export const taskKeys = {
  all: ["tasks"] as const,
  board: (org: string, project: string) => ["tasks", org, project] as const,
  detail: (org: string, key: string) => ["tasks", org, "detail", key] as const,
  feed: (org: string) => ["tasks", org, "communications"] as const,
  objectives: (org: string, project: string) => ["objectives", org, project] as const,
};

/**
 * Work moves on its own here — an agent can finish something while you are
 * looking at it — so everything on these screens polls. Faster while something
 * is live, because that is when a stale screen misleads.
 */
const livePoll = (anyLive: boolean) => (anyLive ? 2000 : 6000);

export function useBoard(org: string, project: string) {
  return useQuery({
    queryKey: taskKeys.board(org, project),
    queryFn: () =>
      request<{ data: Task[] }>(`/organizations/${org}/projects/${project}/tasks?limit=200`),
    select: (result) => result.data,
    refetchInterval: (query) =>
      livePoll(
        (query.state.data?.data ?? []).some(
          (task) => task.status === "in_progress" || task.status === "in_review",
        ),
      ),
  });
}

export function useTask(org: string, key: string) {
  return useQuery({
    queryKey: taskKeys.detail(org, key),
    queryFn: () => request<TaskDetail>(`/organizations/${org}/tasks/${key}`),
    refetchInterval: (query) =>
      livePoll(
        query.state.data?.status === "in_progress" || query.state.data?.status === "in_review",
      ),
  });
}

export function useCommunications(org: string) {
  return useQuery({
    queryKey: taskKeys.feed(org),
    queryFn: () => request<{ data: TaskComment[] }>(`/organizations/${org}/communications?limit=150`),
    select: (result) => result.data,
    refetchInterval: 3000,
  });
}

export function useCreateTask(org: string, project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      request<Task>(`/organizations/${org}/projects/${project}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useUpdateTask(org: string, key: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTaskInput) =>
      request<Task>(`/organizations/${org}/tasks/${key}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useMoveTask(org: string, key: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: TaskStatus; comment?: string }) =>
      request<Task>(`/organizations/${org}/tasks/${key}/move`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useCommentOnTask(org: string, key: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; intent?: CommentIntent }) =>
      request<{ data: TaskComment[] }>(`/organizations/${org}/tasks/${key}/comments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useObjectives(org: string, project: string) {
  return useQuery({
    queryKey: taskKeys.objectives(org, project),
    queryFn: () =>
      request<{ data: Objective[] }>(`/organizations/${org}/projects/${project}/objectives`),
    select: (result) => result.data,
    refetchInterval: (query) =>
      livePoll((query.state.data?.data ?? []).some((o) => o.status === "active")),
  });
}

export function useTaskBlockers(org: string, key: string) {
  const client = useQueryClient();
  return {
    add: useMutation({
      mutationFn: (blockerTaskId: string) =>
        request<Task>(`/organizations/${org}/tasks/${key}/blockers`, {
          method: "POST",
          body: JSON.stringify({ blockerTaskId }),
        }),
      onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
    }),
    remove: useMutation({
      mutationFn: (blockerTaskId: string) =>
        request<Task>(`/organizations/${org}/tasks/${key}/blockers/${blockerTaskId}`, {
          method: "DELETE",
        }),
      onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
    }),
  };
}

export function useCreateObjective(org: string, project: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateObjectiveInput) =>
      request<Objective>(`/organizations/${org}/projects/${project}/objectives`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.objectives(org, project) }),
  });
}

/**
 * Objectives are addressed by id rather than through their project, because
 * stopping one is the same act wherever you are looking at it from.
 */
export function useObjectiveAction(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "stop" | "pause" | "resume" }) =>
      request<Objective>(`/organizations/${org}/objectives/${id}/${action}`, { method: "POST" }),
    // Stopping one writes a report, which is a task, so the board changes too.
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
