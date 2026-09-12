// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectInput,
  Project,
  ProjectMember,
  ProjectStatus,
  SetProjectMembersInput,
  UpdateProjectInput,
} from "@agentco/shared";
import { request } from "@/lib/api";

type ProjectList = { data: Project[]; nextCursor: string | null };

export const projectKeys = {
  all: ["projects"] as const,
  list: (org: string, status?: string) => ["projects", org, "list", status ?? "all"] as const,
  detail: (org: string, ref: string) => ["projects", org, "detail", ref] as const,
  members: (org: string, ref: string) => ["projects", org, "members", ref] as const,
};

const PAGE_SIZE = 100;
/** A console list is the wrong tool past this many rows; stop rather than loop. */
const MAX_PAGES = 20;

/** Walks every page, so the filter counts drawn from it are not capped at one. */
async function fetchAll(org: string, status?: ProjectStatus): Promise<Project[]> {
  const all: Project[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (status) query.set("status", status);
    if (cursor) query.set("cursor", cursor);

    const result: ProjectList = await request<ProjectList>(
      `/organizations/${org}/projects?${query}`,
    );
    all.push(...result.data);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return all;
}

export function useProjects(org: string | undefined, status?: ProjectStatus) {
  return useQuery({
    queryKey: projectKeys.list(org ?? "", status),
    enabled: Boolean(org),
    queryFn: () => fetchAll(org!, status),
  });
}

export function useProject(org: string, ref: string) {
  return useQuery({
    queryKey: projectKeys.detail(org, ref),
    queryFn: () => request<Project>(`/organizations/${org}/projects/${ref}`),
  });
}

export function useProjectMembers(org: string, ref: string) {
  return useQuery({
    queryKey: projectKeys.members(org, ref),
    queryFn: () =>
      request<{ data: ProjectMember[] }>(`/organizations/${org}/projects/${ref}/members`),
    select: (result) => result.data,
  });
}

export function useCreateProject(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      request<Project>(`/organizations/${org}/projects`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      request<Project>(`/organizations/${org}/projects/${ref}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useSetProjectArchived(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      request<Project>(
        `/organizations/${org}/projects/${ref}/${archived ? "archive" : "restore"}`,
        { method: "POST" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useSetProjectMembers(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SetProjectMembersInput) =>
      request<{ data: ProjectMember[] }>(`/organizations/${org}/projects/${ref}/members`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: projectKeys.all }),
  });
}
