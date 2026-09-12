// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { Organization } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { useOrganizations } from "@/features/organizations/queries";
import { CreateOrganizationDialog } from "@/features/organizations/create-dialog";

export const Route = createFileRoute("/organizations/")({
  // `?new=1` opens the create dialog, so "New organization" works from anywhere
  // in the app — including the switcher, which is not on this page.
  // Returned only when set, so every other link to this route stays search-free.
  validateSearch: (search: Record<string, unknown>): { new?: true } => {
    const wantsCreate =
      search["new"] === true || search["new"] === "true" || search["new"] === "1";
    return wantsCreate ? { new: true } : {};
  },
  component: OrganizationsPage,
});

type Filter = "all" | "active" | "archived";

function OrganizationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const query = useOrganizations();
  const { new: openCreate = false } = Route.useSearch();
  const navigate = useNavigate();

  // The URL owns this dialog, so BOTH directions have to be wired. Handling only
  // the close case left the page's own button dead: `open` is controlled by the
  // search param, so the trigger's request to open went nowhere.
  const setCreateOpen = (open: boolean) => {
    void navigate({
      to: "/organizations",
      search: open ? { new: true } : {},
      replace: true,
    });
  };

  const all = query.data ?? [];
  const counts = {
    all: all.length,
    active: all.filter((o) => o.status === "active").length,
    archived: all.filter((o) => o.status === "archived").length,
  };
  const shown = filter === "all" ? all : all.filter((o) => o.status === filter);

  return (
    <Page>
      <PageHeader
        title="Organizations"
        actions={<CreateOrganizationDialog open={openCreate} onOpenChange={setCreateOpen} />}
      />

      {counts.all > 0 ? (
        <div className="pb-3">
          <Segmented
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "active", label: "Active", count: counts.active },
              { value: "archived", label: "Archived", count: counts.archived },
            ]}
          />
        </div>
      ) : null}

      {query.isPending ? <LoadingRows /> : null}

      {query.isError ? (
        <List>
          <ErrorState
            title="Can't load organizations"
            description="The API didn't answer. Check that it's running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Try again
              </Button>
            }
          />
        </List>
      ) : null}

      {query.isSuccess && counts.all === 0 ? (
        <List>
          <EmptyState
            title="No organizations yet"
            description="An organization owns its projects, agents and budget. Create one to start."
            action={<CreateOrganizationDialog />}
          />
        </List>
      ) : null}

      {query.isSuccess && counts.all > 0 && shown.length === 0 ? (
        <List>
          <EmptyState
            title={`No ${filter} organizations`}
            description="Nothing matches this filter right now."
          />
        </List>
      ) : null}

      {shown.length > 0 ? (
        <List>
          {shown.map((organization) => (
            <OrganizationRow key={organization.id} organization={organization} />
          ))}
        </List>
      ) : null}
    </Page>
  );
}

function OrganizationRow({ organization }: { organization: Organization }) {
  const archived = organization.status === "archived";
  return (
    <Link to="/organizations/$ref" params={{ ref: organization.slug }} className="block">
      <ListRow interactive>
        {/* Aligned to the name, not the row: the dot is that line's state. */}
        <StatusDot tone={archived ? "idle" : "active"} className="mt-[0.4375rem] self-start" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{organization.name}</span>
            <Tag>{organization.slug}</Tag>
            {archived ? <Badge tone="idle">Archived</Badge> : null}
          </div>
          {organization.mission ? (
            <p className="mt-0.5 truncate text-xs text-muted">{organization.mission}</p>
          ) : null}
        </div>

        <span className="machine hidden shrink-0 self-start pt-0.5 text-2xs text-faint sm:block">
          {timeAgo(organization.createdAt)}
        </span>
      </ListRow>
    </Link>
  );
}

function LoadingRows() {
  return (
    <List>
      {[0, 1, 2].map((row) => (
        <ListRow key={row}>
          <Skeleton className="size-1.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-3 w-12" />
        </ListRow>
      ))}
    </List>
  );
}
