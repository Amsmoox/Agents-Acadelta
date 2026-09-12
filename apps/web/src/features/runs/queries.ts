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
 * number so a dropped connection resumes from where it stopped instead of
 * replaying the run or losing its middle.
 */
export function useRunTranscript(org: string, runId: string | null) {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [done, setDone] = useState<{ status: string; exitCode: number | null } | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!runId) {
      setLines([]);
      setDone(null);
      return;
    }

    setLines([]);
    setDone(null);
    lastSeq.current = 0;

    const source = new EventSource(
      `/api/organizations/${org}/runs/${runId}/stream?from=0`,
    );

    const append = (event: MessageEvent, kind: string) => {
      const seq = Number(event.lastEventId) || lastSeq.current + 1;
      lastSeq.current = seq;
      let text: string;
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        text =
          typeof payload["text"] === "string"
            ? payload["text"]
            : JSON.stringify(payload);
      } catch {
        text = event.data;
      }
      setLines((current) => [...current, { seq, kind, text }]);
    };

    for (const kind of ["log", "stderr", "json", "error"]) {
      source.addEventListener(kind, (event) => append(event as MessageEvent, kind));
    }
    source.addEventListener("done", (event) => {
      setDone(JSON.parse((event as MessageEvent).data));
      source.close();
    });
    source.onerror = () => source.close();

    return () => source.close();
  }, [org, runId]);

  return { lines, done };
}
