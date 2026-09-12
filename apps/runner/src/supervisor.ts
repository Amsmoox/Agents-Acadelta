// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { SpawnSpec } from "@agentco/adapters";

/**
 * Runs one agent process and reports what it does.
 *
 * Output is written to an append-only file first and read back from there,
 * rather than being held only in a pipe. If this runner dies the child keeps
 * writing, and a restarted runner can pick the transcript up from where it
 * stopped — a pipe would simply lose it.
 */

export type RunEvent = { kind: string; payload: Record<string, unknown> };

export type SupervisedResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
};

export type SupervisorOptions = {
  runId: string;
  buildSpec: (systemPromptPath: string) => SpawnSpec;
  systemPrompt: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  transcriptDir: string;
  timeoutSec: number;
  graceSec: number;
  onStart: (
    pid: number,
    systemPromptPath: string,
    transcriptPath: string,
    command: string,
  ) => Promise<void>;
  onEvents: (events: RunEvent[]) => Promise<unknown>;
  /** Polled between batches so a cancel does not wait for the next output. */
  shouldCancel: () => Promise<boolean>;
  heartbeat: () => Promise<void>;
};

const FLUSH_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 5_000;

/** Usage as reported by a stream-json line, whatever shape the tool uses. */
function readUsage(line: Record<string, unknown>): {
  input: number;
  output: number;
  costCents: number;
} {
  const usage = (line["usage"] ?? {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === "number" ? value : 0);

  const costUsd = number(line["total_cost_usd"]);
  return {
    input: number(usage["input_tokens"]) + number(usage["cache_read_input_tokens"]),
    output: number(usage["output_tokens"]),
    costCents: Math.round(costUsd * 100),
  };
}

export async function superviseRun(options: SupervisorOptions): Promise<SupervisedResult> {
  const runDir = join(options.transcriptDir, options.runId);
  await mkdir(runDir, { recursive: true });

  const systemPromptPath = join(runDir, "system-prompt.md");
  const transcriptPath = join(runDir, "transcript.ndjson");
  await writeFile(systemPromptPath, options.systemPrompt, "utf8");
  await mkdir(dirname(transcriptPath), { recursive: true });

  const transcript = createWriteStream(transcriptPath, { flags: "a" });

  // Built here, not by the caller: the tool is told where to read its system
  // prompt from, and that file does not exist until the line above.
  const spec = options.buildSpec(systemPromptPath);

  const child = spawn(spec.command, spec.args, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    // Its own process group, so a timeout can stop the whole tree rather than
    // just the parent and leave orphans behind.
    detached: true,
  });

  if (!child.pid) {
    transcript.end();
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
    };
  }

  await options.onStart(child.pid, systemPromptPath, transcriptPath, spec.command);

  if (spec.stdin !== undefined) {
    child.stdin.write(spec.stdin);
  }
  child.stdin.end();

  let inputTokens = 0;
  let outputTokens = 0;
  let costCents = 0;
  let timedOut = false;
  let cancelled = false;

  let buffer: RunEvent[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await options.onEvents(batch);
  };

  const record = (kind: string, payload: Record<string, unknown>) => {
    transcript.write(`${JSON.stringify({ kind, ...payload })}\n`);
    buffer.push({ kind, payload });
  };

  for (const [stream, kind] of [
    [child.stdout, "log"],
    [child.stderr, "stderr"],
  ] as const) {
    createInterface({ input: stream }).on("line", (line) => {
      if (line.trim() === "") return;

      if (spec.output === "stream-json" && kind === "log") {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const usage = readUsage(parsed);
          inputTokens += usage.input;
          outputTokens += usage.output;
          // Cost is cumulative per turn in these formats, so the last value
          // wins rather than the sum of every line.
          if (usage.costCents > 0) costCents = usage.costCents;
          record("json", parsed);
          return;
        } catch {
          // A tool that promised JSON and emitted something else is still worth
          // showing, verbatim, rather than dropping.
        }
      }
      record(kind, { text: line });
    });
  }

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      await options.heartbeat();
      if (!cancelled && (await options.shouldCancel())) {
        cancelled = true;
        stop("SIGTERM");
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);

  const stop = (signal: NodeJS.Signals) => {
    try {
      // Negative pid: the whole process group, not only the child we spawned.
      process.kill(-child.pid!, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };

  const timeoutTimer =
    options.timeoutSec > 0
      ? setTimeout(() => {
          timedOut = true;
          stop("SIGTERM");
          // Asked first, forced second. A tool given no chance to shut down
          // cleanly leaves half-written files behind.
          setTimeout(() => stop("SIGKILL"), Math.max(1, options.graceSec) * 1000);
        }, options.timeoutSec * 1000)
      : null;

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("error", (error) => {
        record("error", { message: error.message });
        resolve({ code: null, signal: null });
      });
      child.on("close", (code, signal) => resolve({ code, signal }));
    },
  );

  clearInterval(flushTimer);
  clearInterval(heartbeatTimer);
  if (timeoutTimer) clearTimeout(timeoutTimer);

  await flush();
  await new Promise<void>((resolve) => transcript.end(resolve));

  return {
    exitCode: result.code,
    signal: result.signal,
    timedOut,
    cancelled,
    inputTokens,
    outputTokens,
    costCents,
  };
}
