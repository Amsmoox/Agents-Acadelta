// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import type { Organization } from "@agentco/shared";
import { useOrganizations } from "./queries";

const STORAGE_KEY = "agentco.currentOrganizationId";

type CurrentOrganizationValue = {
  organizations: Organization[];
  /** Archived organizations stay reachable by URL but are not offered for switching. */
  switchable: Organization[];
  current: Organization | null;
  select: (id: string) => void;
  isPending: boolean;
  /** True only when the list request actually failed — never when it is merely empty. */
  unavailable: boolean;
  retry: () => void;
};

const Context = createContext<CurrentOrganizationValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Blocked storage only costs the selection surviving a reload.
  }
}

/**
 * Resolves which organization is current, in priority order: one the caller
 * selected explicitly, then the one remembered from last time, then the first
 * available.
 *
 * A remembered id that no longer resolves is ignored rather than cleared. The
 * list failing to load is not evidence that the organization is gone, and
 * clearing on that signal drops the operator into a different tenant the next
 * time they open the app.
 */
function resolveCurrentId(input: {
  selectedId: string | null;
  storedId: string | null;
  organizations: Organization[];
  switchable: Organization[];
}): string | null {
  const { selectedId, storedId, organizations, switchable } = input;
  if (organizations.length === 0) return null;

  // Checked against the full list, archived included: a URL may name an
  // archived organization, and vetoing that against the switchable list would
  // have the two re-select against each other forever.
  if (selectedId && organizations.some((o) => o.id === selectedId)) return selectedId;
  if (storedId && switchable.some((o) => o.id === storedId)) return storedId;
  return switchable[0]?.id ?? organizations[0]?.id ?? null;
}

export function CurrentOrganizationProvider({ children }: { children: ReactNode }) {
  const query = useOrganizations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Every organization-scoped route carries the organization as `ref`. Reading
  // it here means one rule for the whole app instead of an effect on each page,
  // and it is what makes a link shareable and browser history meaningful.
  const params = useParams({ strict: false }) as { ref?: string };
  const urlRef = params.ref;

  const organizations = useMemo(() => query.data ?? [], [query.data]);
  const switchable = useMemo(
    () => organizations.filter((o) => o.status !== "archived"),
    [organizations],
  );

  const fromUrl = urlRef
    ? organizations.find((o) => o.slug === urlRef || o.id === urlRef)
    : undefined;

  const currentId = resolveCurrentId({
    // An organization named by the URL outranks both the in-session choice and
    // anything remembered: the address bar is what the operator can see.
    selectedId: fromUrl?.id ?? selectedId,
    storedId: readStored(),
    organizations,
    switchable,
  });

  const current = useMemo(
    () => organizations.find((o) => o.id === currentId) ?? null,
    [organizations, currentId],
  );

  // Remember whatever resolved, so the next visit opens where this one left off.
  useEffect(() => {
    if (currentId) writeStored(currentId);
  }, [currentId]);

  // An organization reached by URL becomes the in-session choice, so it stays
  // current after navigating away from its address. Without this, opening an
  // ARCHIVED organization and then clicking Organizations silently moves you to
  // a different tenant: the switcher only ever offers non-archived ones, and the
  // remembered-id branch is checked against that same list.
  const fromUrlId = fromUrl?.id;
  useEffect(() => {
    if (fromUrlId) setSelectedId(fromUrlId);
  }, [fromUrlId]);

  const select = useCallback((id: string) => setSelectedId(id), []);
  const retry = useCallback(() => void query.refetch(), [query]);

  const value = useMemo<CurrentOrganizationValue>(
    () => ({
      organizations,
      switchable,
      current,
      select,
      isPending: query.isPending,
      unavailable: query.isError,
      retry,
    }),
    [organizations, switchable, current, select, query.isPending, query.isError, retry],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCurrentOrganization(): CurrentOrganizationValue {
  const value = useContext(Context);
  if (!value) throw new Error("useCurrentOrganization must be used inside CurrentOrganizationProvider");
  return value;
}

export const currentOrganizationInternals = { resolveCurrentId, STORAGE_KEY };
