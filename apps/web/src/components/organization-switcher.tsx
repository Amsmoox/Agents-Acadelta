// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useLocation, useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, RefreshCw, Settings } from "lucide-react";
import type { Organization } from "@agentco/shared";
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/feedback";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { destinationAfterSwitch } from "@/features/organizations/switch-destination";
import { cn } from "@/lib/utils";

/**
 * A monogram, not a coloured avatar: organizations are told apart by their
 * initials, which keeps colour meaning state and nothing else.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

function Monogram({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "machine flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
        "border border-line bg-surface text-[0.5625rem] font-medium text-muted",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function OrganizationSwitcher() {
  const { current, switchable, select, isPending, unavailable, retry } = useCurrentOrganization();
  const navigate = useNavigate();
  const location = useLocation();

  function switchTo(organization: Organization) {
    select(organization.id);
    // Keep the section, drop the resource — see switch-destination.
    void navigate({ to: destinationAfterSwitch(location.pathname, organization.slug) });
  }

  if (isPending) {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1">
        <Skeleton className="size-5" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Switch organization"
            className={cn(
              "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1",
              "text-left transition-colors duration-75 hover:bg-surface",
            )}
          >
            <Monogram name={current?.name ?? "?"} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {current?.name ?? "Select organization"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-faint" />
          </button>
        }
      />

      <MenuContent align="start" className="min-w-56">
        <MenuLabel>Organizations</MenuLabel>

        {switchable.map((organization) => (
          <MenuItem key={organization.id} onClick={() => switchTo(organization)}>
            <Monogram name={organization.name} />
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            {organization.id === current?.id ? <Check className="size-3.5 text-ink" /> : null}
          </MenuItem>
        ))}

        {switchable.length === 0 ? (
          unavailable ? (
            // "No organizations" is a claim about the account, and after a failed
            // request it is one we cannot make. Say what happened, offer the way out.
            <>
              <div className="px-2 py-1.5 text-xs text-muted">Couldn&apos;t load organizations</div>
              <MenuItem onClick={retry}>
                <RefreshCw className="size-3.5" />
                Try again
              </MenuItem>
            </>
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted">No organizations yet</div>
          )
        ) : null}

        <MenuSeparator />

        <MenuItem onClick={() => void navigate({ to: "/organizations", search: { new: true } })}>
          <Plus className="size-3.5" />
          New organization
        </MenuItem>
        <MenuItem onClick={() => void navigate({ to: "/organizations" })}>
          <Settings className="size-3.5" />
          Manage organizations
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
