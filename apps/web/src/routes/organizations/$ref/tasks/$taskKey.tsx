// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Pencil, Plus, RotateCcw, Send, Unlink } from "lucide-react";
import {
  TASK_PRIORITIES,
  TASK_STATUS_LABELS,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
} from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { Callout } from "@/components/ui/callout";
import { Card, DescriptionList, DescriptionRow } from "@/components/ui/card";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui";
import {
  useBoard,
  useCommentOnTask,
  useMoveTask,
  useTask,
  useTaskBlockers,
  useUpdateTask,
  type ReviewDecision,
  type TaskDetail,
} from "@/features/tasks/queries";
import { useProjectMembers } from "@/features/projects/queries";
import { INTENT_LABEL, TASK_TONE } from "@/features/tasks/status";
import { ApiError, firstIssue } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/organizations/$ref/tasks/$taskKey")({
  component: TaskPage,
});

function TaskPage() {
  const { ref: org, taskKey } = Route.useParams();
  const query = useTask(org, taskKey);

  if (query.isPending) {
    return (
      <Page>
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-6 h-64 w-full" />
      </Page>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Page>
        <ErrorState
          title={missing ? "Task not found" : "Can't load this task"}
          description={
            missing
              ? "It may have been renumbered, or the link is wrong."
              : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            <Link
              to="/organizations/$ref/projects"
              params={{ ref: org }}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Back to projects
            </Link>
          }
        />
      </Page>
    );
  }

  const task = query.data;
  const waitingOnYou =
    task.status === "in_review" && !task.reviewState?.reviewerAgentId;

  return (
    <Page>
      <PageHeader
        back={
          <Link
            to="/organizations/$ref/projects/$projectRef"
            params={{ ref: org, projectRef: task.projectId }}
            className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3" />
            Project
          </Link>
        }
        title={task.title}
        meta={
          <>
            <Tag>{task.key}</Tag>
            <Badge tone={TASK_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
            {task.kind !== "standard" ? <Tag>{task.kind}</Tag> : null}
            <span className="text-faint">{task.assigneeName ?? "nobody"}</span>
          </>
        }
        actions={<EditTaskDialog org={org} task={task} />}
      />

      {waitingOnYou ? (
        <Callout tone="attention" className="mb-4">
          This is waiting for your verdict. No agent can judge it — accept it, or send it back
          saying what to change.
        </Callout>
      ) : null}

      {task.blockedBy.some((b) => b.status !== "done") ? (
        <Callout tone="danger" className="mb-4">
          <span>
            Waiting on{" "}
            {task.blockedBy
              .filter((b) => b.status !== "done")
              .map((b) => `${b.key} (${TASK_STATUS_LABELS[b.status].toLowerCase()})`)
              .join(", ")}
            . Only a finished blocker releases this. A cancelled one leaves it waiting on purpose —
            somebody has to decide what happens instead.
          </span>
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="flex min-w-0 flex-col gap-4">
          {task.description ? (
            <Card title="What was asked">
              <p className="whitespace-pre-wrap text-xs leading-5 text-muted">{task.description}</p>
            </Card>
          ) : null}

          <Thread org={org} task={task} />
        </div>

        <div className="flex flex-col gap-4">
          <Verdict org={org} task={task} />
          <Chain org={org} task={task} />
          <Blockers org={org} task={task} />
          <Properties task={task} />
          {task.decisions.length > 0 ? <Decisions decisions={task.decisions} /> : null}
        </div>
      </div>
    </Page>
  );
}

/**
 * Everything said about this task, in order, with the status changes woven in.
 *
 * One stream rather than a chat box beside an activity log: what an agent said
 * and what it then did are the same story, and splitting them makes you read
 * both to understand either.
 */
function Thread({ org, task }: { org: string; task: TaskDetail }) {
  const [body, setBody] = useState("");
  const comment = useCommentOnTask(org, task.key);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      await comment.mutateAsync({ body: body.trim() });
      setBody("");
      toast.success("Posted");
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "Could not post that.");
    }
  }

  const terminal = task.status === "done" || task.status === "cancelled";

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
      <h2 className="border-b border-line px-4 py-2 text-2xs font-medium text-faint">
        Conversation
      </h2>

      <div className="flex flex-col">
        {task.comments.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted">
            Nothing said yet. When an agent picks this up, what it says appears here.
          </p>
        ) : null}
        {task.comments.map((entry) => (
          <Message key={entry.id} comment={entry} />
        ))}
      </div>

      <form onSubmit={send} className="border-t border-line bg-sunken px-4 py-3">
        <Field
          label="Say something"
          hint={
            terminal
              ? "This task is finished; a comment here wakes nobody."
              : "Posting wakes whoever holds this task."
          }
        >
          {(props) => (
            <Textarea
              {...props}
              value={body}
              rows={2}
              maxLength={20_000}
              placeholder="Ask a question, or say what you want changed."
              onChange={(event) => setBody(event.target.value)}
            />
          )}
        </Field>
        <div className="mt-2 flex justify-end">
          <Button variant="secondary" size="sm" type="submit" disabled={!body.trim() || comment.isPending}>
            {comment.isPending ? <Spinner /> : <Send />}
            Post
          </Button>
        </div>
      </form>
    </div>
  );
}

function Message({ comment }: { comment: TaskComment }) {
  const system = comment.authorType === "system";
  const verdict = comment.intent === "verdict";

  if (system) {
    return (
      <p className="border-b border-line px-4 py-1.5 text-2xs text-faint">
        {comment.body} · <span title={fullDate(comment.createdAt)}>{timeAgo(comment.createdAt)}</span>
      </p>
    );
  }

  return (
    <article
      className={cn(
        "border-b border-line px-4 py-3",
        // A verdict is the thing that changes what happens next, so it is the
        // one kind of message that is marked out.
        verdict && "bg-attention-soft/40",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-ink">
          {comment.authorName ?? (comment.authorType === "user" ? "You" : "Unknown")}
        </span>
        <span className="text-2xs text-faint">
          {INTENT_LABEL[comment.intent] ?? comment.intent}
        </span>
        <span className="machine ml-auto text-2xs text-faint" title={fullDate(comment.createdAt)}>
          {timeAgo(comment.createdAt)}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted">{comment.body}</p>
    </article>
  );
}

/**
 * Accepting or sending back.
 *
 * Both need a reason, and the button will not submit without one: on a
 * rejection it is the only thing that makes the next attempt different from the
 * last, and on an acceptance it is the record of what was actually checked.
 */
function Verdict({ org, task }: { org: string; task: TaskDetail }) {
  const move = useMoveTask(org, task.key);
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  if (task.status !== "in_review") return <Move org={org} task={task} />;

  async function cast(status: TaskStatus) {
    setError(undefined);
    try {
      await move.mutateAsync({ status, comment: reason.trim() });
      toast.success(status === "done" ? "Accepted" : "Sent back");
      setOpen(null);
      setReason("");
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not record that.");
    }
  }

  return (
    <Card title="Your verdict">
      <div className="flex flex-col gap-2">
        {(["approve", "reject"] as const).map((which) => (
          <DialogRoot
            key={which}
            open={open === which}
            onOpenChange={(next) => {
              setOpen(next ? which : null);
              if (!next) {
                setReason("");
                setError(undefined);
              }
            }}
          >
            <DialogTrigger
              render={
                <Button variant={which === "approve" ? "primary" : "secondary"} size="sm">
                  {which === "approve" ? <Check /> : <RotateCcw />}
                  {which === "approve" ? "Accept" : "Send back"}
                </Button>
              }
            />
            <DialogPanel
              title={which === "approve" ? "Accept this work" : "Send it back"}
              description={
                which === "approve"
                  ? "Say what you checked. It goes on the record and into the report."
                  : "Say what to change. This is the only thing the next attempt has to go on."
              }
            >
              <DialogBody>
                <Field label="Reason" error={error}>
                  {(props) => (
                    <Textarea
                      {...props}
                      value={reason}
                      rows={4}
                      maxLength={20_000}
                      onChange={(event) => setReason(event.target.value)}
                      autoFocus
                    />
                  )}
                </Field>
              </DialogBody>
              <DialogFooter>
                <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
                <Button
                  variant={which === "approve" ? "primary" : "secondary"}
                  size="md"
                  disabled={!reason.trim() || move.isPending}
                  onClick={() => void cast(which === "approve" ? "done" : "in_progress")}
                >
                  {move.isPending ? <Spinner /> : null}
                  {which === "approve" ? "Accept" : "Send back"}
                </Button>
              </DialogFooter>
            </DialogPanel>
          </DialogRoot>
        ))}
      </div>
    </Card>
  );
}

function Move({ org, task }: { org: string; task: TaskDetail }) {
  const move = useMoveTask(org, task.key);
  const terminal = task.status === "done" || task.status === "cancelled";

  return (
    <Card title="Status">
      <Select
        aria-label="Task status"
        value={task.status}
        disabled={terminal || move.isPending}
        onChange={async (event) => {
          try {
            await move.mutateAsync({ status: event.target.value as TaskStatus });
            toast.success("Moved");
          } catch (failure) {
            toast.error(firstIssue(failure) ?? "Could not move it.");
          }
        }}
        options={(["backlog", "todo", "in_progress", "in_review", "blocked", "cancelled"] as const).map(
          (value) => ({ value, label: TASK_STATUS_LABELS[value] }),
        )}
      />
      {terminal ? (
        <p className="mt-2 text-2xs text-faint">
          Finished {task.completedAt ? timeAgo(task.completedAt) : ""}.
        </p>
      ) : null}
    </Card>
  );
}

function Properties({ task }: { task: TaskDetail }) {
  return (
    <Card title="Details">
      <DescriptionList>
        <DescriptionRow label="Assignee" value={task.assigneeName ?? "Nobody"} />
        <DescriptionRow label="Filed by" value={task.createdByName ?? "A person"} />
        <DescriptionRow label="Priority" value={task.priority} />
        <DescriptionRow label="Children" value={task.childCount === 0 ? "None" : String(task.childCount)} />
        {task.reviewState?.changesRequestedCount ? (
          <DescriptionRow label="Sent back" value={`${task.reviewState.changesRequestedCount} times`} />
        ) : null}
        <DescriptionRow
          label="Filed"
          value={<span title={fullDate(task.createdAt)}>{timeAgo(task.createdAt)}</span>}
        />
      </DescriptionList>
    </Card>
  );
}

function Decisions({ decisions }: { decisions: ReviewDecision[] }) {
  return (
    <Card title="Review history">
      <ol className="flex flex-col gap-2.5">
        {decisions.map((decision) => (
          <li key={decision.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <StatusDot tone={decision.outcome === "approved" ? "active" : "attention"} />
              <span className="text-2xs font-medium text-ink">
                Round {decision.round} · {decision.outcome === "approved" ? "accepted" : "sent back"}
              </span>
            </div>
            <p className="pl-3 text-2xs leading-4 text-muted">{decision.body}</p>
            <p className="pl-3 text-2xs text-faint">
              {decision.actorName ?? "a person"} · {timeAgo(decision.createdAt)}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * Where this sits in the chain.
 *
 * An agent filing a task for another agent is the point of the product, so the
 * page shows the hop above and the hops below as links rather than as a count.
 */
function Chain({ org, task }: { org: string; task: TaskDetail }) {
  if (!task.parent && task.children.length === 0) return null;

  return (
    <Card title="Chain">
      {task.parent ? (
        <div className="pb-2">
          <p className="pb-1 text-2xs text-faint">Filed under</p>
          <TaskLink org={org} task={task.parent} />
        </div>
      ) : null}

      {task.children.length > 0 ? (
        <div>
          <p className="pb-1 text-2xs text-faint">
            Filed from this ({task.children.length})
          </p>
          <div className="flex flex-col gap-1">
            {task.children.map((child) => (
              <TaskLink key={child.id} org={org} task={child} />
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function TaskLink({ org, task }: { org: string; task: Task }) {
  return (
    <Link
      to="/organizations/$ref/tasks/$taskKey"
      params={{ ref: org, taskKey: task.key }}
      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-sunken"
    >
      <StatusDot tone={TASK_TONE[task.status]} />
      <span className="machine shrink-0 text-2xs text-faint">{task.key}</span>
      <span className="min-w-0 flex-1 truncate text-2xs text-ink">{task.title}</span>
    </Link>
  );
}

/**
 * Declaring and clearing dependencies.
 *
 * Removing one is the decision the blocked callout asks for: when a blocker is
 * cancelled its dependent waits for ever on purpose, and this is where somebody
 * says what happens instead.
 */
function Blockers({ org, task }: { org: string; task: TaskDetail }) {
  const blockers = useTaskBlockers(org, task.key);
  const board = useBoard(org, task.projectId);
  const [adding, setAdding] = useState("");
  const terminal = task.status === "done" || task.status === "cancelled";

  const candidates = (board.data ?? []).filter(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.status !== "done" &&
      candidate.status !== "cancelled" &&
      !task.blockedBy.some((b) => b.id === candidate.id),
  );

  return (
    <Card title="Waiting on">
      {task.blockedBy.length === 0 ? (
        <p className="text-2xs text-muted">Nothing. This can start whenever somebody picks it up.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {task.blockedBy.map((blocker) => (
            <div key={blocker.id} className="flex items-center gap-1.5">
              <StatusDot tone={TASK_TONE[blocker.status]} />
              <Link
                to="/organizations/$ref/tasks/$taskKey"
                params={{ ref: org, taskKey: blocker.key }}
                className="min-w-0 flex-1 truncate text-2xs text-ink hover:underline"
              >
                <span className="machine text-faint">{blocker.key}</span> {blocker.title}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Stop waiting on ${blocker.key}`}
                disabled={blockers.remove.isPending}
                onClick={async () => {
                  try {
                    await blockers.remove.mutateAsync(blocker.id);
                    toast.success("No longer waiting on it");
                  } catch (failure) {
                    toast.error(firstIssue(failure) ?? "Could not remove it.");
                  }
                }}
              >
                <Unlink />
              </Button>
            </div>
          ))}
        </div>
      )}

      {terminal ? null : (
        <div className="mt-2 flex items-end gap-1.5">
          <Select
            aria-label="Wait on another task"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            options={[
              { value: "", label: "Wait on…" },
              ...candidates.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.key} ${candidate.title}`,
              })),
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!adding || blockers.add.isPending}
            onClick={async () => {
              try {
                await blockers.add.mutateAsync(adding);
                setAdding("");
                toast.success("Waiting on it");
              } catch (failure) {
                toast.error(firstIssue(failure) ?? "Could not add it.");
              }
            }}
          >
            <Plus />
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Everything about a task except its status, which has its own control, and its
 * key, which is permanent.
 */
function EditTaskDialog({ org, task }: { org: string; task: TaskDetail }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateTask(org, task.key);
  const members = useProjectMembers(org, task.projectId);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignee, setAssignee] = useState(task.assigneeAgentId ?? "");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setAssignee(task.assigneeAgentId ?? "");
    setError(undefined);
  }, [open, task]);

  const terminal = task.status === "done" || task.status === "cancelled";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await update.mutateAsync({
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        priority,
        // Sent only when it changed: reassigning wakes an agent, and saving a
        // typo in the title should not.
        ...(assignee !== (task.assigneeAgentId ?? "")
          ? { assigneeAgentId: assignee === "" ? null : assignee }
          : {}),
      });
      toast.success(assignee !== (task.assigneeAgentId ?? "") ? "Reassigned" : "Saved");
      setOpen(false);
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not save.");
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="md" disabled={terminal}>
            <Pencil />
            Edit
          </Button>
        }
      />
      <DialogPanel title="Edit task" description="Its key never changes; everything else can." className="max-w-120">
        <form onSubmit={onSubmit}>
          <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <Field label="Title" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
              )}
            </Field>

            <Field label="Detail" optional>
              {(props) => (
                <Textarea
                  {...props}
                  value={description}
                  rows={5}
                  maxLength={20_000}
                  onChange={(event) => setDescription(event.target.value)}
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

            <Field label="Assigned to" hint="Changing this wakes the agent you move it to.">
              {(props) => (
                <Select
                  {...props}
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  options={[
                    { value: "", label: "Nobody" },
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
            <Button variant="primary" size="md" type="submit" disabled={!title.trim() || update.isPending}>
              {update.isPending ? <Spinner className="border-t-inverse" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
