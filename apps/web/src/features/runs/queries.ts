// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api";

export type Run = {
  id: string;
  agentId: string;
  status: "leased" | "running" | "completed" | "failed" | "cancelled" | "orphaned";
  prompt: string;
  exitCode: number | null;
  stopReason: string | null;
  error: string | null;
  lastSeq: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export type TranscriptLine = { seq: number; kind: string; text: string };

export const runKeys = {
  all: ["runs"] as const,
  list: (org: string, agent: string) => ["runs", org, agent] as const,
  detail: (org: string, runId: string) => ["runs", org, "detail", runId] as const,
};

export function useRuns(org: string, agent: string) {
  return useQuery({
    queryKey: runKeys.list(org, agent),
    queryFn: () => request<{ data: Run[] }>(`/organizations/${org}/agents/${agent}/runs`),
    select: (result) => result.data,
    // Always polling, at two speeds. Invoking creates a WAKEUP, not a run — the
    // runner turns one into the other a moment later — so a list that only
    // polled while something was already running would never show the run it
    // was waiting for.
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some(
        (run) => run.status === "running" || run.status === "leased",
      )
        ? 2000
        : 5000,
  });
}

/** One run, as it appears in the organization-wide list. */
export type OrganizationRun = {
  id: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  adapterType: string;
  status: Run["status"];
  prompt: string;
  error: string | null;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

/**
 * Everything happening in the organization, newest first.
 *
 * Runs were only ever reachable through the agent that produced them, so
 * "what is happening right now" meant opening each agent in turn. With four
 * agents working together that is the question you ask most.
 */
export function useOrganizationRuns(org: string, status?: "live" | "finished") {
  return useQuery({
    queryKey: ["runs", org, "organization", status ?? "all"] as const,
    queryFn: () =>
      request<{ data: OrganizationRun[] }>(
        `/organizations/${org}/runs${status ? `?status=${status}` : ""}`,
      ),
    select: (result) => result.data,
    // Same two speeds as the per-agent list, and for the same reason: invoking
    // creates a wakeup, and the run it turns into arrives a moment later.
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some(
        (run) => run.status === "running" || run.status === "leased",
      )
        ? 2000
        : 5000,
  });
}

export function useInvokeAgent(org: string, agent: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (prompt?: string) =>
      request<{ queued: boolean; coalesced: boolean }>(
        `/organizations/${org}/agents/${agent}/invoke`,
        { method: "POST", body: JSON.stringify(prompt ? { prompt } : {}) },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: runKeys.all }),
  });
}

export function useCancelRun(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      request<{ cancelling: boolean }>(`/organizations/${org}/runs/${runId}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: runKeys.all }),
  });
}

/**
 * Follows a run's transcript as it is produced.
 *
 * Server-sent events rather than polling, and each line carries its sequence
 * number, so a dropped connection resumes from where it stopped instead of
 * replaying the run or losing its middle.
 */
export function useRunTranscript(org: string, runId: string | null) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [done, setDone] = useState<{ status: string; exitCode: number | null } | null>(null);
  const [connected, setConnected] = useState(true);
  const lastSeq = useRef(0);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!runId) {
      setLines([]);
      setDone(null);
      return;
    }

    setLines([]);
    setDone(null);
    setConnected(true);
    lastSeq.current = 0;
    seen.current = new Set();

    // No `?from=`. The browser sends `Last-Event-ID` by itself when it
    // reconnects and it knows exactly where this reader got to; a `from` in the
    // URL is frozen at whatever the view was opened with, and pinning it to 0
    // meant every reconnect replayed the whole run into an existing view.
    const source = new EventSource(`/api/organizations/${org}/runs/${runId}/stream`);

    const append = (event: MessageEvent, kind: string) => {
      const seq = Number(event.lastEventId) || lastSeq.current + 1;
      // A reconnect can overlap by a line or two. Sequence numbers are the
      // whole point of having them.
      if (seen.current.has(seq)) return;
      seen.current.add(seq);
      lastSeq.current = Math.max(lastSeq.current, seq);

      let text: string;
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        text = typeof payload["text"] === "string" ? payload["text"] : JSON.stringify(payload);
      } catch {
        text = event.data;
      }
      setLines((current) =>
        [...current, { seq, kind, text }].sort((a, b) => a.seq - b.seq),
      );
    };

    for (const kind of ["log", "stderr", "json", "error"]) {
      source.addEventListener(kind, (event) => append(event as MessageEvent, kind));
    }

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("done", (event) => {
      setDone(JSON.parse((event as MessageEvent).data));
      // The only place this stream is closed on purpose. Everything else is a
      // blip, and EventSource is better at recovering from those than we are.
      source.close();
    });

    // Deliberately not `source.close()`. Closing here meant one dropped packet
    // ended the transcript for good, silently — the agent kept working and the
    // screen simply stopped, which reads exactly like a hung agent. Leaving it
    // open lets EventSource reconnect on its own, with `Last-Event-ID`.
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, [org, runId]);

  return { lines, done, connected };
}
