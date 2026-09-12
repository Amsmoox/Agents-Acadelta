// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useEffect, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { AGENT_ROLES, AGENT_ROLE_LABELS, type AgentRole } from "@agentco/shared";
import {
  Button,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  toast,
} from "@/components/ui";
import { useAgents, useUpdateAgent, type AgentDetail } from "@/features/agents/queries";
import { ApiError, firstIssue } from "@/lib/api";

/**
 * Everything about an agent that is not its harness.
 *
 * A dialog rather than an editable page, so the overview stays something you
 * can read at a glance — which is what an overview is for — and there is one
 * obvious place to change identity rather than several inline edits.
 */
export function EditAgentDialog({ org, agent }: { org: string; agent: AgentDetail }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateAgent(org, agent.slug);
  const roster = useAgents(org);

  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState<AgentRole>(agent.role);
  const [title, setTitle] = useState(agent.title ?? "");
  const [capabilities, setCapabilities] = useState(agent.capabilities ?? "");
  const [reportsTo, setReportsTo] = useState(agent.reportsTo ?? "");
  const [budget, setBudget] = useState(
    agent.budgetMonthlyCents > 0 ? String(agent.budgetMonthlyCents / 100) : "",
  );
  const [error, setError] = useState<string>();

  // Re-sync whenever the dialog reopens on newer data, so it never shows a
  // stale copy of something somebody else just changed.
  useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setRole(agent.role);
    setTitle(agent.title ?? "");
    setCapabilities(agent.capabilities ?? "");
    setReportsTo(agent.reportsTo ?? "");
    setBudget(agent.budgetMonthlyCents > 0 ? String(agent.budgetMonthlyCents / 100) : "");
    setError(undefined);
  }, [open, agent]);

  // An agent cannot manage itself, and the server refuses a loop anyway; not
  // offering itself avoids an error the person can see coming.
  const managers = (roster.data ?? []).filter((candidate) => candidate.id !== agent.id);

  // The roster excludes terminated agents, so an agent whose manager was
  // terminated would find its own current value missing from the list and the
  // select would silently snap to whatever came first. Carry it, labelled.
  const currentManagerMissing =
    agent.reportsTo !== null && !managers.some((candidate) => candidate.id === agent.reportsTo);
  const managerOptions = [
    { value: "", label: "No manager" },
    ...(currentManagerMissing && agent.manager
      ? [{ value: agent.manager.id, label: `${agent.manager.name} (terminated)` }]
      : []),
    ...managers.map((candidate) => ({ value: candidate.id, label: candidate.name })),
  ];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    const cents = budget.trim() === "" ? 0 : Math.round(Number(budget) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError("Budget must be a positive amount, or empty for no limit.");
      return;
    }

    try {
      const nextManager = reportsTo === "" ? null : reportsTo;

      await update.mutateAsync({
        name: name.trim(),
        role,
        title: title.trim() === "" ? null : title.trim(),
        capabilities: capabilities.trim() === "" ? null : capabilities.trim(),
        // Sent only when it actually changed. The server re-validates the
        // reporting line whenever this field is present, so including it
        // unconditionally meant renaming an agent whose manager had since been
        // terminated was rejected for a line nobody had touched.
        ...(nextManager !== agent.reportsTo ? { reportsTo: nextManager } : {}),
        budgetMonthlyCents: cents,
      });
      toast.success("Saved");
      setOpen(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "AGC-3005") {
        setError("That manager reports to this agent, which would make a loop.");
        return;
      }
      if (failure instanceof ApiError && failure.code === "AGC-3011") {
        setError("That agent is terminated, so it cannot manage anyone. Pick someone else.");
        return;
      }
      setError(firstIssue(failure) ?? "Could not save.");
    }
  }

  const locked = agent.status === "terminated" || agent.status === "pending_approval";

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="md" disabled={locked}>
            <Pencil />
            Edit details
          </Button>
        }
      />
      <DialogPanel
        title="Edit agent"
        description="Who this agent is. How it runs is on the Harness tab."
        className="max-w-120"
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <Field label="Name" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>

            <Field label="Role" hint="Used to route delegation.">
              {(props) => (
                <Select
                  {...props}
                  value={role}
                  onChange={(event) => setRole(event.target.value as AgentRole)}
                  options={AGENT_ROLES.map((value) => ({
                    value,
                    label: AGENT_ROLE_LABELS[value],
                  }))}
                />
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
                />
              )}
            </Field>

            <Field label="Reports to" optional hint="Leave empty to place at the top.">
              {(props) => (
                <Select
                  {...props}
                  value={reportsTo}
                  onChange={(event) => setReportsTo(event.target.value)}
                  options={managerOptions}
                />
              )}
            </Field>

            <Field
              label="Monthly budget"
              optional
              hint="In dollars. Empty means no limit; reaching the limit pauses the agent."
            >
              {(props) => (
                <Input
                  {...props}
                  value={budget}
                  inputMode="decimal"
                  placeholder="25.00"
                  onChange={(event) => setBudget(event.target.value)}
                  className="machine max-w-40"
                />
              )}
            </Field>

            <Field label="Capabilities" optional hint="What this agent is good for, in a sentence.">
              {(props) => (
                <Textarea
                  {...props}
                  value={capabilities}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => setCapabilities(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!name.trim() || update.isPending}>
              {update.isPending ? <Spinner className="border-t-inverse" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
