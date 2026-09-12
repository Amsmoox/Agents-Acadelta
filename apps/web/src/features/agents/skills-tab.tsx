// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Library } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { List } from "@/components/ui/list";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/feedback";
import { Tag } from "@/components/ui/status";
import {
  useAgentSkills,
  useSetAgentSkills,
  useSkillManifest,
  useSkills,
} from "@/features/skills/queries";
import { firstIssue } from "@/lib/api";

/**
 * Which of the organization's skills this agent has.
 *
 * Enabling decides what is mounted into the agent's workspace. Every skill in
 * the library still appears in the agent's manifest, marked as not enabled —
 * otherwise the agent cannot tell a skill it lacks from one that does not
 * exist, and will report a freshly written skill as missing.
 */
export function SkillsTab({ org, agent }: { org: string; agent: string }) {
  const library = useSkills(org);
  const enabled = useAgentSkills(org, agent);
  const save = useSetAgentSkills(org, agent);
  const manifest = useSkillManifest(org, agent);

  const [selection, setSelection] = useState<string[] | null>(null);
  const current = selection ?? enabled.data ?? [];
  const dirty =
    selection !== null &&
    JSON.stringify([...selection].sort()) !== JSON.stringify([...(enabled.data ?? [])].sort());

  useEffect(() => setSelection(null), [enabled.data]);

  if (library.isPending || enabled.isPending) return <Skeleton className="h-48 w-full" />;

  const skills = library.data ?? [];

  if (skills.length === 0) {
    return (
      <List>
        <EmptyState
          title="No skills in this organization yet"
          description="A skill is a document an agent reads when it applies. Write one and it becomes available to every agent here."
          action={
            <Link
              to="/organizations/$ref/skills"
              params={{ ref: org }}
              className={buttonVariants({ variant: "primary", size: "sm" })}
            >
              <Library className="size-3.5" />
              Go to skills
            </Link>
          }
        />
      </List>
    );
  }

  const toggle = (id: string) =>
    setSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-2xs font-medium text-faint">
            {current.length} of {skills.length} enabled
          </span>
          <Link
            to="/organizations/$ref/skills"
            params={{ ref: org }}
            className="text-2xs text-muted hover:text-ink"
          >
            Manage library
          </Link>
        </div>

        {skills.map((skill) => {
          const on = current.includes(skill.id);
          return (
            <label
              key={skill.id}
              className="flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-sunken"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(skill.id)}
                className="mt-0.5 size-3.5 shrink-0 rounded-[2px] border-line accent-[var(--ink)]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink">{skill.name}</span>
                  <Tag>{skill.slug}</Tag>
                </span>
                {skill.description ? (
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {skill.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}

        <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-3 py-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(current);
                setSelection(null);
                toast.success("Saved");
              } catch (failure) {
                toast.error(firstIssue(failure) ?? "Could not save.");
              }
            }}
          >
            {save.isPending ? <Spinner className="border-t-inverse" /> : null}
            Save skills
          </Button>
        </div>
      </div>

      {/* A prompt nobody can read is a prompt nobody can debug. */}
      <details className="rounded-[var(--radius-md)] border border-line bg-surface">
        <summary className="cursor-pointer px-3 py-2 text-2xs font-medium text-faint">
          What the agent is told about skills
        </summary>
        <pre className="machine overflow-x-auto border-t border-line px-3 py-3 text-2xs leading-5 text-muted">
          {manifest.data ?? "…"}
        </pre>
      </details>
    </div>
  );
}
