// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Integration tests run against a real PostgreSQL, never a mock: the behaviour
 * under test here — a partial unique index settling a race between concurrent
 * inserts — has no meaning against a fake.
 *
 * Start one with `pnpm infra:up`. When no database is reachable the suites skip
 * rather than fail, so `pnpm test` stays useful without Docker running.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://agentco:agentco@localhost:5433/agentco";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));

export async function databaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function migrateTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/** Between tests, not after: a failed test leaves its rows for inspection. */
export async function truncateAll(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query("truncate table agc_organizations restart identity cascade");
  } finally {
    await pool.end();
  }
}
