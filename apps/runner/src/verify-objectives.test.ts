// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCheckCommand } from "./verify-objectives.js";

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agentco-checks-"));
  await writeFile(join(workspace, "marker.txt"), "here", "utf8");
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * The command check is the one thing in the system that turns an agent's claim
 * into a fact, so what it does with each kind of failure matters more than the
 * happy path.
 */
describe("running an objective check", () => {
  it("passes on exit zero", async () => {
    const run = await runCheckCommand("exit 0", workspace);
    expect(run.exitCode).toBe(0);
  });

  it("fails on a non-zero exit, and keeps what was printed", async () => {
    const run = await runCheckCommand("echo '3 tests failed' && exit 1", workspace);
    expect(run.exitCode).toBe(1);
    expect(run.output).toContain("3 tests failed");
  });

  it("runs in the directory it was given", async () => {
    const run = await runCheckCommand("cat marker.txt", workspace);
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe("here");
  });

  it("reports a command that does not exist rather than throwing", async () => {
    // Through a shell, so this is a non-zero exit rather than a spawn error —
    // either way it must come back as a failed check, never an exception that
    // stops every other objective being verified.
    const run = await runCheckCommand("agentco-no-such-command", workspace);
    expect(run.exitCode).not.toBe(0);
  });

  it("keeps the end of a very noisy command, where the failure is", async () => {
    const run = await runCheckCommand("seq 1 100000 && echo THE-END && exit 1", workspace);
    expect(run.output).toContain("THE-END");
    expect(run.output.length).toBeLessThanOrEqual(2_000);
  });

  it("kills a command that hangs instead of waiting for ever", async () => {
    const run = await runCheckCommand("sleep 30", workspace, 700);
    expect(run.timedOut).toBe(true);
    expect(run.exitCode).not.toBe(0);
  }, 10_000);

  it("understands a shell pipeline, because that is what people write", async () => {
    const run = await runCheckCommand("echo hello | grep -q hello", workspace);
    expect(run.exitCode).toBe(0);
  });
});
