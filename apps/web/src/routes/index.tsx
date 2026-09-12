// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">agentco</h1>
      <p className="text-sm text-muted-foreground">
        Scaffold is up. No features yet — routes, components and data live here later.
      </p>
    </main>
  );
}
