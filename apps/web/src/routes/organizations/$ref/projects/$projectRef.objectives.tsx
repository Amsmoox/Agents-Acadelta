// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Flag, Pause, Play, Square } from "lucide-react";
import type { Objective, Project } from "@agentco/shared";
import { Button } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Badge, StatusDot, type Tone } from "@/components/ui/status";
import { Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast, useConfirm } from "@/components/ui";
import { useProjectMembers } from "@/features/projects/queries";
import { useCreateObjective, useObjectiveAction, useObjectives } from "@/features/tasks/queries";
import { firstIssue } from "@/lib/api";

const TONE: Record<Objective["status"], Tone> = {
  active: "active",
  satisfied: "idle",
  exhausted: "attention",
  paused: "attention",
  abandoned: "idle",
};

const OUTCOME: Record<Objective["status"], string> = {
  active: "Running",
  satisfied: "Finished",
  exhausted: "Stopped",
  paused: "Paused",
  abandoned: "Stopped by you",
};

/**
 * The standing orders on this project.
 *
 * An objective is the thing that makes a company of agents keep working without
 * somebody asking each time — so the screen leads with how much of it is left
 * to spend, and keeps the way to stop it one click away.
 */
export function Objectives({ org, project }: { org: string; project: Project }) {
  const objectives = useObjectives(org, project.slug);
  const list = objectives.data ?? [];
  const active = list.filter((o) => o.status === "active" || o.status === "paused");
  const finished = list.filter((o) => o.status !== "active" && o.status !== "paused");

  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-2xs font-medium text-faint">Standing objectives</h2>
        {project.status === "archived" ? null : (
          <NewObjectiveDialog org={org} project={project} />
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted">
          None. An objective is an instruction an agent carries across many runs — "keep going until
          this is clean" — with a condition that ends it and a cycle limit that ends it anyway.
        </p>
      ) : null}

      {[...active, ...finished].map((objective) => (
        <Row key={objective.id} org={org} objective={objective} />
      ))}
    </section>
  );
}

function Row({ org, objective }: { org: string; objective: Objective }) {
  const action = useObjectiveAction(org);
  const confirm = useConfirm();
  const live = objective.status === "active" || objective.status === "paused";
  const cyclesLeft = Math.max(0, objective.maxCycles - objective.cycleCount);

  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot tone={TONE[objective.status]} />
        <span className="text-xs font-medium text-ink">{objective.title}</span>
        <Badge tone={TONE[objective.status]}>{OUTCOME[objective.status]}</Badge>
        <span className="text-2xs text-faint">{objective.ownerName ?? "no owner"}</span>

        <div className="ml-auto flex items-center gap-2">
          {objective.reportTaskId ? (
            <Link
              to="/organizations/$ref/tasks/$taskKey"
              params={{ ref: org, taskKey: objective.reportTaskId }}
              className="text-2xs text-muted underline-offset-2 hover:underline"
            >
              Read the report
            </Link>
          ) : null}
          {/* Pausing is the reversible half of stopping: the agent stops being
              woken, nothing is written off, and resuming picks it back up. */}
          {objective.status === "active" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={action.isPending}
              onClick={async () => {
                try {
                  await action.mutateAsync({ id: objective.id, action: "pause" });
                  toast.success("Paused");
                } catch (failure) {
                  toast.error(firstIssue(failure) ?? "Could not pause it.");
                }
              }}
            >
              <Pause />
              Pause
            </Button>
          ) : null}
          {objective.status === "paused" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={action.isPending}
              onClick={async () => {
                try {
                  await action.mutateAsync({ id: objective.id, action: "resume" });
                  toast.success("Resumed");
                } catch (failure) {
                  toast.error(firstIssue(failure) ?? "Could not resume it.");
                }
              }}
            >
              <Play />
              Resume
            </Button>
          ) : null}
          {live ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={action.isPending}
              onClick={() =>
                void confirm({
                  title: `Stop "${objective.title}"?`,
                  description:
                    "The agent carrying it stops filing new work, and a report of what happened is written. Tasks already open stay open.",
                  confirmLabel: "Stop it",
                  tone: "danger",
                  onConfirm: async () => {
                    try {
                      await action.mutateAsync({ id: objective.id, action: "stop" });
                      toast.success("Stopped");
                    } catch (failure) {
                      toast.error(firstIssue(failure) ?? "Could not stop it.");
                    }
                  },
                })
              }
            >
              <Square />
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-1 whitespace-pre-wrap text-2xs leading-4 text-muted">{objective.directive}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-2xs text-faint">
        {/* What is left, not what has been used: the question is always how
            much further this will go before it stops on its own. */}
        <span className="machine">{cyclesLeft} of {objective.maxCycles} cycles left</span>
        {objective.budgetCents > 0 ? (
          <span className="machine">
            ${((objective.budgetCents - objective.spentCents) / 100).toFixed(2)} left
          </span>
        ) : null}
        <span className="machine">
          {objective.openTaskCount} open of {objective.taskCount}
        </span>
        {objective.outcome ? <span className="text-muted">{objective.outcome}</span> : null}
      </div>
    </div>
  );
}

function NewObjectiveDialog({ org, project }: { org: string; project: Project }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [directive, setDirective] = useState("");
  const [exitCriteria, setExitCriteria] = useState("");
  const [owner, setOwner] = useState("");
  const [maxCycles, setMaxCycles] = useState("10");
  const [budget, setBudget] = useState("");
  const [command, setCommand] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [humanCheck, setHumanCheck] = useState("");
  const [error, setError] = useState<string>();

  const create = useCreateObjective(org, project.slug);
  const members = useProjectMembers(org, project.slug);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await create.mutateAsync({
        title: title.trim(),
        directive: directive.trim(),
        exitCriteria: exitCriteria.trim(),
        ownerAgentId: owner,
        maxCycles: Number(maxCycles) || 10,
        budgetCents: budget.trim() ? Math.round(Number(budget) * 100) : 0,
        maxIdleCycles: 2,
        // Nothing the agent can answer for itself. A command is run by the
        // system and judged on its exit code; a human check waits for a person.
        checks: [
          ...(command.trim()
            ? [
                {
                  id: "command",
                  statement: `\`${command.trim()}\` passes`,
                  kind: "command" as const,
                  command: command.trim(),
                  required: true,
                },
              ]
            : []),
          ...(humanCheck.trim()
            ? [
                {
                  id: "human",
                  statement: humanCheck.trim(),
                  kind: "human" as const,
                  required: true,
                },
              ]
            : []),
        ],
        ...(workingDirectory.trim() ? { workingDirectory: workingDirectory.trim() } : {}),
      });
      toast.success("Started");
      setOpen(false);
      setTitle("");
      setDirective("");
      setExitCriteria("");
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not start it.");
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            <Flag />
            New objective
          </Button>
        }
      />
      <DialogPanel
        title="New standing objective"
        description="One agent carries this across many runs, until it is met or it runs out."
        className="max-w-140"
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
            <Field label="Name" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  maxLength={200}
                  placeholder="Checkout — zero defects"
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              )}
            </Field>

            <Field
              label="What you want"
              hint="In your own words. The agent reads this exactly as you write it, every cycle."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={directive}
                  rows={4}
                  maxLength={20_000}
                  placeholder="Focus on the checkout flow. Hunt every bug, test every scenario. Keep going until it is clean."
                  onChange={(event) => setDirective(event.target.value)}
                />
              )}
            </Field>

            {/* The part people skip, and the reason an objective can end at all.
                Without it "until it's clean" is a thing the agent decides. */}
            <Field
              label="How anyone will know it is done"
              hint="Something checkable. This is what it is measured against — not the agent's opinion."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={exitCriteria}
                  rows={3}
                  maxLength={20_000}
                  placeholder="No open tasks under this objective, and every defect found has been fixed and verified."
                  onChange={(event) => setExitCriteria(event.target.value)}
                />
              )}
            </Field>

            <Field label="Who carries it" hint="Usually the lead. They delegate the rest.">
              {(props) => (
                <Select
                  {...props}
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  options={[
                    { value: "", label: "Choose an agent" },
                    ...(members.data ?? []).map((member) => ({
                      value: member.agentId,
                      label: member.role === "lead" ? `${member.name} (lead)` : member.name,
                    })),
                  ]}
                />
              )}
            </Field>

            {/* The part that decides whether "until it is clean" can ever be
                answered by anything other than the agent's own opinion. */}
            <Field
              label="Command that proves it"
              optional
              hint="Run by the system, not by the agent. It passes when the command exits zero."
            >
              {(props) => (
                <Input
                  {...props}
                  value={command}
                  maxLength={500}
                  placeholder="pnpm test"
                  onChange={(event) => setCommand(event.target.value)}
                  className="machine"
                />
              )}
            </Field>

            {command.trim() ? (
              <Field label="Run it in" hint="An absolute path on the machine running your agents.">
                {(props) => (
                  <Input
                    {...props}
                    value={workingDirectory}
                    maxLength={500}
                    placeholder="/Users/you/code/project"
                    onChange={(event) => setWorkingDirectory(event.target.value)}
                    className="machine"
                  />
                )}
              </Field>
            ) : null}

            <Field
              label="Something only you can judge"
              optional
              hint="The objective waits for you to confirm this. Good for anything about how it looks or feels."
            >
              {(props) => (
                <Input
                  {...props}
                  value={humanCheck}
                  maxLength={500}
                  placeholder="The checkout flow looks and feels right"
                  onChange={(event) => setHumanCheck(event.target.value)}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stop after" hint="Cycles, whatever the state.">
                {(props) => (
                  <Input
                    {...props}
                    value={maxCycles}
                    inputMode="numeric"
                    onChange={(event) => setMaxCycles(event.target.value)}
                    className="machine max-w-24"
                  />
                )}
              </Field>
              <Field label="Budget" optional hint="In dollars. Empty means no limit.">
                {(props) => (
                  <Input
                    {...props}
                    value={budget}
                    inputMode="decimal"
                    placeholder="40.00"
                    onChange={(event) => setBudget(event.target.value)}
                    className="machine max-w-28"
                  />
                )}
              </Field>
            </div>
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={!title.trim() || !directive.trim() || !exitCriteria.trim() || !owner || create.isPending}
            >
              {create.isPending ? <Spinner className="border-t-inverse" /> : <Flag />}
              Start it
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
