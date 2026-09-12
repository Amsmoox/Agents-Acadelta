// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { deriveTaskPrefix, slugify, type Project, type ProjectStatus } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Badge, StatusDot, Tag } from "@/components/ui/status";
import { EmptyState, ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui";
import { useCurrentOrganization } from "@/features/organizations/current-organization";
import { useCreateProject, useProjects } from "@/features/projects/queries";
import { firstIssue } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/organizations/$ref/projects/")({
  component: ProjectsPage,
});

type Filter = "all" | ProjectStatus;

function ProjectsPage() {
  const { ref: org } = Route.useParams();
  const { current } = useCurrentOrganization();
  const archivedOrg = current?.status === "archived";
  const [filter, setFilter] = useState<Filter>("all");
  const query = useProjects(org);

  const all = query.data ?? [];
  const counts = {
    all: all.length,
    active: all.filter((p) => p.status === "active").length,
    paused: all.filter((p) => p.status === "paused").length,
    archived: all.filter((p) => p.status === "archived").length,
  };
  const shown = filter === "all" ? all : all.filter((p) => p.status === filter);

  return (
    <Page>
      <PageHeader
        title="Projects"
        meta={<span>What the agents are working on</span>}
        actions={
          archivedOrg ? (
            <Button variant="primary" size="md" disabled>
              <Plus className="size-4" />
              New project
            </Button>
          ) : (
            <NewProjectDialog org={org} />
          )
        }
      />

      {archivedOrg ? (
        <Callout tone="attention" className="mb-4">
          This organization is archived. Its projects can be read, but not created or changed.
        </Callout>
      ) : null}

      {counts.all > 0 ? (
        <div className="pb-3">
          <Segmented
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all" as Filter, label: "All", count: counts.all },
              { value: "active" as Filter, label: "Active", count: counts.active },
              ...(counts.paused > 0
                ? [{ value: "paused" as Filter, label: "Paused", count: counts.paused }]
                : []),
              ...(counts.archived > 0
                ? [{ value: "archived" as Filter, label: "Archived", count: counts.archived }]
                : []),
            ]}
          />
        </div>
      ) : null}

      {query.isPending ? <LoadingRows /> : null}

      {query.isError ? (
        <List>
          <ErrorState
            title="Can't load projects"
            description="The API didn't answer. Check that it's running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Try again
              </Button>
            }
          />
        </List>
      ) : null}

      {query.isSuccess && counts.all === 0 ? (
        <List>
          <EmptyState
            title="No projects yet"
            description="A project holds a body of work and says which agents may be given it. Create one to start."
            action={archivedOrg ? undefined : <NewProjectDialog org={org} />}
          />
        </List>
      ) : null}

      {query.isSuccess && counts.all > 0 && shown.length === 0 ? (
        <List>
          <EmptyState title={`No ${filter} projects`} description="Nothing matches this filter." />
        </List>
      ) : null}

      {shown.length > 0 ? (
        <List>
          {shown.map((project) => (
            <ProjectRow key={project.id} org={org} project={project} />
          ))}
        </List>
      ) : null}
    </Page>
  );
}

const TONE = { active: "active", paused: "attention", archived: "idle" } as const;

function ProjectRow({ org, project }: { org: string; project: Project }) {
  return (
    <Link
      to="/organizations/$ref/projects/$projectRef"
      params={{ ref: org, projectRef: project.slug }}
      className="block"
    >
      <ListRow interactive>
        <StatusDot tone={TONE[project.status]} className="mt-[0.4375rem] self-start" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{project.name}</span>
            {/* The prefix is what every task key in here will carry, so it is
                the one piece of machine detail worth showing in a list. */}
            <Tag>{project.taskPrefix}</Tag>
            {project.status !== "active" ? (
              <Badge tone={TONE[project.status]}>
                {project.status === "paused" ? "Paused" : "Archived"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {project.summary ?? "No summary yet."}
          </p>
        </div>

        <div className="hidden shrink-0 self-start pt-0.5 text-right sm:block">
          <p className="text-2xs text-muted">
            {project.memberCount === 0
              ? "No agents"
              : `${project.memberCount} agent${project.memberCount === 1 ? "" : "s"}`}
          </p>
          <p className="machine text-2xs text-faint">{timeAgo(project.createdAt)}</p>
        </div>
      </ListRow>
    </Link>
  );
}

/**
 * Creating a project fixes two things permanently: the slug in its URL and the
 * prefix on every task key it will ever hold. Both are suggested from the name
 * and both stay editable here, because here is the only place they can change.
 */
function NewProjectDialog({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string>();
  const create = useCreateProject(org);
  const navigate = useNavigate();

  const suggestedPrefix = deriveTaskPrefix(name);
  const effectivePrefix = prefixTouched ? prefix : suggestedPrefix;
  const slug = slugify(name);

  function reset() {
    setName("");
    setPrefix("");
    setPrefixTouched(false);
    setSummary("");
    setError(undefined);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const project = await create.mutateAsync({
        name: name.trim(),
        ...(effectivePrefix ? { taskPrefix: effectivePrefix } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      toast.success("Created");
      setOpen(false);
      reset();
      await navigate({
        to: "/organizations/$ref/projects/$projectRef",
        params: { ref: org, projectRef: project.slug },
      });
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not create the project.");
    }
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="primary" size="md">
            <Plus className="size-4" />
            New project
          </Button>
        }
      />
      <DialogPanel
        title="New project"
        description="A body of work, and the agents allowed to be given it."
        className="max-w-120"
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={120}
                  placeholder="Checkout Rewrite"
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              )}
            </Field>

            <Field
              label="Task prefix"
              hint="Every task here is numbered from it, and it cannot change afterwards."
            >
              {(props) => (
                <Input
                  {...props}
                  value={effectivePrefix}
                  maxLength={6}
                  placeholder="CR"
                  onChange={(event) => {
                    setPrefixTouched(true);
                    setPrefix(event.target.value.toUpperCase());
                  }}
                  className="machine max-w-28"
                />
              )}
            </Field>

            {/* Shown rather than explained: the first task is easier to picture
                than a rule about prefixes. */}
            {effectivePrefix ? (
              <p className="-mt-2 text-2xs text-faint">
                The first task will be{" "}
                <span className="machine text-muted">{effectivePrefix}-1</span>, at{" "}
                <span className="machine text-muted">/{slug || "…"}</span>
              </p>
            ) : null}

            <Field label="Summary" optional hint="One line, for the list.">
              {(props) => (
                <Textarea
                  {...props}
                  value={summary}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => setSummary(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={!name.trim() || !effectivePrefix || create.isPending}
            >
              {create.isPending ? <Spinner className="border-t-inverse" /> : <FolderPlus />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}

function LoadingRows() {
  return (
    <List>
      {[0, 1, 2].map((row) => (
        <ListRow key={row}>
          <Skeleton className="size-1.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-3 w-16" />
        </ListRow>
      ))}
    </List>
  );
}
