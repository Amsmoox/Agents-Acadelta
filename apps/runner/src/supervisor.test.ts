// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superviseRun, type RunEvent } from "./supervisor.js";

let transcriptDir: string;

beforeAll(async () => {
  transcriptDir = await mkdtemp(join(tmpdir(), "agentco-supervisor-"));
});

afterAll(async () => {
  await rm(transcriptDir, { recursive: true, force: true });
});

/**
 * `onStartDelayMs` stands in for the database write that records the pid. It is
 * the whole point of these tests: it is the window a fast process exits inside.
 */
function run(options: {
  command: string;
  args: string[];
  onStartDelayMs: number;
  timeoutSec?: number;
}) {
  const events: RunEvent[] = [];
  return {
    events,
    result: superviseRun({
      runId: `test-${Math.random().toString(36).slice(2)}`,
      buildSpec: () => ({ command: options.command, args: options.args, stdin: "a prompt\n", output: "text" }),
      systemPrompt: "# test",
      transcriptDir,
      timeoutSec: options.timeoutSec ?? 0,
      graceSec: 1,
      onStart: async () => {
        await new Promise((resolve) => setTimeout(resolve, options.onStartDelayMs));
      },
      onEvents: async (batch) => {
        events.push(...batch);
      },
      shouldCancel: async () => false,
      heartbeat: async () => undefined,
    }),
  };
}

describe("superviseRun", () => {
  it("finishes a process that exits before the pid has been recorded", async () => {
    // The regression. `echo` exits in about two milliseconds while recording
    // the pid takes a database round trip, so the listeners used to be attached
    // after 'close' had already fired: the promise never settled, the run sat
    // in `running` until the lease reaper marked it orphaned, and the poison
    // pill then spent two more runs on it. A hang here fails as a timeout.
    const { result } = run({ command: "echo", args: ["hi"], onStartDelayMs: 40 });
    const outcome = await result;
    expect(outcome.exitCode).toBe(0);
  }, 5_000);

  it("captures output written before the pid has been recorded", async () => {
    // Same race, second casualty: the stdout reader was attached late too, so
    // a fast process produced an empty transcript and the operator had nothing
    // to debug with.
    const { events, result } = run({ command: "echo", args: ["hi"], onStartDelayMs: 40 });
    await result;
    expect(events.map((event) => event.payload["text"])).toContain("hi");
  }, 5_000);

  it("reports a non-zero exit", async () => {
    const { result } = run({ command: "sh", args: ["-c", "exit 3"], onStartDelayMs: 40 });
    expect((await result).exitCode).toBe(3);
  }, 5_000);

  it("separates stderr from stdout", async () => {
    const { events, result } = run({
      command: "sh",
      args: ["-c", "echo out; echo boom 1>&2"],
      onStartDelayMs: 0,
    });
    await result;
    const kinds = Object.fromEntries(events.map((e) => [e.payload["text"], e.kind]));
    expect(kinds["out"]).toBe("log");
    expect(kinds["boom"]).toBe("stderr");
  }, 5_000);

  it("records the failure when the command does not exist", async () => {
    const { events, result } = run({
      command: "agentco-no-such-command",
      args: [],
      onStartDelayMs: 40,
    });
    const outcome = await result;
    expect(outcome.exitCode).toBeNull();
    expect(events.some((event) => event.kind === "error")).toBe(true);
  }, 5_000);

  it("stops a process that outlives its timeout", async () => {
    const { result } = run({
      command: "sh",
      args: ["-c", "sleep 30"],
      onStartDelayMs: 0,
      timeoutSec: 1,
    });
    expect((await result).timedOut).toBe(true);
  }, 10_000);
});
