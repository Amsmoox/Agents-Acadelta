// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { defineConfig } from "tsup";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  // Workspace packages are source-only, so they get bundled in.
  noExternal: [/^@agentco\//],
  clean: true,
  sourcemap: true,
  // Attribution survives into the distributed artifact, not just the source.
  banner: {
    js: [
      "/*!",
      " * agentco — control plane for running a company of AI agents",
      " * Copyright (c) 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>",
      " * SPDX-License-Identifier: MIT",
      " */",
    ].join("\n"),
  },
  env: {
    npm_package_version: pkg.version,
    GIT_COMMIT: gitCommit(),
    BUILD_TIME: new Date().toISOString(),
  },
});
