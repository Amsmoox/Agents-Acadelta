// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check } from "lucide-react";
import { AGENT_ROLES, AGENT_ROLE_LABELS, type AgentRole } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { AdapterConfigForm } from "@/components/adapter-config-form";
import { AdapterIcon } from "@/components/adapter-icon";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { urlOrganizationMatches } from "@/features/organizations/url-organization";
import { useAdapters, useAgents, useCreateAgent } from "@/features/agents/queries";
import { ApiError, firstIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/organizations/$ref/agents/new")({
  component: NewAgentPage,
});

function NewAgentPage() {
  const { ref: org } = Route.useParams();
  const { current, isPending: orgPending, unavailable } = useCurrentOrganization();
  const navigate = useNavigate();
  const adapters = useAdapters();
  const existing = useAgents(org);
  const create = useCreateAgent(org);

  const [name, setName] = useState("");
  const [role, setRole] = useState<AgentRole>("general");
  const [title, setTitle] = useState("");
  const [adapterType, setAdapterType] = useState<string>("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [reportsTo, setReportsTo] = useState("");
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Switching organization changes `ref` but does not remount this route, and
  // "Reports to" holds an agent id from the organization being left. Keeping it
  // would submit a cross-tenant manager; the name and role are not scoped, so
  // they survive.
  useEffect(() => setReportsTo(""), [org]);

  const choices = useMemo(
    () => (adapters.data ?? []).filter((adapter) => !adapter.hidden),
    [adapters.data],
  );
  const selected = choices.find((adapter) => adapter.type === adapterType);

  function chooseAdapter(type: string) {
    setAdapterType(type);
    // Defaults come from the adapter's own declaration, not a hardcoded map.
    const schema = choices.find((a) => a.type === type)?.configSchema ?? [];
    const defaults: Record<string, unknown> = {};
    for (const field of schema) if (field.default !== undefined) defaults[field.key] = field.default;
    setConfig(defaults);
    setFieldErrors({});
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setFieldErrors({});
    try {
      const agent = await create.mutateAsync({
        name: name.trim(),
        role,
        adapterType,
        adapterConfig: config,
        budgetMonthlyCents: 0,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(reportsTo ? { reportsTo } : {}),
      });
      toast.success(`Hired ${agent.name}`);
      await navigate({ to: "/organizations/$ref/agents/$agentRef", params: { ref: org, agentRef: agent.slug } });
    } catch (failure) {
      // Adapter-config problems are per-field, so they belong on the field.
      if (failure instanceof ApiError && failure.code === "AGC-3010") {
        const issues = (failure.detail?.["issues"] ?? []) as { path: string; message: string }[];
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        setError("Some settings need attention.");
        return;
      }
      setError(firstIssue(failure) ?? "Could not hire the agent.");
    }
  }

  // Three different situations that all leave `current` empty, and only one of
  // them means the organization does not exist.
  if (orgPending) {
    return (
      <Page>
        <PageHeader title="Hire an agent" />
        <Skeleton className="h-48 w-full" />
      </Page>
    );
  }

  if (unavailable) {
    return (
      <Page>
        <PageHeader title="Hire an agent" />
        <ErrorState
          title="Can't reach the server"
          description="The API didn't answer, so this organization could not be loaded."
        />
      </Page>
    );
  }

  // Never render one organization's screen under another organization's address.
  if (!current || !urlOrganizationMatches(current, org)) {
    return (
      <Page>
        <PageHeader title="Hire an agent" />
        <ErrorState
          title="Organization not found"
          description={`No organization called "${org}". It may have been renamed, or the link is wrong.`}
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/organizations/$ref/agents" params={{ ref: org }} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
            <ArrowLeft className="size-3" />
            Agents
          </Link>
        }
        title="Hire an agent"
        meta={<span>in {current.name}</span>}
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <section className="rounded-[var(--radius-md)] border border-line bg-surface px-4 py-4">
          <div className="flex flex-col gap-4">
            <Field label="Name" error={error && !selected ? error : undefined}>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={120}
                  autoFocus
                  placeholder="Ada"
                  onChange={(event) => setName(event.target.value)}
                  className="max-w-96"
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-4">
              <Field label="Role" hint="Used to route delegation.">
                {(props) => (
                  <select
                    {...props}
                    value={role}
                    onChange={(event) => setRole(event.target.value as AgentRole)}
                    className="h-8 w-56 rounded-[var(--radius-md)] border border-line bg-surface px-2 text-sm text-ink focus:border-ink focus:outline-none"
                  >
                    {AGENT_ROLES.map((value) => (
                      <option key={value} value={value}>
                        {AGENT_ROLE_LABELS[value]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field label="Job title" optional hint="Shown on the org chart.">
                {(props) => (
                  <Input
                    {...props}
                    value={title}
                    maxLength={120}
                    placeholder="Staff engineer"
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-56"
                  />
                )}
              </Field>

              <Field label="Reports to" optional hint="Leave empty to place at the top.">
                {(props) => (
                  <select
                    {...props}
                    value={reportsTo}
                    onChange={(event) => setReportsTo(event.target.value)}
                    className="h-8 w-56 rounded-[var(--radius-md)] border border-line bg-surface px-2 text-sm text-ink focus:border-ink focus:outline-none"
                  >
                    <option value="">No manager</option>
                    {(existing.data ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </div>
        </section>

        <section className="rounded-[var(--radius-md)] border border-line bg-surface px-4 py-4">
          <h2 className="pb-1 text-2xs font-medium text-faint">Agent type</h2>
          <p className="pb-3 text-xs text-muted">What actually runs when this agent works.</p>

          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((adapter) => {
              const active = adapter.type === adapterType;
              return (
                <button
                  key={adapter.type}
                  type="button"
                  onClick={() => chooseAdapter(adapter.type)}
                  className={cn(
                    "flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-left",
                    "transition-colors duration-75",
                    active
                      ? "border-ink bg-sunken"
                      : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <AdapterIcon type={adapter.type} className="mt-0.5 size-4.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      {adapter.label}
                      {adapter.experimental ? (
                        <span className="text-2xs font-normal text-faint">experimental</span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{adapter.summary}</span>
                  </span>
                  {active ? <Check className="mt-0.5 size-3.5 shrink-0 text-ink" /> : null}
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="mt-5 border-t border-line pt-4">
              <AdapterConfigForm
                schema={selected.configSchema}
                config={config}
                onChange={setConfig}
                errors={fieldErrors}
              />
            </div>
          ) : null}
        </section>

        {error && selected ? <p className="text-xs text-danger">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <Link to="/organizations/$ref/agents" params={{ ref: org }} className={buttonVariants({ variant: "ghost", size: "md" })}>
            Cancel
          </Link>
          <Button
            variant="primary"
            size="md"
            type="submit"
            disabled={!name.trim() || !adapterType || create.isPending}
          >
            {create.isPending ? <Spinner className="border-t-inverse" /> : null}
            Hire agent
          </Button>
        </div>
      </form>
    </Page>
  );
}
