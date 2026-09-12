// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Archive, ArrowLeft, MoreHorizontal, Pause, Play, RotateCcw, Users } from "lucide-react";
import type { Project, ProjectMember } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { List, ListRow } from "@/components/ui/list";
import { CheckboxField } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast, useConfirm } from "@/components/ui";
import { AdapterIcon } from "@/components/adapter-icon";
import { useAgents } from "@/features/agents/queries";
import { STATUS_LABEL, STATUS_TONE } from "@/features/agents/status";
import {
  useProject,
  useProjectMembers,
  useSetProjectArchived,
  useSetProjectMembers,
  useUpdateProject,
} from "@/features/projects/queries";
import { ApiError, firstIssue } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";

export const Route = createFileRoute("/organizations/$ref/projects/$projectRef")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { ref: org, projectRef } = Route.useParams();
  const query = useProject(org, projectRef);

  if (query.isPending) {
    return (
      <Page>
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-2 h-3 w-72" />
        <Skeleton className="mt-6 h-48 w-full" />
      </Page>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Page>
        <ErrorState
          title={missing ? "Project not found" : "Can't load this project"}
          description={
            missing
              ? "It may have been renamed, or the link is wrong."
              : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            missing ? (
              <Link
                to="/organizations/$ref/projects"
                params={{ ref: org }}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Back to projects
              </Link>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Try again
              </Button>
            )
          }
        />
      </Page>
    );
  }

  const project = query.data;
  const archived = project.status === "archived";

  return (
    <Page>
      <PageHeader
        back={
          <Link
            to="/organizations/$ref/projects"
            params={{ ref: org }}
            className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3" />
            Projects
          </Link>
        }
        title={project.name}
        meta={
          <>
            <Tag>{project.taskPrefix}</Tag>
            {project.status === "active" ? <Badge tone="active">Active</Badge> : null}
            {project.status === "paused" ? <Badge tone="attention">Paused</Badge> : null}
            {archived ? <Badge tone="idle">Archived</Badge> : null}
            <span className="machine text-faint" title={fullDate(project.createdAt)}>
              created {timeAgo(project.createdAt)}
            </span>
          </>
        }
        actions={<ProjectActions org={org} project={project} />}
      />

      {archived ? (
        <Callout
          tone="attention"
          className="mb-4"
          action={<RestoreButton org={org} project={project} />}
        >
          This project is archived. Restore it to make changes.
        </Callout>
      ) : null}

      {project.status === "paused" ? (
        <Callout tone="attention" className="mb-4">
          This project is paused. Nothing new starts here until it is resumed.
        </Callout>
      ) : null}

      <div className="flex flex-col gap-4">
        <Team org={org} project={project} />
        <Details org={org} project={project} />
      </div>
    </Page>
  );
}

function RestoreButton({ org, project }: { org: string; project: Project }) {
  const setArchived = useSetProjectArchived(org, project.slug);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={setArchived.isPending}
      onClick={async () => {
        try {
          await setArchived.mutateAsync(false);
          toast.success("Restored");
        } catch (failure) {
          toast.error(firstIssue(failure) ?? "Could not restore the project.");
        }
      }}
    >
      <RotateCcw />
      Restore
    </Button>
  );
}

function ProjectActions({ org, project }: { org: string; project: Project }) {
  const update = useUpdateProject(org, project.slug);
  const setArchived = useSetProjectArchived(org, project.slug);
  const confirm = useConfirm();
  const archived = project.status === "archived";

  async function setStatus(status: "active" | "paused") {
    try {
      await update.mutateAsync({ status });
      toast.success(status === "paused" ? "Paused" : "Resumed");
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "That didn't work.");
    }
  }

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button variant="secondary" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        }
      />
      <MenuContent>
        {!archived && project.status === "active" ? (
          <MenuItem onClick={() => void setStatus("paused")}>
            <Pause className="size-3.5" />
            Pause project
          </MenuItem>
        ) : null}
        {!archived && project.status === "paused" ? (
          <MenuItem onClick={() => void setStatus("active")}>
            <Play className="size-3.5" />
            Resume project
          </MenuItem>
        ) : null}

        <MenuItem
          {...(archived ? {} : { tone: "danger" as const })}
          onClick={() => {
            // Restoring only ever adds capability; archiving takes the whole
            // project out of use, so it says so and waits for a second click.
            if (archived) {
              void setArchived.mutateAsync(false).then(
                () => toast.success("Restored"),
                (failure: unknown) => toast.error(firstIssue(failure) ?? "Could not restore."),
              );
              return;
            }
            void confirm({
              title: `Archive ${project.name}?`,
              description:
                "Nothing new can be created or changed here. Everything it holds is kept, and restoring puts it all back.",
              confirmLabel: "Archive project",
              tone: "danger",
              onConfirm: async () => {
                try {
                  await setArchived.mutateAsync(true);
                  toast.success("Archived");
                } catch (failure) {
                  toast.error(firstIssue(failure) ?? "Could not archive the project.");
                }
              },
            });
          }}
        >
          {archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
          {archived ? "Restore project" : "Archive project"}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

/**
 * Who may be given work here.
 *
 * Membership grants nothing on its own, so the card says what it is for rather
 * than leaving an empty list to imply something is broken.
 */
function Team({ org, project }: { org: string; project: Project }) {
  const members = useProjectMembers(org, project.slug);
  const archived = project.status === "archived";
  const list = members.data ?? [];

  return (
    <Card
      title="Team"
      actions={archived ? undefined : <EditTeamDialog org={org} project={project} members={list} />}
    >
      {members.isPending ? <Skeleton className="h-16 w-full" /> : null}

      {members.isSuccess && list.length === 0 ? (
        <p className="text-xs text-muted">
          No agents yet. Adding one means it may be given work here — it does not start anything.
        </p>
      ) : null}

      {list.length > 0 ? (
        <List>
          {list.map((member) => (
            <ListRow key={member.agentId}>
              <StatusDot
                tone={STATUS_TONE[member.status as keyof typeof STATUS_TONE] ?? "idle"}
                className="mt-[0.4375rem] self-start"
              />
              <AdapterIcon type={member.adapterType} className="mt-0.5 size-4 self-start" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/organizations/$ref/agents/$agentRef"
                    params={{ ref: org, agentRef: member.slug }}
                    className="truncate text-xs font-medium text-ink hover:underline"
                  >
                    {member.name}
                  </Link>
                  {member.role === "lead" ? <Badge tone="active">Lead</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-2xs text-muted">
                  {member.title ?? STATUS_LABEL[member.status as keyof typeof STATUS_LABEL] ?? member.status}
                </p>
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}
    </Card>
  );
}

function EditTeamDialog({
  org,
  project,
  members,
}: {
  org: string;
  project: Project;
  members: ProjectMember[];
}) {
  const [open, setOpen] = useState(false);
  const roster = useAgents(org);
  const save = useSetProjectMembers(org, project.slug);
  const [selected, setSelected] = useState<string[]>([]);
  const [lead, setLead] = useState("");
  const [error, setError] = useState<string>();

  // Re-sync on open so it never shows a stale copy of something somebody else
  // just changed.
  useEffect(() => {
    if (!open) return;
    setSelected(members.map((member) => member.agentId));
    setLead(members.find((member) => member.role === "lead")?.agentId ?? "");
    setError(undefined);
  }, [open, members]);

  const candidates = roster.data ?? [];

  function toggle(agentId: string, on: boolean) {
    setSelected((current) =>
      on ? [...current, agentId] : current.filter((id) => id !== agentId),
    );
    // A lead who is no longer on the team is not a lead.
    if (!on && lead === agentId) setLead("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await save.mutateAsync({
        members: selected.map((agentId) => ({
          agentId,
          role: agentId === lead ? ("lead" as const) : ("member" as const),
        })),
      });
      toast.success("Saved");
      setOpen(false);
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not save the team.");
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            <Users />
            Edit team
          </Button>
        }
      />
      <DialogPanel
        title="Project team"
        description="Which agents may be given work here. Being on the team does not start anything."
        className="max-w-120"
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {candidates.length === 0 ? (
              <p className="text-xs text-muted">
                This organization has no agents yet. Hire one first.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {candidates.map((agent) => (
                  <CheckboxField
                    key={agent.id}
                    checked={selected.includes(agent.id)}
                    onChange={(event) => toggle(agent.id, event.target.checked)}
                    label={agent.name}
                    description={agent.title ?? agent.capabilities ?? undefined}
                  />
                ))}
              </div>
            )}

            {selected.length > 0 ? (
              <Field
                label="Lead"
                optional
                hint="Where a question about the project as a whole goes."
                error={error}
              >
                {(props) => (
                  <Select
                    {...props}
                    value={lead}
                    onChange={(event) => setLead(event.target.value)}
                    options={[
                      { value: "", label: "No lead" },
                      ...candidates
                        .filter((agent) => selected.includes(agent.id))
                        .map((agent) => ({ value: agent.id, label: agent.name })),
                    ]}
                  />
                )}
              </Field>
            ) : null}

            {selected.length === 0 && error ? (
              <p className="text-xs text-danger">{error}</p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner className="border-t-inverse" /> : null}
              Save team
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}

/**
 * The brief is the one field agents actually read, so it gets the room a
 * paragraph needs rather than a single-line input.
 */
function Details({ org, project }: { org: string; project: Project }) {
  const update = useUpdateProject(org, project.slug);
  const disabled = project.status === "archived";

  const [name, setName] = useState(project.name);
  const [summary, setSummary] = useState(project.summary ?? "");
  const [brief, setBrief] = useState(project.brief ?? "");
  const [error, setError] = useState<string>();

  useEffect(() => {
    setName(project.name);
    setSummary(project.summary ?? "");
    setBrief(project.brief ?? "");
  }, [project.name, project.summary, project.brief]);

  const dirty =
    name !== project.name ||
    summary !== (project.summary ?? "") ||
    brief !== (project.brief ?? "");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await update.mutateAsync({
        name: name.trim(),
        summary: summary.trim() === "" ? null : summary.trim(),
        brief: brief.trim() === "" ? null : brief.trim(),
      });
      toast.success("Saved");
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not save changes.");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface"
    >
      <h2 className="border-b border-line px-4 py-2 text-2xs font-medium text-faint">Details</h2>

      <div className="flex flex-col gap-4 px-4 py-4">
        <Field label="Name" error={error}>
          {(props) => (
            <Input
              {...props}
              value={name}
              disabled={disabled}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className="max-w-120"
            />
          )}
        </Field>

        <Field label="Summary" optional hint="One line, shown in the list.">
          {(props) => (
            <Textarea
              {...props}
              value={summary}
              disabled={disabled}
              maxLength={500}
              rows={2}
              onChange={(event) => setSummary(event.target.value)}
              className="max-w-120"
            />
          )}
        </Field>

        <Field
          label="Brief"
          optional
          hint="What this project is, who it is for, and what good looks like. The agents read this."
        >
          {(props) => (
            <Textarea
              {...props}
              value={brief}
              disabled={disabled}
              maxLength={20_000}
              rows={8}
              onChange={(event) => setBrief(event.target.value)}
            />
          )}
        </Field>

        <Field label="Task keys" hint="Fixed when the project was created.">
          {(props) => (
            <Input
              {...props}
              value={`${project.taskPrefix}-1, ${project.taskPrefix}-2, …`}
              readOnly
              className="machine max-w-120 text-muted"
            />
          )}
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-4 py-2.5">
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={disabled || !dirty || !name.trim() || update.isPending}
        >
          {update.isPending ? <Spinner className="border-t-inverse" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
