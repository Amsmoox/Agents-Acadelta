// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { Agent, OrgTreeNode } from "@agentco/shared";
import { AGENT_ROLE_LABELS } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { useAgents, useOrgTree } from "@/features/agents/queries";
import { STATUS_LABEL, STATUS_TONE } from "@/features/agents/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/agents/")({
  component: AgentsPage,
});

type View = "list" | "org";

function AgentsPage() {
  const { current, isPending: orgPending } = useCurrentOrganization();
  const [view, setView] = useState<View>("list");
  const org = current?.slug;
  const agents = useAgents(org);
  const tree = useOrgTree(org);

  if (!orgPending && !current) {
    return (
      <Page>
        <PageHeader title="Agents" />
        <List>
          <EmptyState
            title="Pick an organization first"
            description="Agents belong to an organization. Create one, then hire your first agent."
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

  const roster = agents.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Agents"
        meta={current ? <span>in {current.name}</span> : null}
        actions={
          <Link to="/agents/new" className={buttonVariants({ variant: "primary", size: "md" })}>
            <Plus className="size-4" />
            Hire agent
          </Link>
        }
      />

      {roster.length > 0 ? (
        <div className="pb-3">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "List", count: roster.length },
              { value: "org", label: "Org chart" },
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
              <Link to="/agents/new" className={buttonVariants({ variant: "primary", size: "sm" })}>
                Hire your first agent
              </Link>
            }
          />
        </List>
      ) : null}

      {roster.length > 0 && view === "list" ? (
        <List>
          {roster.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </List>
      ) : null}

      {roster.length > 0 && view === "org" ? (
        <List>
          <div className="p-2">
            {(tree.data ?? []).map((node) => (
              <TreeNode key={node.id} node={node} depth={0} />
            ))}
          </div>
        </List>
      ) : null}
    </Page>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  return (
    <Link to="/agents/$ref" params={{ ref: agent.slug }} className="block">
      <ListRow interactive>
        <StatusDot tone={STATUS_TONE[agent.status]} className="mt-[0.4375rem] self-start" />
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
        <span className="machine hidden shrink-0 self-start pt-0.5 text-2xs text-faint sm:block">
          {agent.adapterType}
        </span>
      </ListRow>
    </Link>
  );
}

/** Indented tree. Enough to read a reporting line; no pan-and-zoom canvas. */
function TreeNode({ node, depth }: { node: OrgTreeNode; depth: number }) {
  return (
    <div>
      <Link
        to="/agents/$ref"
        params={{ ref: node.id }}
        className={cn(
          "flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5",
          "text-sm text-ink transition-colors duration-75 hover:bg-sunken",
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <StatusDot tone={STATUS_TONE[node.status]} />
        <span className="truncate">{node.name}</span>
        {node.reports.length > 0 ? (
          <span className="machine text-2xs text-faint">{node.reports.length}</span>
        ) : null}
      </Link>
      {node.reports.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
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
