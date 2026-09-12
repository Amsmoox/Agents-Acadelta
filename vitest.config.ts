// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the web app's tsconfig path so its modules resolve the same way
      // under the test runner as they do under Vite.
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["{apps,packages}/*/src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    passWithNoTests: true,
  },
});
