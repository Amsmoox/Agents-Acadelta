// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowLeft, Ban, MoreHorizontal, Pause, Play, RotateCcw } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge, Tag } from "@/components/ui/status";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { List, ListRow } from "@/components/ui/list";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { AdapterConfigForm } from "@/components/adapter-config-form";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import {
  useAdapters,
  useAgent,
  useAgentAction,
  useAgentRevisions,
  useRollbackRevision,
  useUpdateAgent,
  type AgentDetail,
} from "@/features/agents/queries";
import { STATUS_LABEL, STATUS_TONE, chainProblem } from "@/features/agents/status";
import { ApiError, firstIssue } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/agents/$ref")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const tab = search["tab"];
    return tab === "harness" || tab === "governance" ? { tab } : {};
  },
  component: AgentDetailPage,
});

type Tab = "overview" | "harness" | "governance";

function AgentDetailPage() {
  const { ref } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();
  const { current } = useCurrentOrganization();
  const org = current?.slug;
  const query = useAgent(org, ref);

  if (query.isPending) {
    return (
      <Page>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-3 w-64" />
        <Skeleton className="mt-6 h-56 w-full" />
      </Page>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Page>
        <ErrorState
          title={missing ? "Agent not found" : "Can't load this agent"}
          description={
            missing
              ? "It may have been terminated, or the link is wrong."
              : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            missing ? (
              <Link to="/agents" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Back to agents
              </Link>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Try again
              </Button>
            )
          }
        />
      </Page>
    );
  }

  const agent = query.data;
  const problem = chainProblem(agent.orgChainHealth);
  const warning =
    agent.orgChainHealth.status === "healthy" ? agent.orgChainHealth.escalationWarning : undefined;

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/agents" className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
            <ArrowLeft className="size-3" />
            Agents
          </Link>
        }
        title={agent.name}
        meta={
          <>
            <Tag>{AGENT_ROLE_LABELS[agent.role]}</Tag>
            <Badge tone={STATUS_TONE[agent.status]}>{STATUS_LABEL[agent.status]}</Badge>
            <span className="machine text-faint">{agent.adapterType}</span>
          </>
        }
        actions={org ? <AgentActions org={org} agent={agent} /> : null}
      />

      {agent.status === "error" && agent.errorReason ? (
        <Notice tone="danger" text={agent.errorReason} />
      ) : null}
      {problem ? <Notice tone="danger" text={problem} /> : null}
      {warning ? <Notice tone="attention" text={warning} /> : null}

      <div className="pb-4">
        <Segmented
          label="Section"
          value={tab}
          onChange={(next) =>
            void navigate({
              to: "/agents/$ref",
              params: { ref },
              search: next === "overview" ? {} : { tab: next },
              replace: true,
            })
          }
          options={[
            { value: "overview" as Tab, label: "Overview" },
            { value: "harness" as Tab, label: "Harness" },
            { value: "governance" as Tab, label: "Governance" },
          ]}
        />
      </div>

      {org && tab === "overview" ? <Overview org={org} agent={agent} /> : null}
      {org && tab === "harness" ? <Harness org={org} agent={agent} /> : null}
      {org && tab === "governance" ? <Governance org={org} agent={agent} /> : null}
    </Page>
  );
}

function Notice({ tone, text }: { tone: "danger" | "attention"; text: string }) {
  return (
    <div
      className={`mb-4 rounded-[var(--radius-md)] border px-3 py-2.5 text-xs ${
        tone === "danger"
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-attention/30 bg-attention-soft text-attention"
      }`}
    >
      {text}
    </div>
  );
}

function AgentActions({ org, agent }: { org: string; agent: AgentDetail }) {
  const action = useAgentAction(org, agent.slug);

  const run = async (name: string, label: string, body?: Record<string, unknown>) => {
    try {
      await action.mutateAsync({ action: name, ...(body ? { body } : {}) });
      toast.success(label);
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "That didn't work.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      {agent.status === "paused" ? (
        <Button variant="secondary" size="md" onClick={() => run("resume", "Resumed")}>
          <Play />
          Resume
        </Button>
      ) : null}
      {agent.status === "error" ? (
        <Button variant="secondary" size="md" onClick={() => run("clear-error", "Error cleared")}>
          <RotateCcw />
          Clear error
        </Button>
      ) : null}
      {agent.status === "pending_approval" ? (
        <Button variant="primary" size="md" onClick={() => run("approve", "Approved")}>
          Approve agent
        </Button>
      ) : null}

      <MenuRoot>
        <MenuTrigger
          render={
            <Button variant="secondary" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          }
        />
        <MenuContent>
          {agent.status !== "paused" && agent.status !== "terminated" ? (
            <MenuItem onClick={() => run("pause", "Paused", { reason: "manual" })}>
              <Pause className="size-3.5" />
              Pause agent
            </MenuItem>
          ) : null}
          {agent.status !== "terminated" ? (
            <MenuItem
              tone="danger"
              onClick={() => {
                // Termination cannot be undone, so it asks — and says why.
                if (
                  window.confirm(
                    `Terminate ${agent.name}? This cannot be undone. Its history is kept, but it can never run again.`,
                  )
                ) {
                  void run("terminate", "Terminated");
                }
              }}
            >
              <Ban className="size-3.5" />
              Terminate agent
            </MenuItem>
          ) : null}
        </MenuContent>
      </MenuRoot>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-md)] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2 text-2xs font-medium text-faint">{title}</h2>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="min-w-0 truncate text-xs text-ink">{value}</span>
    </div>
  );
}

function Overview({ agent }: { org: string; agent: AgentDetail }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Identity">
        <Row label="Role" value={AGENT_ROLE_LABELS[agent.role]} />
        <Row label="Title" value={agent.title ?? "—"} />
        <Row label="Reports to" value={agent.reportsTo ? <span className="machine">{agent.reportsTo.slice(0, 8)}</span> : "No manager"} />
        <Row label="Can be assigned work" value={agent.eligibility.assignable ? "Yes" : "No"} />
      </Card>

      <Card title="Harness">
        <Row label="Type" value={<span className="machine">{agent.adapterType}</span>} />
        <Row label="Model" value={<span className="machine">{String(agent.adapterConfig["model"] ?? "default")}</span>} />
        <Row
          label="Last heartbeat"
          value={agent.lastHeartbeatAt ? timeAgo(agent.lastHeartbeatAt) : "Never run"}
        />
        <Row label="Created" value={<span title={fullDate(agent.createdAt)}>{timeAgo(agent.createdAt)}</span>} />
      </Card>

      <Card title="Capabilities">
        <p className="text-xs leading-5 text-muted">
          {agent.capabilities ?? "No capability summary has been written for this agent."}
        </p>
      </Card>
    </div>
  );
}

function Harness({ org, agent }: { org: string; agent: AgentDetail }) {
  const adapters = useAdapters();
  const update = useUpdateAgent(org, agent.slug);
  const [config, setConfig] = useState<Record<string, unknown>>(agent.adapterConfig);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  useEffect(() => setConfig(agent.adapterConfig), [agent.adapterConfig]);

  const definition = (adapters.data ?? []).find((a) => a.type === agent.adapterType);
  const dirty = JSON.stringify(config) !== JSON.stringify(agent.adapterConfig);
  const locked = agent.status === "terminated" || agent.status === "pending_approval";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setFieldErrors({});
    try {
      await update.mutateAsync({ adapterConfig: config });
      toast.success("Saved");
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "AGC-3010") {
        const issues = (failure.detail?.["issues"] ?? []) as { path: string; message: string }[];
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        setError("Some settings need attention.");
        return;
      }
      setError(firstIssue(failure) ?? "Could not save.");
    }
  }

  if (!definition) {
    return (
      <Card title="Harness">
        <p className="text-xs text-muted">
          This agent uses <span className="machine">{agent.adapterType}</span>, which this server
          does not offer. Its settings are preserved but cannot be edited here.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2 text-2xs font-medium text-faint">
        {definition.label} settings
      </h2>
      <div className="px-4 py-4">
        <AdapterConfigForm
          schema={definition.configSchema}
          config={config}
          onChange={setConfig}
          errors={fieldErrors}
          disabled={locked}
        />
        {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-4 py-2.5">
        <Button variant="primary" size="sm" type="submit" disabled={locked || !dirty || update.isPending}>
          {update.isPending ? <Spinner className="border-t-inverse" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}

function Governance({ org, agent }: { org: string; agent: AgentDetail }) {
  const revisions = useAgentRevisions(org, agent.slug);
  const rollback = useRollbackRevision(org, agent.slug);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Permissions">
        <Row label="Can hire agents" value={agent.permissions["canCreateAgents"] ? "Yes" : "No"} />
        <Row label="Can write skills" value={agent.permissions["canCreateSkills"] ? "Yes" : "No"} />
        <Row label="Can assign work" value={agent.permissions["canAssignTasks"] ? "Yes" : "No"} />
      </Card>

      <div>
        <h2 className="pb-2 text-2xs font-medium text-faint">Configuration history</h2>
        {revisions.isSuccess && revisions.data.length === 0 ? (
          <List>
            <div className="px-4 py-6 text-center text-xs text-muted">
              No changes since this agent was hired.
            </div>
          </List>
        ) : null}

        {revisions.data && revisions.data.length > 0 ? (
          <List>
            {revisions.data.map((revision) => (
              <ListRow key={revision.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink">
                    Changed {revision.changedKeys.join(", ")}
                    {revision.source === "rollback" ? " (rollback)" : ""}
                  </p>
                  <p className="machine mt-0.5 text-2xs text-faint" title={fullDate(revision.createdAt)}>
                    {timeAgo(revision.createdAt)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={rollback.isPending}
                  onClick={async () => {
                    try {
                      await rollback.mutateAsync(revision.id);
                      toast.success("Restored");
                    } catch (failure) {
                      toast.error(firstIssue(failure) ?? "Could not restore.");
                    }
                  }}
                >
                  Restore
                </Button>
              </ListRow>
            ))}
          </List>
        ) : null}
      </div>
    </div>
  );
}
