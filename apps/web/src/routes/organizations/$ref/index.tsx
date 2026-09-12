// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Archive, ArrowLeft, MoreHorizontal, RotateCcw } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge, Tag } from "@/components/ui/status";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { fullDate, timeAgo } from "@/lib/format";
import { ApiError, firstIssue } from "@/lib/api";
import {
  useOrganization,
  useSetArchived,
  useUpdateOrganization,
} from "@/features/organizations/queries";

export const Route = createFileRoute("/organizations/$ref/")({
  component: OrganizationDetailPage,
});

function OrganizationDetailPage() {
  const { ref } = Route.useParams();
  const query = useOrganization(ref);

  if (query.isPending) {
    return (
      <Page>
        <div className="space-y-3">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-3 w-72" />
          <Skeleton className="mt-6 h-48 w-full" />
        </div>
      </Page>
    );
  }

  if (query.isError) {
    // A missing organization and an unreachable API are different problems and
    // need different instructions; saying "not found" for both sends the
    // operator looking for a mistake they did not make.
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Page>
        <ErrorState
          title={missing ? "Organization not found" : "Can't load this organization"}
          description={
            missing
              ? "It may have been archived by someone else, or the link is wrong."
              : "The API didn't answer. Check that it's running, then try again."
          }
          action={
            missing ? (
              <Link
                to="/organizations"
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                Back to organizations
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

  const organization = query.data;
  const archived = organization.status === "archived";

  return (
    <Page>
      <PageHeader
        back={
          <Link
            to="/organizations"
            className="inline-flex items-center gap-1 text-2xs text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3" />
            Organizations
          </Link>
        }
        title={organization.name}
        meta={
          <>
            <Tag>{organization.slug}</Tag>
            {archived ? <Badge tone="idle">Archived</Badge> : <Badge tone="active">Active</Badge>}
            <span className="machine text-faint" title={fullDate(organization.createdAt)}>
              created {timeAgo(organization.createdAt)}
            </span>
          </>
        }
        actions={<RowActions ref_={ref} archived={archived} />}
      />

      {archived ? <ArchivedBanner ref_={ref} /> : null}

      <DetailsForm ref_={ref} name={organization.name} mission={organization.mission} disabled={archived} />
    </Page>
  );
}

function ArchivedBanner({ ref_ }: { ref_: string }) {
  const setArchived = useSetArchived(ref_);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-sunken px-3 py-2.5">
      <p className="text-xs text-muted">This organization is archived. Restore it to make changes.</p>
      <Button
        variant="secondary"
        size="sm"
        disabled={setArchived.isPending}
        onClick={async () => {
          try {
            await setArchived.mutateAsync(false);
            toast.success("Restored");
          } catch (failure) {
            toast.error(firstIssue(failure) ?? "Could not restore the organization.");
          }
        }}
      >
        <RotateCcw />
        Restore
      </Button>
    </div>
  );
}

function RowActions({ ref_, archived }: { ref_: string; archived: boolean }) {
  const setArchived = useSetArchived(ref_);

  async function toggle() {
    try {
      await setArchived.mutateAsync(!archived);
      toast.success(archived ? "Restored" : "Archived");
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "Could not update the organization.");
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
        <MenuItem onClick={toggle}>
          {archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
          {archived ? "Restore organization" : "Archive organization"}
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

function DetailsForm({
  ref_,
  name: initialName,
  mission: initialMission,
  disabled,
}: {
  ref_: string;
  name: string;
  mission: string | null;
  disabled: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [mission, setMission] = useState(initialMission ?? "");
  const [error, setError] = useState<string>();
  const update = useUpdateOrganization(ref_);

  // Re-sync when the server sends a newer copy (another tab, another operator).
  useEffect(() => {
    setName(initialName);
    setMission(initialMission ?? "");
  }, [initialName, initialMission]);

  const dirty = name !== initialName || mission !== (initialMission ?? "");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await update.mutateAsync({
        name: name.trim(),
        mission: mission.trim() === "" ? null : mission.trim(),
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

        <Field label="Mission" optional hint="What this organization exists to do.">
          {(props) => (
            <Textarea
              {...props}
              value={mission}
              disabled={disabled}
              maxLength={2000}
              rows={3}
              onChange={(event) => setMission(event.target.value)}
              placeholder="Not set."
              className="max-w-120"
            />
          )}
        </Field>

        <Field label="URL" hint="The slug can't change once the organization exists.">
          {(props) => (
            <Input
              {...props}
              value={`/organizations/${ref_}`}
              readOnly
              onFocus={(event) => event.target.select()}
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
