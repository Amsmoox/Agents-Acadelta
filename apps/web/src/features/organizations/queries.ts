// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateOrganizationInput,
  Organization,
  UpdateOrganizationInput,
} from "@agentco/shared";
import { request } from "@/lib/api";

type OrganizationList = { data: Organization[]; nextCursor: string | null };

export const organizationKeys = {
  all: ["organizations"] as const,
  list: (status?: string) => ["organizations", "list", status ?? "all"] as const,
  detail: (ref: string) => ["organizations", "detail", ref] as const,
};

const PAGE_SIZE = 100;
/** A console list is the wrong tool past this many rows; stop rather than loop. */
const MAX_PAGES = 20;

/**
 * Walks every page rather than asking for one and discarding the cursor, which
 * silently capped the list — and the filter counts drawn from it — at 100.
 */
export async function fetchAllOrganizations(status?: string): Promise<Organization[]> {
  const all: Organization[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (status) query.set("status", status);
    if (cursor) query.set("cursor", cursor);

    const result: OrganizationList = await request<OrganizationList>(`/organizations?${query}`);
    all.push(...result.data);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return all;
}

export function useOrganizations(status?: "active" | "archived") {
  return useQuery({
    queryKey: organizationKeys.list(status),
    queryFn: () => fetchAllOrganizations(status),
  });
}

export function useOrganization(ref: string) {
  return useQuery({
    queryKey: organizationKeys.detail(ref),
    queryFn: () => request<Organization>(`/organizations/${ref}`),
  });
}

export function useCreateOrganization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrganizationInput) =>
      request<Organization>("/organizations", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => client.invalidateQueries({ queryKey: organizationKeys.all }),
  });
}

export function useUpdateOrganization(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOrganizationInput) =>
      request<Organization>(`/organizations/${ref}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: organizationKeys.all }),
  });
}

export function useSetArchived(ref: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (archived: boolean) =>
      request<Organization>(`/organizations/${ref}/${archived ? "archive" : "restore"}`, {
        method: "POST",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: organizationKeys.all }),
  });
}
