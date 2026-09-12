// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The `agentco` command, as a file on the child's PATH.
 *
 * Deliberately almost empty. It carries the credential from the environment
 * and the arguments from the command line, and the server decides what they
 * mean — so a tool can be added or changed without reissuing anything, and
 * there is never a shim in the wild that disagrees with the API about what a
 * command does.
 */
const SHIM = `#!/usr/bin/env node
const token = process.env.AGENTCO_RUN_TOKEN;
const base = process.env.AGENTCO_API_URL;

if (!token || !base) {
  console.log(JSON.stringify({ ok: false, error: "This command only works inside a run." }));
  process.exit(1);
}

const argv = process.argv.slice(2);

try {
  const response = await fetch(base + "/agent/exec", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ argv }),
  });
  const payload = await response.json().catch(() => null);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(response.ok && payload && payload.ok !== false ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: "Could not reach the server: " + String(error) }));
  process.exit(1);
}
`;

export const SHIM_COMMAND = "agentco";

/** Writes the shim and returns the directory to put on a child's PATH. */
export async function writeShim(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, SHIM_COMMAND);
  await writeFile(path, SHIM, "utf8");
  await chmod(path, 0o755);
  return directory;
}
