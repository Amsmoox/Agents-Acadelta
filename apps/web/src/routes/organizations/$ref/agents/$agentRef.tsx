// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast, useConfirm } from "@/components/ui";
import { ArrowLeft, Ban, MoreHorizontal, Pause, Play, RotateCcw } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Tag } from "@/components/ui/status";
import { Callout } from "@/components/ui/callout";
import { Card, DescriptionList, DescriptionRow } from "@/components/ui/card";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { List, ListRow } from "@/components/ui/list";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { AdapterConfigForm } from "@/components/adapter-config-form";
import { AdapterIcon } from "@/components/adapter-icon";
import { InstructionsTab } from "@/features/agents/instructions-tab";
import { SkillsTab } from "@/features/agents/skills-tab";
import { RunsTab } from "@/features/agents/runs-tab";
import { EditAgentDialog } from "@/features/agents/edit-agent-dialog";
import {
  useAdapters,
  useAgent,
  useAgentAction,
  useAgentRevisions,
  useRollbackRevision,
  useUpdateAgent,
  type AgentDetail,
} from "@/features/agents/queries";
import { STATUS_LABEL, STATUS_TONE, chainProblem, pauseExplanation } from "@/features/agents/status";
import { ApiError, firstIssue } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/organizations/$ref/agents/$agentRef")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const tab = search["tab"];
    const known: Tab[] = ["runs", "instructions", "skills", "harness", "governance"];
    return known.includes(tab as Tab) ? { tab: tab as Tab } : {};
  },
  component: AgentDetailPage,
});

type Tab = "overview" | "runs" | "instructions" | "skills" | "harness" | "governance";

function AgentDetailPage() {
  const { ref: org, agentRef: ref } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();
  const query = useAgent(org, ref);
  const resumeAgent = useAgentAction(org, ref);

  const resume = async () => {
    try {
      await resumeAgent.mutateAsync({ action: "resume" });
      toast.success("Resumed");
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "Could not resume.");
    }
  };

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
    const error = query.error instanceof ApiError ? query.error : null;
    // AGC-2001 is the organization, AGC-3001 the agent. Naming the wrong one
    // sends the operator looking for a problem that is not there.
    const orgMissing = error?.code === "AGC-2001";
    const missing = error?.status === 404;
    return (
      <Page>
        <ErrorState
          title={
            orgMissing ? "Organization not found" : missing ? "Agent not found" : "Can't load this agent"
          }
          description={
            orgMissing
              ? `No organization called "${org}". Check the link.`
              : missing
                ? "It may have been terminated, or the link is wrong."
                : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            // When the organization is what is missing, "back to agents" would
            // land on the same dead end; go up a level instead.
            orgMissing ? (
              <Link to="/organizations" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Go to organizations
              </Link>
            ) : missing ? (
              <Link to="/organizations/$ref/agents" params={{ ref: org }} className={buttonVariants({ variant: "secondary", size: "sm" })}>
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
          <Link to="/organizations/$ref/agents" params={{ ref: org }} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
            <ArrowLeft className="size-3" />
            Agents
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            <AdapterIcon type={agent.adapterType} className="size-5" />
            {agent.name}
          </span>
        }
        meta={
          <>
            <Tag>{AGENT_ROLE_LABELS[agent.role]}</Tag>
            <Badge tone={STATUS_TONE[agent.status]}>{STATUS_LABEL[agent.status]}</Badge>
            {agent.manager ? <span className="text-faint">reports to {agent.manager.name}</span> : null}
          </>
        }
        actions={
          <>
            <EditAgentDialog org={org} agent={agent} />
            <AgentActions org={org} agent={agent} />
          </>
        }
      />

      {agent.status === "paused" ? (
        <Callout
          tone="attention"
          className="mb-4"
          action={
            <Button variant="secondary" size="sm" onClick={() => void resume()}>
              <Play />
              Resume
            </Button>
          }
        >
          {pauseExplanation(agent.pauseReason)}
        </Callout>
      ) : null}

      {agent.status === "error" && agent.errorReason ? (
        <Callout tone="danger" className="mb-4">{agent.errorReason}</Callout>
      ) : null}
      {problem ? <Callout tone="danger" className="mb-4">{problem}</Callout> : null}
      {warning ? <Callout tone="attention" className="mb-4">{warning}</Callout> : null}

      <div className="pb-4">
        <Segmented
          label="Section"
          value={tab}
          onChange={(next) =>
            void navigate({
              to: "/organizations/$ref/agents/$agentRef",
              params: { ref: org, agentRef: ref },
              search: next === "overview" ? {} : { tab: next },
              replace: true,
            })
          }
          // Who it is, what it knows, how it runs, who controls it.
          options={[
            { value: "overview" as Tab, label: "Overview" },
            { value: "runs" as Tab, label: "Runs" },
            { value: "instructions" as Tab, label: "Instructions" },
            { value: "skills" as Tab, label: "Skills" },
            { value: "harness" as Tab, label: "Harness" },
            { value: "governance" as Tab, label: "Governance" },
          ]}
        />
      </div>

      {tab === "overview" ? <Overview org={org} agent={agent} /> : null}
      {tab === "runs" ? <RunsTab org={org} agent={agent.slug} /> : null}
      {tab === "instructions" ? <InstructionsTab org={org} agent={agent.slug} /> : null}
      {tab === "skills" ? <SkillsTab org={org} agent={agent.slug} /> : null}
      {tab === "harness" ? <Harness org={org} agent={agent} /> : null}
      {tab === "governance" ? <Governance org={org} agent={agent} /> : null}
    </Page>
  );
}

function AgentActions({ org, agent }: { org: string; agent: AgentDetail }) {
  const action = useAgentAction(org, agent.slug);
  const confirm = useConfirm();

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
              // Termination cannot be undone, so it asks — and says what it costs.
              onClick={() =>
                void confirm({
                  title: `Terminate ${agent.name}?`,
                  description:
                    "This cannot be undone. Its history and runs are kept, but it can never be assigned work or run again.",
                  confirmLabel: "Terminate agent",
                  tone: "danger",
                  onConfirm: () => run("terminate", "Terminated"),
                })
              }
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

function Overview({ agent }: { org: string; agent: AgentDetail }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Identity">
        <DescriptionList>
          <DescriptionRow label="Role" value={AGENT_ROLE_LABELS[agent.role]} />
          <DescriptionRow label="Title" value={agent.title ?? "Not set"} />
          <DescriptionRow label="Reports to" value={agent.manager?.name ?? "No manager"} />
          <DescriptionRow
            label="Can be assigned work"
            value={agent.eligibility.assignable ? "Yes" : "No"}
          />
        </DescriptionList>
      </Card>

      <Card title="Harness">
        <DescriptionList>
          <DescriptionRow label="Type" value={<span className="machine">{agent.adapterType}</span>} />
          <DescriptionRow
            label="Model"
            value={
              <span className="machine">{String(agent.adapterConfig["model"] ?? "default")}</span>
            }
          />
          <DescriptionRow
            label="Last heartbeat"
            value={agent.lastHeartbeatAt ? timeAgo(agent.lastHeartbeatAt) : "Never run"}
          />
          <DescriptionRow
            label="Created"
            value={<span title={fullDate(agent.createdAt)}>{timeAgo(agent.createdAt)}</span>}
          />
        </DescriptionList>
      </Card>

      <Card title="Budget">
        <DescriptionList>
          <DescriptionRow
            label="Monthly limit"
            value={
              agent.budgetMonthlyCents > 0 ? (
                <span className="machine">${(agent.budgetMonthlyCents / 100).toFixed(2)}</span>
              ) : (
                "No limit"
              )
            }
          />
          <DescriptionRow
            label="Spent this month"
            value={<span className="machine">${(agent.spentMonthlyCents / 100).toFixed(2)}</span>}
          />
        </DescriptionList>
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
        <DescriptionList>
        <DescriptionRow label="Can hire agents" value={agent.permissions["canCreateAgents"] ? "Yes" : "No"} />
        <DescriptionRow label="Can write skills" value={agent.permissions["canCreateSkills"] ? "Yes" : "No"} />
        <DescriptionRow label="Can assign work" value={agent.permissions["canAssignTasks"] ? "Yes" : "No"} />
        </DescriptionList>
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
