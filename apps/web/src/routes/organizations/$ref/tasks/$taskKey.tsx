// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Check, RotateCcw, Send } from "lucide-react";
import {
  TASK_STATUS_LABELS,
  type TaskComment,
  type TaskStatus,
} from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
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
  useCommentOnTask,
  useMoveTask,
  useTask,
  type ReviewDecision,
  type TaskDetail,
} from "@/features/tasks/queries";
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
      />

      {waitingOnYou ? (
        <Callout tone="attention" className="mb-4">
          This is waiting for your verdict. No agent can judge it — accept it, or send it back
          saying what to change.
        </Callout>
      ) : null}

      {task.blockedBy.some((b) => b.status !== "done") ? (
        <Callout tone="danger" className="mb-4">
          Waiting on{" "}
          {task.blockedBy
            .filter((b) => b.status !== "done")
            .map((b) => `${b.key} (${b.status})`)
            .join(", ")}
          . Only a finished blocker releases it — cancelling one leaves this waiting on purpose.
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
