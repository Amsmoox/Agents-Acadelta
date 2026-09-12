// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env present; fall back to whatever is already in the environment.
}

// `generate` only diffs the schema and needs no server, so a missing URL is not
// fatal here — `migrate`, `push` and `studio` fail loudly on the placeholder.
const url = process.env.DATABASE_URL ?? "postgres://unset:unset@localhost:5433/unset";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
