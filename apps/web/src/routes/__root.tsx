// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";

export type RouterContext = {
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className:
            "!bg-surface !border-line !text-ink !text-xs !rounded-[var(--radius-md)] !font-sans",
        }}
      />
    </AppShell>
  );
}
