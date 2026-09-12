// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Building2, Bot, ListChecks, Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Navigation names what the operator manages, not how the system is built:
 * Organizations, Agents, Tasks. Sections that do not exist yet are shown and
 * disabled rather than hidden, so the shape of the product is legible from the
 * first screen.
 */
const NAV = [
  { to: "/organizations", label: "Organizations", icon: Building2, ready: true },
  { to: "/agents", label: "Agents", icon: Bot, ready: true },
  { to: "/tasks", label: "Tasks", icon: ListChecks, ready: false },
] as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = readTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside
        className={cn(
          "flex shrink-0 flex-col gap-1 border-line bg-sunken",
          "border-b px-3 py-3 md:h-dvh md:w-52 md:border-b-0 md:border-r md:px-2.5 md:py-3",
          "md:sticky md:top-0",
        )}
      >
        <div className="flex items-center justify-between px-1.5 pb-1">
          <Link to="/organizations" className="text-2xs font-medium tracking-[0.01em] text-faint">
            agentco
          </Link>
          <ThemeToggle />
        </div>

        <div className="pb-3">
          <OrganizationSwitcher />
        </div>

        <nav className="flex gap-1 md:flex-col">
          {NAV.map(({ to, label, icon: Icon, ready }) =>
            ready ? (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5",
                  "text-xs font-medium text-muted transition-colors duration-75",
                  "hover:bg-surface hover:text-ink",
                )}
                activeProps={{ className: "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.04)]" }}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            ) : (
              <span
                key={to}
                aria-disabled
                title="Not built yet"
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-faint"
              >
                <Icon className="size-3.5" />
                {label}
              </span>
            ),
          )}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
