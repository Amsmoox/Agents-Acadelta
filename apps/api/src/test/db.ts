// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Integration tests run against a real PostgreSQL, never a mock: the behaviour
 * under test — a unique index settling a race, a keyset cursor not losing rows
 * — has no meaning against a fake.
 *
 * They run against their OWN database, created on demand. These suites truncate
 * between tests, so pointing them at the development database would destroy the
 * developer's data on every `pnpm test`.
 *
 * Start PostgreSQL with `pnpm infra:up`. When none is reachable the suites skip
 * rather than fail.
 */

const DEV_URL = process.env.DATABASE_URL ?? "postgres://agentco:agentco@localhost:5433/agentco";

/** Same server and credentials as development, a different database. */
function deriveTestUrl(devUrl: string): string {
  try {
    const url = new URL(devUrl);
    const name = url.pathname.replace(/^\//, "") || "agentco";
    if (name.endsWith("_test")) return devUrl;
    url.pathname = `/${name}_test`;
    return url.toString();
  } catch {
    return devUrl;
  }
}

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? deriveTestUrl(DEV_URL);

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

async function withPool<T>(connectionString: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function ensureTestDatabaseExists(): Promise<boolean> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";

  try {
    return await withPool(url.toString(), async (pool) => {
      const existing = await pool.query("select 1 from pg_database where datname = $1", [name]);
      // Identifier cannot be parameterised; the name comes from our own URL and
      // is quoted, never from user input.
      if (existing.rowCount === 0) await pool.query(`create database "${name}"`);
      return true;
    });
  } catch {
    return false;
  }
}

export async function databaseReachable(): Promise<boolean> {
  if (!(await ensureTestDatabaseExists())) return false;
  try {
    return await withPool(TEST_DATABASE_URL, async (pool) => {
      await pool.query("select 1");
      return true;
    });
  } catch {
    return false;
  }
}

export async function migrateTestDatabase(): Promise<void> {
  await withPool(TEST_DATABASE_URL, (pool) =>
    migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }),
  );
}

/** Between tests, not after: a failed test leaves its rows for inspection. */
export async function truncateAll(): Promise<void> {
  await withPool(TEST_DATABASE_URL, async (pool) => {
    await pool.query(
      "truncate table agc_organizations, agc_agents, agc_agent_config_revisions, agc_skills, agc_agent_skills, agc_agent_instruction_files, agc_agent_wakeups, agc_agent_runs, agc_run_events restart identity cascade",
    );
  });
}
