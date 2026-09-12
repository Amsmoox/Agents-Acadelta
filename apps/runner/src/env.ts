// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.url(),
  RUN_TRANSCRIPT_DIR: z.string().default("./var/run-transcripts"),
  DISPATCH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
  RUN_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  RUN_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(7000),
  /** How many agents this runner will supervise at once. */
  MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().max(64).default(8),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}\n\nDid you copy .env.example to .env?`);
  }
  return parsed.data;
}
