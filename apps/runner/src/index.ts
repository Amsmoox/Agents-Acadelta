// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase } from "@agentco/db";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === "development");
const database = createDatabase(env.DATABASE_URL, 5);

const transcriptDir = resolve(process.cwd(), env.RUN_TRANSCRIPT_DIR);
await mkdir(transcriptDir, { recursive: true });

let stopping = false;

/**
 * The dispatch loop. Empty on purpose — claiming wakeups, leasing runs,
 * spawning agent processes and tailing transcripts all land here later.
 */
async function tick(): Promise<void> {
  // no-op
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      log.error({ err: error }, "dispatch tick failed");
    }
    await new Promise((r) => setTimeout(r, env.DISPATCH_POLL_INTERVAL_MS));
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "shutting down runner");
  await database.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}

log.info(
  { transcriptDir, pollIntervalMs: env.DISPATCH_POLL_INTERVAL_MS },
  "runner started (dispatch loop is a no-op)",
);

await loop();
