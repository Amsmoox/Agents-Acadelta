// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSkillInput,
  InstructionFile,
  Skill,
  UpdateSkillInput,
} from "@agentco/shared";
import { request } from "@/lib/api";

export const skillKeys = {
  all: ["skills"] as const,
  library: (org: string) => ["skills", org, "library"] as const,
  detail: (org: string, ref: string) => ["skills", org, "detail", ref] as const,
  enabled: (org: string, agent: string) => ["skills", org, "enabled", agent] as const,
  manifest: (org: string, agent: string) => ["skills", org, "manifest", agent] as const,
  instructions: (org: string, agent: string) => ["instructions", org, agent] as const,
};

export function useSkills(org: string | undefined) {
  return useQuery({
    queryKey: skillKeys.library(org ?? ""),
    enabled: Boolean(org),
    queryFn: () => request<{ data: Skill[] }>(`/organizations/${org}/skills`),
    select: (result) => result.data,
  });
}

export function useSkill(org: string | undefined, ref: string) {
  return useQuery({
    queryKey: skillKeys.detail(org ?? "", ref),
    enabled: Boolean(org),
    queryFn: () => request<Skill>(`/organizations/${org}/skills/${ref}`),
  });
}

export function useCreateSkill(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) =>
      request<Skill>(`/organizations/${org}/skills`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useUpdateSkill(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSkillInput) =>
      request<Skill>(`/organizations/${org}/skills/${ref}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useDeleteSkill(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ref: string) =>
      request<void>(`/organizations/${org}/skills/${ref}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

export function useAgentSkills(org: string, agent: string) {
  return useQuery({
    queryKey: skillKeys.enabled(org, agent),
    queryFn: () => request<{ data: string[] }>(`/organizations/${org}/agents/${agent}/skills`),
    select: (result) => result.data,
  });
}

export function useSetAgentSkills(org: string, agent: string) {
  const client = useQueryClient();
  return useMutation({
    // The whole set, not a diff: two people editing one agent cannot then
    // interleave into a state neither of them chose.
    mutationFn: (skillIds: string[]) =>
      request<{ data: string[] }>(`/organizations/${org}/agents/${agent}/skills`, {
        method: "PUT",
        body: JSON.stringify({ skillIds }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: skillKeys.all }),
  });
}

/** The manifest exactly as the agent will receive it. */
export function useSkillManifest(org: string, agent: string) {
  return useQuery({
    queryKey: skillKeys.manifest(org, agent),
    queryFn: () =>
      request<{ manifest: string }>(`/organizations/${org}/agents/${agent}/skills/manifest`),
    select: (result) => result.manifest,
  });
}

export function useInstructions(org: string, agent: string) {
  return useQuery({
    queryKey: skillKeys.instructions(org, agent),
    queryFn: () =>
      request<{ data: InstructionFile[] }>(`/organizations/${org}/agents/${agent}/instructions`),
    select: (result) => result.data,
  });
}

export function useWriteInstructionFile(org: string, agent: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: { path: string; content: string }) =>
      request<InstructionFile>(`/organizations/${org}/agents/${agent}/instructions`, {
        method: "PUT",
        body: JSON.stringify(file),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: skillKeys.instructions(org, agent) }),
  });
}

export function useDeleteInstructionFile(org: string, agent: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      request<void>(`/organizations/${org}/agents/${agent}/instructions/${path}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: skillKeys.instructions(org, agent) }),
  });
}
