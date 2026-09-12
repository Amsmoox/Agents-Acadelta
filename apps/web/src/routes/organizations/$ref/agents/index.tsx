// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { Agent } from "@agentco/shared";
import { AGENT_ROLE_LABELS } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { urlOrganizationMatches } from "@/features/organizations/url-organization";
import { useAgents, useOrgTree } from "@/features/agents/queries";
import { STATUS_LABEL, STATUS_TONE } from "@/features/agents/status";
import { AdapterIcon } from "@/components/adapter-icon";
import { OrgChart } from "@/components/org-chart";
import { useAdapters } from "@/features/agents/queries";

export const Route = createFileRoute("/organizations/$ref/agents/")({
  component: AgentsPage,
});

type View = "list" | "org" | "terminated";

function AgentsPage() {
  // The organization comes from the URL, which is what makes this page
  // shareable and lets browser history restore the right tenant.
  const { ref: org } = Route.useParams();
  const { current, isPending: orgPending, unavailable } = useCurrentOrganization();
  const [view, setView] = useState<View>("list");
  const agents = useAgents(org);
  // Terminating an agent used to remove it from every screen in the product,
  // with no way back to its history, its runs or its instructions. It is kept
  // in the database precisely so it can still be read.
  const terminated = useAgents(org, "terminated");
  const tree = useOrgTree(org);
  const adapters = useAdapters();
  const adapterLabel = (type: string) =>
    (adapters.data ?? []).find((a) => a.type === type)?.label ?? type;

  // The provider falls back to a usable organization when the remembered one no
  // longer resolves, which is right on a cold start and wrong here: if the URL
  // named an organization, showing a different one's agents under that address
  // is a lie, not a fallback.
  // An unreachable API is not a missing organization, and saying so sends the
  // operator hunting for a mistake they did not make.
  if (!orgPending && unavailable) {
    return (
      <Page>
        <PageHeader title="Agents" />
        <List>
          <ErrorState
            title="Can't reach the server"
            description="The API didn't answer. Check that it's running, then try again."
          />
        </List>
      </Page>
    );
  }

  if (!orgPending && !urlOrganizationMatches(current, org)) {
    return (
      <Page>
        <PageHeader title="Agents" />
        <List>
          <EmptyState
            title="Organization not found"
            description={`No organization called "${org}". It may have been renamed, or the link is wrong.`}
            action={
              <Link to="/organizations" className={buttonVariants({ variant: "primary", size: "sm" })}>
                Go to organizations
              </Link>
            }
          />
        </List>
      </Page>
    );
  }

  const archived = current?.status === "archived";
  const roster = agents.data ?? [];
  const retired = terminated.data ?? [];
  const shown = view === "terminated" ? retired : roster;

  return (
    <Page>
      <PageHeader
        title="Agents"
        meta={current ? <span>in {current.name}</span> : null}
        actions={
          // An archived organization refuses to hire, so offering a form that
          // can only fail on submit wastes the operator's time twice.
          archived ? (
            <Button variant="primary" size="md" disabled>
              <Plus className="size-4" />
              Hire agent
            </Button>
          ) : (
            <Link to="/organizations/$ref/agents/new" params={{ ref: org }} className={buttonVariants({ variant: "primary", size: "md" })}>
              <Plus className="size-4" />
              Hire agent
            </Link>
          )
        }
      />

      {archived ? (
        <Callout
          tone="attention"
          className="mb-4"
          action={
            <Link
              to="/organizations/$ref"
              params={{ ref: org }}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Organization settings
            </Link>
          }
        >
          This organization is archived. Its agents can be read and stopped, but not hired, edited
          or run.
        </Callout>
      ) : null}

      {roster.length > 0 ? (
        <div className="pb-3">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "list" as View, label: "List", count: roster.length },
              { value: "org" as View, label: "Org chart" },
              // Offered only when there is something to see; an always-visible
              // empty archive is just a tab that never rewards a click.
              ...(retired.length > 0
                ? [{ value: "terminated" as View, label: "Terminated", count: retired.length }]
                : []),
            ]}
          />
        </div>
      ) : null}

      {agents.isPending ? <LoadingRows /> : null}

      {agents.isError ? (
        <List>
          <ErrorState
            title="Can't load agents"
            description="The API didn't answer. Check that it's running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => agents.refetch()}>
                Try again
              </Button>
            }
          />
        </List>
      ) : null}

      {agents.isSuccess && roster.length === 0 ? (
        <List>
          <EmptyState
            title="No agents yet"
            description="An agent does the work. Hire one and give it a job to do."
            action={
              <Link to="/organizations/$ref/agents/new" params={{ ref: org }} className={buttonVariants({ variant: "primary", size: "sm" })}>
                Hire your first agent
              </Link>
            }
          />
        </List>
      ) : null}

      {shown.length > 0 && view !== "org" ? (
        <List>
          {shown.map((agent) => (
            <AgentRow key={agent.id} agent={agent} adapterLabel={adapterLabel(agent.adapterType)} org={org} />
          ))}
        </List>
      ) : null}

      {roster.length > 0 && view === "org" ? (
        <div className="rounded-[var(--radius-md)] border border-line bg-sunken">
          <OrgChart
            nodes={tree.data ?? []}
            org={org}
            detail={Object.fromEntries(
              roster.map((agent) => [
                agent.id,
                { caption: agent.title ?? AGENT_ROLE_LABELS[agent.role], adapterType: agent.adapterType },
              ]),
            )}
          />
        </div>
      ) : null}
    </Page>
  );
}

function AgentRow({ agent, adapterLabel, org }: { agent: Agent; adapterLabel: string; org: string }) {
  const model = agent.adapterConfig["model"];
  return (
    <Link
      to="/organizations/$ref/agents/$agentRef"
      params={{ ref: org, agentRef: agent.slug }}
      className="block"
    >
      <ListRow interactive>
        <StatusDot tone={STATUS_TONE[agent.status]} className="mt-[0.4375rem] self-start" />
        <AdapterIcon type={agent.adapterType} className="mt-0.5 size-4 self-start" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{agent.name}</span>
            <Tag>{AGENT_ROLE_LABELS[agent.role]}</Tag>
            {agent.status !== "idle" ? (
              <Badge tone={STATUS_TONE[agent.status]}>{STATUS_LABEL[agent.status]}</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {agent.title ?? agent.capabilities ?? "No description"}
          </p>
        </div>

        <div className="hidden shrink-0 self-start pt-0.5 text-right sm:block">
          <p className="text-2xs text-muted">{adapterLabel}</p>
          {typeof model === "string" && model ? (
            <p className="machine text-2xs text-faint">{model}</p>
          ) : null}
        </div>
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
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-56" />
          </div>
        </ListRow>
      ))}
    </List>
  );
}
