// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import {
  TASK_KINDS,
  TASK_KIND_LABELS,
  TASK_PRIORITIES,
  type Task,
  type TaskKind,
  type TaskPriority,
} from "@agentco/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/feedback";
import { List } from "@/components/ui/list";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui";
import { useProjectMembers } from "@/features/projects/queries";
import { useBoard, useCreateTask } from "@/features/tasks/queries";
import { BOARD_COLUMNS, PRIORITY_TONE, TASK_TONE } from "@/features/tasks/status";
import { firstIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The board.
 *
 * Columns rather than a list, because the question this answers is "where is
 * everything" and a status column answers it without reading. Done is last and
 * collapsed to a count once it grows: what has finished matters far less than
 * what has not.
 */
export function Board({
  org,
  project,
  disabled,
}: {
  org: string;
  project: string;
  disabled: boolean;
}) {
  const board = useBoard(org, project);
  const tasks = board.data ?? [];

  if (board.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BOARD_COLUMNS.map((column) => (
          <Skeleton key={column.status} className="h-40" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <List>
        <EmptyState
          title="No work yet"
          description="A task is one thing for one agent to do. File the first one, or give an agent a standing objective and let it file its own."
          action={disabled ? undefined : <NewTaskDialog org={org} project={project} />}
        />
      </List>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs text-faint">
          {tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length} open of{" "}
          {tasks.length}
        </p>
        {disabled ? null : <NewTaskDialog org={org} project={project} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BOARD_COLUMNS.map((column) => {
          const inColumn = tasks.filter((task) => task.status === column.status);
          return (
            <section key={column.status} className="flex min-w-0 flex-col gap-2">
              <header className="flex items-baseline justify-between gap-2 px-0.5">
                <h3 className="text-2xs font-medium text-muted" title={column.hint}>
                  {column.label}
                </h3>
                <span className="machine text-2xs text-faint">{inColumn.length}</span>
              </header>

              <div className="flex flex-col gap-2">
                {inColumn.length === 0 ? (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-line px-2 py-3 text-center text-2xs text-faint">
                    Nothing here
                  </p>
                ) : null}
                {inColumn.map((task) => (
                  <Card key={task.id} org={org} task={task} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({ org, task }: { org: string; task: Task }) {
  const priorityTone = PRIORITY_TONE[task.priority];
  const rounds = task.reviewState?.changesRequestedCount ?? 0;

  return (
    <Link
      to="/organizations/$ref/tasks/$taskKey"
      params={{ ref: org, taskKey: task.key }}
      className={cn(
        "flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-line bg-surface px-2.5 py-2",
        "transition-colors duration-75 hover:border-line-strong hover:bg-sunken",
      )}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot tone={TASK_TONE[task.status]} />
        <span className="machine text-2xs text-faint">{task.key}</span>
        {priorityTone ? <Badge tone={priorityTone}>{task.priority}</Badge> : null}
        {task.kind !== "standard" ? <Tag>{task.kind}</Tag> : null}
      </div>

      <p className="text-xs leading-4 text-ink">{task.title}</p>

      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-2xs text-muted">{task.assigneeName ?? "Nobody"}</span>
        {/* Visible without opening it: a task that has been round-tripped
            three times is the one worth looking at. */}
        {rounds > 0 ? (
          <span className="machine shrink-0 text-2xs text-attention" title={`Sent back ${rounds} time${rounds === 1 ? "" : "s"}`}>
            ↩{rounds}
          </span>
        ) : null}
        {task.blockedBy.length > 0 ? (
          <span className="machine shrink-0 text-2xs text-danger" title="Waiting on another task">
            ⛔{task.blockedBy.length}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function NewTaskDialog({ org, project }: { org: string; project: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TaskKind>("standard");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string>();

  const create = useCreateTask(org, project);
  const members = useProjectMembers(org, project);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await create.mutateAsync({
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        kind,
        priority,
        status: "todo",
        ...(assignee ? { assigneeAgentId: assignee } : {}),
      });
      toast.success(assignee ? "Filed and assigned" : "Filed");
      setOpen(false);
      setTitle("");
      setDescription("");
      setAssignee("");
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not file this task.");
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="primary" size="sm">
            <Plus />
            New task
          </Button>
        }
      />
      <DialogPanel
        title="New task"
        description="One thing, for one agent. Assigning it wakes them."
        className="max-w-120"
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <Field label="Title" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  maxLength={200}
                  placeholder="Empty password is accepted at payment"
                  onChange={(event) => setTitle(event.target.value)}
                  autoFocus
                />
              )}
            </Field>

            <Field label="Detail" optional hint="Everything they need to start. They read this.">
              {(props) => (
                <Textarea
                  {...props}
                  value={description}
                  maxLength={20_000}
                  rows={5}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind" hint="What sort of work this is.">
                {(props) => (
                  <Select
                    {...props}
                    value={kind}
                    onChange={(event) => setKind(event.target.value as TaskKind)}
                    options={TASK_KINDS.filter((k) => k !== "report").map((value) => ({
                      value,
                      label: TASK_KIND_LABELS[value],
                    }))}
                  />
                )}
              </Field>

              <Field label="Priority">
                {(props) => (
                  <Select
                    {...props}
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as TaskPriority)}
                    options={TASK_PRIORITIES.map((value) => ({ value, label: value }))}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Assign to"
              optional
              hint="Assigning wakes the agent. Leave empty to file it without starting anything."
            >
              {(props) => (
                <Select
                  {...props}
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  options={[
                    { value: "", label: "Nobody yet" },
                    ...(members.data ?? []).map((member) => ({
                      value: member.agentId,
                      label: member.name,
                    })),
                  ]}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? <Spinner className="border-t-inverse" /> : null}
              File task
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
