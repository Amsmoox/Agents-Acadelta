// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, Building2, Bot, FolderKanban, Library, ListChecks, Moon, Settings, Sun } from "lucide-react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Navigation names what the operator manages, not how the system is built:
 * Organizations, Agents, Tasks. Sections that do not exist yet are shown and
 * disabled rather than hidden, so the shape of the product is legible from the
 * first screen.
 *
 * Everything below Organizations belongs to one organization, so those links
 * are unreachable until one is chosen — shown disabled rather than hidden, so
 * the reason is visible.
 */
const PENDING = [{ label: "Tasks", icon: ListChecks }] as const;

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

const navLink = cn(
  "flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5",
  "text-xs font-medium text-muted transition-colors duration-75",
  "hover:bg-surface hover:text-ink",
);
const navActive = "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.04)]";
const navDisabled = cn(
  "flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5",
  "text-xs font-medium text-faint",
);

export function AppShell({ children }: { children: ReactNode }) {
  const { current } = useCurrentOrganization();
  const org = current?.slug;

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
          <Link
            to="/organizations"
            // Agents now live UNDER /organizations/:ref, and the router matches
            // active state by prefix, so without this both items light up.
            activeOptions={{ exact: true }}
            className={navLink}
            activeProps={{ className: navActive }}
          >
            <Building2 className="size-3.5" />
            Organizations
          </Link>

          {org ? (
            <Link
              to="/organizations/$ref/agents"
              params={{ ref: org }}
              className={navLink}
              activeProps={{ className: navActive }}
            >
              <Bot className="size-3.5" />
              Agents
            </Link>
          ) : (
            <span aria-disabled title="Choose an organization first" className={navDisabled}>
              <Bot className="size-3.5" />
              Agents
            </span>
          )}

          {org ? (
            <Link
              to="/organizations/$ref/projects"
              params={{ ref: org }}
              className={navLink}
              activeProps={{ className: navActive }}
            >
              <FolderKanban className="size-3.5" />
              Projects
            </Link>
          ) : (
            <span aria-disabled title="Choose an organization first" className={navDisabled}>
              <FolderKanban className="size-3.5" />
              Projects
            </span>
          )}

          {org ? (
            <Link
              to="/organizations/$ref/activity"
              params={{ ref: org }}
              className={navLink}
              activeProps={{ className: navActive }}
            >
              <Activity className="size-3.5" />
              Activity
            </Link>
          ) : (
            <span aria-disabled title="Choose an organization first" className={navDisabled}>
              <Activity className="size-3.5" />
              Activity
            </span>
          )}

          {org ? (
            <Link
              to="/organizations/$ref/skills"
              params={{ ref: org }}
              className={navLink}
              activeProps={{ className: navActive }}
            >
              <Library className="size-3.5" />
              Skills
            </Link>
          ) : (
            <span aria-disabled title="Choose an organization first" className={navDisabled}>
              <Library className="size-3.5" />
              Skills
            </span>
          )}

          {PENDING.map(({ label, icon: Icon }) => (
            <span key={label} aria-disabled title="Not built yet" className={navDisabled}>
              <Icon className="size-3.5" />
              {label}
            </span>
          ))}

          {/* Renaming an organization, or archiving it, was only reachable by
              going back out to the list and clicking in again — a round trip
              out of the thing you were already inside. `exact` because every
              section below is a path prefix of this one. */}
          {org ? (
            <Link
              to="/organizations/$ref"
              params={{ ref: org }}
              activeOptions={{ exact: true }}
              className={cn(navLink, "md:mt-auto")}
              activeProps={{ className: navActive }}
            >
              <Settings className="size-3.5" />
              Settings
            </Link>
          ) : null}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
