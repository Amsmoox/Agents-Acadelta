// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useMemo, useState } from "react";
import { BookOpen, Check, Download, Search } from "lucide-react";
import { AGENT_ROLE_LABELS, AGENT_ROLES, type AgentRole } from "@agentco/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge, Tag } from "@/components/ui/status";
import { CheckboxField } from "@/components/ui/checkbox";
import { Skeleton, Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui";
import {
  useCatalogue,
  useInstallCatalogueSkills,
  type CatalogueSkill,
} from "@/features/skills/queries";
import { firstIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Browsing the skills that ship with the product.
 *
 * Installing copies a skill into this organization's library, where it can then
 * be edited — so the catalogue is a starting point, not a dependency, and the
 * dialog says so rather than implying a link that does not exist.
 *
 * Nothing is attached to an agent here. Which skills an agent has is a separate,
 * deliberate choice, made on the agent.
 */
export function CatalogueDialog({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"" | AgentRole>("");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  const catalogue = useCatalogue(org, role || undefined);
  const install = useInstallCatalogueSkills(org);

  const shown = useMemo(() => {
    const all = catalogue.data?.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((skill) =>
      [skill.name, skill.slug, skill.description, skill.category, ...skill.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [catalogue.data, query]);

  const byCategory = useMemo(() => {
    const groups = new Map<string, CatalogueSkill[]>();
    for (const skill of shown) {
      const bucket = groups.get(skill.category);
      if (bucket) bucket.push(skill);
      else groups.set(skill.category, [skill]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);

  async function onInstall() {
    try {
      const result = await install.mutateAsync(chosen);
      const added = result.installed.length + result.refreshed.length;
      toast.success(added === 1 ? "Added to your library" : `${added} added to your library`);
      // Said out loud rather than silently skipped: somebody chose these, and a
      // skill they edited being left alone is a decision they should hear about.
      if (result.keptLocalEdits.length > 0) {
        toast.info(
          `${result.keptLocalEdits.length} left as they are — you have edited them since installing.`,
        );
      }
      setChosen([]);
      setOpen(false);
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "Could not add those.");
    }
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setChosen([]);
          setQuery("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="secondary" size="md">
            <BookOpen />
            Browse catalogue
          </Button>
        }
      />
      <DialogPanel
        title="Skill catalogue"
        description="Skills that ship with the product. Adding one copies it into your library, where you can edit it."
        className="max-w-180"
      >
        <DialogBody className="flex max-h-[68vh] flex-col gap-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, tag or discipline"
                className="pl-7"
                aria-label="Search the catalogue"
              />
            </div>
            <Select
              aria-label="Suited to role"
              value={role}
              onChange={(event) => setRole(event.target.value as "" | AgentRole)}
              options={[
                { value: "", label: "Any role" },
                ...AGENT_ROLES.map((value) => ({
                  value,
                  label: `Suited to ${AGENT_ROLE_LABELS[value]}`,
                })),
              ]}
              className="max-w-52"
            />
          </div>

          {catalogue.isPending ? <Skeleton className="h-64 w-full" /> : null}

          {catalogue.isSuccess && shown.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted">
              Nothing matches. Try a broader search, or clear the role filter.
            </p>
          ) : null}

          {byCategory.map(([category, entries]) => (
            <section key={category}>
              <h3 className="pb-1 text-2xs font-medium uppercase tracking-[0.04em] text-faint">
                {category}
              </h3>
              <div className="flex flex-col gap-1.5">
                {entries.map((skill) => (
                  <Row
                    key={skill.slug}
                    skill={skill}
                    checked={chosen.includes(skill.slug)}
                    onToggle={(on) =>
                      setChosen((current) =>
                        on
                          ? [...current, skill.slug]
                          : current.filter((slug) => slug !== skill.slug),
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </DialogBody>

        <DialogFooter>
          <span className="mr-auto text-2xs text-faint">
            {chosen.length === 0
              ? "Adding a skill does not give it to any agent — you choose that per agent."
              : `${chosen.length} selected`}
          </span>
          <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
          <Button
            variant="primary"
            size="md"
            disabled={chosen.length === 0 || install.isPending}
            onClick={() => void onInstall()}
          >
            {install.isPending ? <Spinner className="border-t-inverse" /> : <Download />}
            Add to library
          </Button>
        </DialogFooter>
      </DialogPanel>
    </DialogRoot>
  );
}

function Row({
  skill,
  checked,
  onToggle,
}: {
  skill: CatalogueSkill;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border px-2.5 py-2 transition-colors duration-75",
        checked ? "border-line-strong bg-sunken" : "border-line",
      )}
    >
      {skill.installed ? (
        <div className="flex items-start gap-2.5 opacity-60">
          <Check className="mt-0.5 size-3.5 shrink-0 text-active" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-ink">{skill.name}</span>
              <Badge tone="active">In your library</Badge>
            </div>
            <p className="mt-0.5 text-2xs leading-4 text-muted">{skill.description}</p>
          </div>
        </div>
      ) : (
        <CheckboxField
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
          label={
            <span className="flex flex-wrap items-center gap-1.5">
              <span>{skill.name}</span>
              {skill.tags.slice(0, 3).map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </span>
          }
          description={skill.description}
        />
      )}
    </div>
  );
}
