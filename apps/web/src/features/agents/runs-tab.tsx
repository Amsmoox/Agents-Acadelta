// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, type Tone } from "@/components/ui/status";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/feedback";
import { useCancelRun, useInvokeAgent, useRunTranscript, useRuns, type Run } from "@/features/runs/queries";
import { firstIssue } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const RUN_TONE: Record<Run["status"], Tone> = {
  leased: "attention",
  running: "active",
  completed: "idle",
  failed: "danger",
  cancelled: "idle",
  orphaned: "danger",
};

const RUN_LABEL: Record<Run["status"], string> = {
  leased: "Starting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  orphaned: "Interrupted",
};

function isLive(run: Run): boolean {
  return run.status === "running" || run.status === "leased";
}

export function RunsTab({ org, agent }: { org: string; agent: string }) {
  const runs = useRuns(org, agent);
  const invoke = useInvokeAgent(org, agent);
  const cancel = useCancelRun(org);

  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const list = runs.data ?? [];
  const live = list.find(isLive);
  // Follow whatever is running unless the reader has picked something else.
  const shown = selected ?? live?.id ?? list[0]?.id ?? null;
  const shownRun = list.find((run) => run.id === shown);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-md)] border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-2 text-2xs font-medium text-faint">
          Give this agent something to do
        </h2>
        <div className="px-4 py-4">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            maxLength={20_000}
            placeholder="Review the open pull requests and summarise what needs a decision."
            className="max-w-160"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line bg-sunken px-4 py-2.5">
          <span className="text-2xs text-faint">
            {live
              ? "This agent is already working. A new request joins the one in flight."
              : "Leave it empty to let the agent pick up where it left off."}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={invoke.isPending}
            onClick={async () => {
              try {
                const result = await invoke.mutateAsync(prompt.trim() || undefined);
                setPrompt("");
                toast.success(result.coalesced ? "Added to the run in flight" : "Queued");
              } catch (failure) {
                toast.error(firstIssue(failure) ?? "Could not start a run.");
              }
            }}
          >
            {invoke.isPending ? <Spinner className="border-t-inverse" /> : <Play />}
            Run now
          </Button>
        </div>
      </section>

      {runs.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {runs.isSuccess && list.length === 0 ? (
        <List>
          <EmptyState
            title="This agent has not run yet"
            description="Give it something to do and watch what it does, line by line."
          />
        </List>
      ) : null}

      {list.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <List className="h-fit">
            {list.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelected(run.id)}
                className="block w-full text-left"
              >
                <ListRow interactive className={cn(run.id === shown && "bg-sunken")}>
                  <StatusDot tone={RUN_TONE[run.status]} className="mt-[0.4375rem] self-start" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink">{run.prompt}</p>
                    <p className="machine mt-0.5 text-2xs text-faint">
                      {RUN_LABEL[run.status]} · {timeAgo(run.createdAt)}
                    </p>
                  </div>
                </ListRow>
              </button>
            ))}
          </List>

          {shownRun ? (
            <Transcript org={org} run={shownRun} onCancel={() => cancel.mutate(shownRun.id)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Transcript({
  org,
  run,
  onCancel,
}: {
  org: string;
  run: Run;
  onCancel: () => void;
}) {
  const { lines, done } = useRunTranscript(org, run.id);
  const bottom = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  // Follows the output, but stops the moment the reader scrolls up to read
  // something — yanking them back to the bottom is the usual way this is wrong.
  useEffect(() => {
    if (follow) bottom.current?.scrollIntoView({ block: "end" });
  }, [lines, follow]);

  const status = done?.status ?? run.status;

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge tone={RUN_TONE[status as Run["status"]] ?? "idle"}>
            {RUN_LABEL[status as Run["status"]] ?? status}
          </Badge>
          {run.costCents > 0 ? (
            <span className="machine text-2xs text-faint">
              ${(run.costCents / 100).toFixed(2)}
            </span>
          ) : null}
          {run.inputTokens + run.outputTokens > 0 ? (
            <span className="machine text-2xs text-faint">
              {run.inputTokens + run.outputTokens} tokens
            </span>
          ) : null}
        </div>

        {isLive(run) ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <Square />
            Stop
          </Button>
        ) : null}
      </div>

      <div
        onScroll={(event) => {
          const el = event.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="machine max-h-96 overflow-y-auto px-3 py-3 text-2xs leading-5"
      >
        {lines.length === 0 ? (
          <p className="text-faint">
            {isLive(run) ? "Waiting for output…" : "This run produced no output."}
          </p>
        ) : (
          lines.map((line) => (
            <p
              key={line.seq}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.kind === "stderr" || line.kind === "error" ? "text-danger" : "text-muted",
              )}
            >
              {line.text}
            </p>
          ))
        )}
        <div ref={bottom} />
      </div>

      {run.error ? (
        <p className="border-t border-line bg-danger-soft px-3 py-2 text-2xs text-danger">
          {run.error}
        </p>
      ) : null}
    </div>
  );
}
