// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  AgentEligibility,
  CreateAgentInput,
  OrgChainHealth,
  OrgTreeNode,
  UpdateAgentInput,
} from "@agentco/shared";
import type { FieldSpec } from "@agentco/adapters";
import { request } from "@/lib/api";

export type AgentDetail = Agent & {
  manager: { id: string; name: string; status: string } | null;
  orgChainHealth: OrgChainHealth;
  eligibility: AgentEligibility;
};

export type AdapterInfo = {
  type: string;
  label: string;
  summary: string;
  hidden: boolean;
  experimental: boolean;
  configSchema: FieldSpec[];
  capabilities: {
    supportsSessionResume: boolean;
    supportsInstructionsBundle: boolean;
    requiresMaterializedSkills: boolean;
  };
};

export type AgentRevision = {
  id: string;
  source: string;
  changedKeys: string[];
  beforeConfig: Record<string, unknown>;
  afterConfig: Record<string, unknown>;
  createdAt: string;
};

export const agentKeys = {
  all: ["agents"] as const,
  list: (org: string) => ["agents", org, "list"] as const,
  tree: (org: string) => ["agents", org, "tree"] as const,
  detail: (org: string, ref: string) => ["agents", org, "detail", ref] as const,
  revisions: (org: string, ref: string) => ["agents", org, "revisions", ref] as const,
};

export function useAdapters() {
  return useQuery({
    queryKey: ["adapters"],
    queryFn: () => request<{ data: AdapterInfo[] }>("/adapters"),
    // The catalogue changes only when the server is redeployed.
    staleTime: 10 * 60_000,
    select: (result) => result.data,
  });
}

export function useAgents(org: string | undefined) {
  return useQuery({
    queryKey: agentKeys.list(org ?? ""),
    enabled: Boolean(org),
    queryFn: () => request<{ data: Agent[] }>(`/organizations/${org}/agents?limit=200`),
    select: (result) => result.data,
  });
}

export function useOrgTree(org: string | undefined) {
  return useQuery({
    queryKey: agentKeys.tree(org ?? ""),
    enabled: Boolean(org),
    queryFn: () => request<{ data: OrgTreeNode[] }>(`/organizations/${org}/agents/org-tree`),
    select: (result) => result.data,
  });
}

export function useAgent(org: string | undefined, ref: string) {
  return useQuery({
    queryKey: agentKeys.detail(org ?? "", ref),
    enabled: Boolean(org),
    queryFn: () => request<AgentDetail>(`/organizations/${org}/agents/${ref}`),
  });
}

export function useAgentRevisions(org: string | undefined, ref: string) {
  return useQuery({
    queryKey: agentKeys.revisions(org ?? "", ref),
    enabled: Boolean(org),
    queryFn: () =>
      request<{ data: AgentRevision[] }>(`/organizations/${org}/agents/${ref}/revisions`),
    select: (result) => result.data,
  });
}

export function useCreateAgent(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) =>
      request<Agent>(`/organizations/${org}/agents`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

export function useUpdateAgent(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAgentInput) =>
      request<Agent>(`/organizations/${org}/agents/${ref}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

/** pause · resume · clear-error · terminate · approve */
export function useAgentAction(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: string; body?: Record<string, unknown> }) =>
      request<Agent>(`/organizations/${org}/agents/${ref}/${action}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.all }),
  });
}

export function useRollbackRevision(org: string, ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) =>
      request<Agent>(`/organizations/${org}/agents/${ref}/revisions/${revisionId}/rollback`, {
        method: "POST",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: agentKeys.all }),
  });
}
