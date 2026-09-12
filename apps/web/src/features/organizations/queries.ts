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

export function useOrganizations(status?: "active" | "archived") {
  return useQuery({
    queryKey: organizationKeys.list(status),
    queryFn: () =>
      request<OrganizationList>(
        `/organizations?limit=100${status ? `&status=${status}` : ""}`,
      ),
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
