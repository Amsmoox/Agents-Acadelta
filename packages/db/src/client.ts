// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Creates a pooled Drizzle client. Callers own the lifecycle and must call
 * `close()` on shutdown — the api and runner each hold their own pool.
 */
export function createDatabase(connectionString: string, max = 10) {
  const pool = new Pool({ connectionString, max });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
