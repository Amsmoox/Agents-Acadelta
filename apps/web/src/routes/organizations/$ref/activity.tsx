// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, Tag, type Tone } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { AdapterIcon } from "@/components/adapter-icon";
import type { TaskComment } from "@agentco/shared";
import { useOrganizationRuns, type OrganizationRun } from "@/features/runs/queries";
import { useCommunications } from "@/features/tasks/queries";
import { INTENT_LABEL } from "@/features/tasks/status";
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
type View = "said" | "ran";

/**
 * What the organization is doing, in one place.
 *
 * The unit is a run rather than an agent, because the question this page
 * answers is "what is happening", and an agent that is idle is not an answer
 * to it. Every row leads back to the agent and its transcript.
 */
function ActivityPage() {
  const { ref: org } = Route.useParams();
  const [view, setView] = useState<View>("said");
  const [filter, setFilter] = useState<Filter>("all");
  const runs = useOrganizationRuns(org, filter === "all" ? undefined : filter);
  const said = useCommunications(org);

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

      <div className="flex flex-wrap items-center gap-3 pb-3">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "said" as View, label: "Conversation" },
            { value: "ran" as View, label: "Runs" },
          ]}
        />
        {view === "ran" ? (
          <Segmented
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as Filter, label: "All" },
              { value: "live" as Filter, label: "Working" },
              { value: "finished" as Filter, label: "Finished" },
            ]}
          />
        ) : null}
      </div>

      {view === "said" ? (
        <Conversation org={org} feed={said.data ?? []} pending={said.isPending} />
      ) : null}

      {view === "ran" && runs.isPending ? (
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

      {view === "ran" && runs.isError ? (
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

      {view === "ran" && runs.isSuccess && rows.length === 0 ? (
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

      {view === "ran" && rows.length > 0 ? (
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

/**
 * What the agents said to each other, newest first.
 *
 * The unit is a sentence rather than a run, because this is the screen you
 * leave open while a company of agents works: a run tells you something
 * happened, and this tells you what it was.
 */
function Conversation({
  org,
  feed,
  pending,
}: {
  org: string;
  feed: TaskComment[];
  pending: boolean;
}) {
  if (pending) {
    return (
      <List>
        {[0, 1, 2].map((row) => (
          <ListRow key={row}>
            <Skeleton className="size-1.5 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-72" />
            </div>
          </ListRow>
        ))}
      </List>
    );
  }

  if (feed.length === 0) {
    return (
      <List>
        <EmptyState
          title="Nothing said yet"
          description="When your agents work on tasks, everything they say to each other appears here."
        />
      </List>
    );
  }

  return (
    <List>
      {feed.map((entry) => (
        <Link
          key={entry.id}
          to="/organizations/$ref/tasks/$taskKey"
          params={{ ref: org, taskKey: entry.taskKey }}
          className="block"
        >
          <ListRow interactive>
            <StatusDot
              tone={entry.intent === "verdict" ? "attention" : "idle"}
              className="mt-[0.4375rem] self-start"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-medium text-ink">
                  {entry.authorName ?? (entry.authorType === "user" ? "You" : "System")}
                </span>
                <span className="text-2xs text-faint">
                  {INTENT_LABEL[entry.intent] ?? entry.intent}
                </span>
                <Tag>{entry.taskKey}</Tag>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted">{entry.body}</p>
            </div>
            <span
              className="machine hidden shrink-0 self-start pt-0.5 text-2xs text-faint sm:block"
              title={fullDate(entry.createdAt)}
            >
              {timeAgo(entry.createdAt)}
            </span>
          </ListRow>
        </Link>
      ))}
    </List>
  );
}
