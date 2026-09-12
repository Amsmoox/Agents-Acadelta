#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * Stamps and verifies SPDX license headers across the repo.
 *
 *   node scripts/license-header.mjs --write   # add missing headers
 *   node scripts/license-header.mjs --check   # exit 1 if any file lacks one
 *
 * No third-party dependencies, on purpose: the attribution check must never
 * be able to break because of somebody else's package.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import process from "node:process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const HOLDER = "Mharrech Ayoub <mharrech.ayoub@gmail.com>";
const YEAR = "2026";
const LICENSE = "MIT";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "var", "migrations", ".vitest",
]);
const SKIP_FILES = new Set(["routeTree.gen.ts"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"]);

const BLOCK_COMMENT = new Set([".css"]);

function headerFor(ext) {
  const lines = [
    `SPDX-License-Identifier: ${LICENSE}`,
    `SPDX-FileCopyrightText: ${YEAR} ${HOLDER}`,
  ];
  if (BLOCK_COMMENT.has(ext)) {
    return `/*\n${lines.map((l) => ` * ${l}`).join("\n")}\n */\n`;
  }
  return `${lines.map((l) => `// ${l}`).join("\n")}\n`;
}

function hasHeader(source) {
  // Look only at the head of the file so a stray mention further down does not
  // count as compliance.
  return /SPDX-FileCopyrightText:/.test(source.slice(0, 600));
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".config") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (
      EXTENSIONS.has(extname(entry.name)) &&
      !SKIP_FILES.has(entry.name)
    ) {
      yield full;
    }
  }
}

const mode = process.argv.includes("--write") ? "write" : "check";
const missing = [];
let stamped = 0;

for await (const file of walk(ROOT)) {
  const source = await readFile(file, "utf8");
  if (hasHeader(source)) continue;

  if (mode === "write") {
    const ext = extname(file);
    // Keep a shebang on line 1 if there is one.
    const shebang = source.startsWith("#!") ? source.slice(0, source.indexOf("\n") + 1) : "";
    const body = source.slice(shebang.length);
    await writeFile(file, `${shebang}${headerFor(ext)}\n${body.replace(/^\n+/, "")}`);
    stamped += 1;
  } else {
    missing.push(relative(ROOT, file));
  }
}

if (mode === "write") {
  console.log(`license-header: stamped ${stamped} file(s)`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(
    `license-header: ${missing.length} file(s) are missing an SPDX header:\n` +
      missing.map((f) => `  ${f}`).join("\n") +
      `\n\nRun: pnpm license:fix`,
  );
  process.exit(1);
}

console.log("license-header: all files carry an SPDX header");
