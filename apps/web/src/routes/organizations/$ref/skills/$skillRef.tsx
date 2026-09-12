// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast, useConfirm } from "@/components/ui";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { readSkillDocument, type Skill } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Badge, Tag } from "@/components/ui/status";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { useDeleteSkill, useSkill, useUpdateSkill } from "@/features/skills/queries";
import { ApiError, firstIssue } from "@/lib/api";

export const Route = createFileRoute("/organizations/$ref/skills/$skillRef")({
  component: SkillPage,
});

/**
 * The document's header names the skill for agents; this names it for people.
 * Both exist because an agent matches on a slug while an operator scans a list,
 * and forcing one string to do both jobs makes it bad at one of them.
 */
function EditSkillDialog({ org, skill }: { org: string; skill: Skill }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description ?? "");
  const [error, setError] = useState<string>();
  const update = useUpdateSkill(org, skill.slug);

  useEffect(() => {
    if (!open) return;
    setName(skill.name);
    setDescription(skill.description ?? "");
    setError(undefined);
  }, [open, skill]);

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="md">
            <Pencil />
            Edit details
          </Button>
        }
      />
      <DialogPanel title="Edit skill" description="How this skill appears in the library.">
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError(undefined);
            try {
              await update.mutateAsync({
                name: name.trim(),
                description: description.trim() === "" ? null : description.trim(),
              });
              toast.success("Saved");
              setOpen(false);
            } catch (failure) {
              setError(firstIssue(failure) ?? "Could not save.");
            }
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <Field label="Name" error={error}>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Description"
              optional
              hint="Editing the document header overwrites this with what the header says."
            >
              {(props) => (
                <Input
                  {...props}
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!name.trim() || update.isPending}>
              {update.isPending ? <Spinner className="border-t-inverse" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}

function SkillPage() {
  const { ref: org, skillRef } = Route.useParams();
  const query = useSkill(org, skillRef);
  const update = useUpdateSkill(org, skillRef);
  const remove = useDeleteSkill(org);
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => setDraft(null), [query.data?.markdown]);

  if (query.isPending) {
    return (
      <Page>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-6 h-80 w-full" />
      </Page>
    );
  }

  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Page>
        <ErrorState
          title={missing ? "Skill not found" : "Can't load this skill"}
          description={
            missing
              ? "It may have been deleted, or the link is wrong."
              : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            <Link
              to="/organizations/$ref/skills"
              params={{ ref: org }}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Back to skills
            </Link>
          }
        />
      </Page>
    );
  }

  const skill = query.data;
  const markdown = draft ?? skill.markdown;
  const dirty = draft !== null && draft !== skill.markdown;

  // Parsed as you type, so a header mistake is visible before it is saved
  // rather than arriving as a rejection afterwards.
  const document = readSkillDocument(markdown);

  return (
    <Page>
      <PageHeader
        back={
          <Link
            to="/organizations/$ref/skills"
            params={{ ref: org }}
            className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3" />
            Skills
          </Link>
        }
        title={skill.name}
        meta={
          <>
            <Tag>{skill.slug}</Tag>
            {document.valid ? (
              <Badge tone="active">Header valid</Badge>
            ) : (
              <Badge tone="danger">Header invalid</Badge>
            )}
          </>
        }
        actions={
          <>
            <EditSkillDialog org={org} skill={skill} />
            <Button
            variant="secondary"
            size="icon"
            aria-label="Delete skill"
            onClick={() =>
              void confirm({
                title: `Delete ${skill.name}?`,
                description:
                  "Every agent that has this skill enabled loses it, and the document cannot be recovered.",
                confirmLabel: "Delete skill",
                tone: "danger",
                onConfirm: async () => {
                  try {
                    await remove.mutateAsync(skill.slug);
                    toast.success("Deleted");
                    await navigate({ to: "/organizations/$ref/skills", params: { ref: org } });
                  } catch (failure) {
                    toast.error(firstIssue(failure) ?? "Could not delete.");
                  }
                },
              })
            }
            >
              <Trash2 />
            </Button>
          </>
        }
      />

      {!document.valid ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs text-danger">
          {document.issues[0] ?? "The header between the --- lines needs a name and a description."}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
        <div className="border-b border-line px-3 py-2">
          <span className="machine text-2xs text-muted">SKILL.md</span>
        </div>

        <Textarea
          value={markdown}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          className="machine min-h-96 rounded-none border-0 text-xs leading-5 focus:border-0"
        />

        <div className="flex items-center justify-between gap-2 border-t border-line bg-sunken px-3 py-2">
          <span className="text-2xs text-faint">
            The header names the skill; the body is read only when it applies.
          </span>
          <div className="flex items-center gap-2">
            {error ? <span className="text-2xs text-danger">{error}</span> : null}
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || !document.valid || update.isPending}
              onClick={async () => {
                setError(undefined);
                try {
                  await update.mutateAsync({ markdown });
                  setDraft(null);
                  toast.success("Saved");
                } catch (failure) {
                  setError(firstIssue(failure) ?? "Could not save.");
                }
              }}
            >
              {update.isPending ? <Spinner className="border-t-inverse" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}
