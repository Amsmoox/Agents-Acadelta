// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * Build identity, resolved at process start.
 *
 * `GIT_COMMIT` and `BUILD_TIME` are injected by the build; when they are absent
 * (a dev run from source) the values read as "dev", which is itself accurate.
 */
export const buildInfo = {
  version: process.env.npm_package_version ?? "0.0.0",
  commit: process.env.GIT_COMMIT ?? "dev",
  builtAt: process.env.BUILD_TIME ?? "dev",
} as const;
