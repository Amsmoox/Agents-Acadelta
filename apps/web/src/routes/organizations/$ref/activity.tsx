// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, type Tone } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { AdapterIcon } from "@/components/adapter-icon";
import { useOrganizationRuns, type OrganizationRun } from "@/features/runs/queries";
import { fullDate, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/organizations/$ref/activity")({
  component: ActivityPage,
});

const TONE: Record<OrganizationRun["status"], Tone> = {
  leased: "attention",
  running: "active",
  completed: "idle",
  failed: "danger",
  cancelled: "idle",
  orphaned: "danger",
};

const LABEL: Record<OrganizationRun["status"], string> = {
  leased: "Starting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  orphaned: "Interrupted",
};

type Filter = "all" | "live" | "finished";

/**
 * What the organization is doing, in one place.
 *
 * The unit is a run rather than an agent, because the question this page
 * answers is "what is happening", and an agent that is idle is not an answer
 * to it. Every row leads back to the agent and its transcript.
 */
function ActivityPage() {
  const { ref: org } = Route.useParams();
  const [filter, setFilter] = useState<Filter>("all");
  const runs = useOrganizationRuns(org, filter === "all" ? undefined : filter);

  const rows = runs.data ?? [];
  const live = rows.filter((run) => run.status === "running" || run.status === "leased").length;
  const spend = rows.reduce((total, run) => total + run.costCents, 0);

  return (
    <Page>
      <PageHeader
        title="Activity"
        meta={
          <>
            {/* One headline figure, not four competing ones. */}
            <span>
              {live > 0 ? `${live} working now` : "Nothing running"}
            </span>
            {spend > 0 ? (
              <span className="machine text-faint">${(spend / 100).toFixed(2)} shown</span>
            ) : null}
          </>
        }
      />

      <div className="pb-3">
        <Segmented
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "live", label: "Working" },
            { value: "finished", label: "Finished" },
          ]}
        />
      </div>

      {runs.isPending ? (
        <List>
          {[0, 1, 2].map((row) => (
            <ListRow key={row}>
              <Skeleton className="size-1.5 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-44" />
                <Skeleton className="h-3 w-64" />
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}

      {runs.isError ? (
        <List>
          <ErrorState
            title="Can't load activity"
            description="The API didn't answer. Check that it's running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => runs.refetch()}>
                Try again
              </Button>
            }
          />
        </List>
      ) : null}

      {runs.isSuccess && rows.length === 0 ? (
        <List>
          <EmptyState
            title={filter === "live" ? "Nothing is running" : "No runs yet"}
            description={
              filter === "live"
                ? "Every agent is idle. Give one something to do and it will appear here."
                : "When an agent runs, it shows up here with what it was asked and what it cost."
            }
          />
        </List>
      ) : null}

      {rows.length > 0 ? (
        <List>
          {rows.map((run) => (
            <Link
              key={run.id}
              to="/organizations/$ref/agents/$agentRef"
              params={{ ref: org, agentRef: run.agentSlug }}
              search={{ tab: "runs" as const }}
              className="block"
            >
              <ListRow interactive>
                <StatusDot tone={TONE[run.status]} className="mt-[0.4375rem] self-start" />
                <AdapterIcon type={run.adapterType} className="mt-0.5 size-4 self-start" />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{run.agentName}</span>
                    <Badge tone={TONE[run.status]}>{LABEL[run.status]}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">{run.prompt}</p>
                  {run.error ? (
                    <p className="mt-0.5 truncate text-2xs text-danger">{run.error}</p>
                  ) : null}
                </div>

                <div className="hidden shrink-0 self-start pt-0.5 text-right sm:block">
                  <p className="machine text-2xs text-faint" title={fullDate(run.createdAt)}>
                    {timeAgo(run.createdAt)}
                  </p>
                  {run.costCents > 0 ? (
                    <p className="machine text-2xs text-muted">
                      ${(run.costCents / 100).toFixed(2)}
                    </p>
                  ) : null}
                </div>
              </ListRow>
            </Link>
          ))}
        </List>
      ) : null}
    </Page>
  );
}
