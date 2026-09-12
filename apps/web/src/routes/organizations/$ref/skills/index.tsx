// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { List, ListRow } from "@/components/ui/list";
import { Tag } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCreateSkill, useSkills } from "@/features/skills/queries";
import { firstIssue } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/organizations/$ref/skills/")({
  component: SkillsPage,
});

/**
 * The organization's skill library.
 *
 * A skill is written once here and enabled per agent. Bodies are never put in a
 * prompt — they are mounted as files and read when the agent decides the skill
 * applies — so a library can grow without every agent paying for it.
 */
function SkillsPage() {
  const { ref: org } = Route.useParams();
  const skills = useSkills(org);

  return (
    <Page>
      <PageHeader
        title="Skills"
        meta={<span>Written once, enabled per agent</span>}
        actions={<NewSkillDialog org={org} />}
      />

      {skills.isPending ? (
        <List>
          {[0, 1].map((row) => (
            <ListRow key={row}>
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </ListRow>
          ))}
        </List>
      ) : null}

      {skills.isError ? (
        <List>
          <ErrorState
            title="Can't load skills"
            description="The API didn't answer. Check that it's running, then try again."
            action={
              <Button variant="secondary" size="sm" onClick={() => skills.refetch()}>
                Try again
              </Button>
            }
          />
        </List>
      ) : null}

      {skills.isSuccess && skills.data.length === 0 ? (
        <List>
          <EmptyState
            title="No skills yet"
            description="A skill is a short document an agent reads when it applies — a checklist, a house style, a procedure."
            action={<NewSkillDialog org={org} />}
          />
        </List>
      ) : null}

      {skills.data && skills.data.length > 0 ? (
        <List>
          {skills.data.map((skill) => (
            <Link
              key={skill.id}
              to="/organizations/$ref/skills/$skillRef"
              params={{ ref: org, skillRef: skill.slug }}
              className="block"
            >
              <ListRow interactive>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{skill.name}</span>
                    <Tag>{skill.slug}</Tag>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {skill.description ?? "No description"}
                  </p>
                </div>
                <span className="machine hidden shrink-0 self-start pt-0.5 text-2xs text-faint sm:block">
                  {timeAgo(skill.updatedAt)}
                </span>
              </ListRow>
            </Link>
          ))}
        </List>
      ) : null}
    </Page>
  );
}

function NewSkillDialog({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const create = useCreateSkill(org);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const skill = await create.mutateAsync({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      toast.success(`Created ${skill.name}`);
      setOpen(false);
      setName("");
      setDescription("");
      await navigate({
        to: "/organizations/$ref/skills/$skillRef",
        params: { ref: org, skillRef: skill.slug },
      });
    } catch (failure) {
      setError(firstIssue(failure) ?? "Could not create the skill.");
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="primary" size="md">
            <Plus />
            New skill
          </Button>
        }
      />
      <DialogPanel
        title="New skill"
        description="Starts from a template you can edit. Every agent here can be given it."
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={120}
                  autoFocus
                  placeholder="Task planning"
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Description"
              optional
              hint="One line. This is what an agent reads before deciding to open the skill."
            >
              {(props) => (
                <Input
                  {...props}
                  value={description}
                  maxLength={500}
                  placeholder="Turn a request into a plan with owners and acceptance criteria."
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Spinner className="border-t-inverse" /> : null}
              Create skill
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
