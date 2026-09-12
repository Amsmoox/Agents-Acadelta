// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { slugify } from "@agentco/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError, firstIssue } from "@/lib/api";
import { useCreateOrganization } from "./queries";

export function CreateOrganizationDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [error, setError] = useState<string>();
  const create = useCreateOrganization();
  const navigate = useNavigate();

  // Shown so the person sees the URL they are about to get, before they commit.
  const preview = slugify(name);

  function reset() {
    setName("");
    setMission("");
    setError(undefined);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const organization = await create.mutateAsync({
        name: name.trim(),
        ...(mission.trim() ? { mission: mission.trim() } : {}),
      });
      toast.success(`Created ${organization.name}`);
      setOpen(false);
      reset();
      await navigate({ to: "/organizations/$ref", params: { ref: organization.slug } });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.code === "AGC-2004"
          ? "That name has no letters or digits to build a URL from."
          : (firstIssue(failure) ?? "Could not create the organization."),
      );
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
            <Plus />
            New organization
          </Button>
        }
      />
      <DialogPanel
        title="New organization"
        description="An organization owns its projects, agents and budget."
      >
        <form onSubmit={onSubmit}>
          <DialogBody className="flex flex-col gap-4">
            <Field
              label="Name"
              error={error}
              hint={preview ? undefined : "Used to build the URL."}
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acadelta"
                  maxLength={120}
                  autoFocus
                />
              )}
            </Field>

            {preview ? (
              <p className="-mt-2.5 text-2xs text-faint">
                URL <span className="machine text-muted">/organizations/{preview}</span>
              </p>
            ) : null}

            <Field label="Mission" optional hint="What this organization exists to do.">
              {(props) => (
                <Textarea
                  {...props}
                  value={mission}
                  onChange={(event) => setMission(event.target.value)}
                  placeholder="Get the school platform to 10 paying schools."
                  maxLength={2000}
                  rows={3}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Spinner className="border-t-inverse" /> : null}
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
