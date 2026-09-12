// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Trash2 } from "lucide-react";
import { readSkillDocument } from "@agentco/shared";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge, Tag } from "@/components/ui/status";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { useDeleteSkill, useSkill, useUpdateSkill } from "@/features/skills/queries";
import { ApiError, firstIssue } from "@/lib/api";

export const Route = createFileRoute("/organizations/$ref/skills/$skillRef")({
  component: SkillPage,
});

function SkillPage() {
  const { ref: org, skillRef } = Route.useParams();
  const query = useSkill(org, skillRef);
  const update = useUpdateSkill(org, skillRef);
  const remove = useDeleteSkill(org);
  const navigate = useNavigate();

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
          <Button
            variant="secondary"
            size="icon"
            aria-label="Delete skill"
            onClick={async () => {
              if (!window.confirm(`Delete ${skill.name}? Agents using it will lose it.`)) return;
              try {
                await remove.mutateAsync(skill.slug);
                toast.success("Deleted");
                await navigate({ to: "/organizations/$ref/skills", params: { ref: org } });
              } catch (failure) {
                toast.error(firstIssue(failure) ?? "Could not delete.");
              }
            }}
          >
            <Trash2 />
          </Button>
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
