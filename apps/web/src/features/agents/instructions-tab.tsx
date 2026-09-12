// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Trash2 } from "lucide-react";
import { INSTRUCTIONS_ENTRY_FILE } from "@agentco/shared";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Skeleton, Spinner } from "@/components/ui/feedback";
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogPanel,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useDeleteInstructionFile,
  useInstructions,
  useWriteInstructionFile,
} from "@/features/skills/queries";
import { firstIssue } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * An agent's identity, as files.
 *
 * A bundle rather than one box, because a role is not one paragraph: AGENTS.md
 * is what a run loads, and it refers to siblings like HEARTBEAT.md or SOUL.md.
 * That is how people actually write a job description.
 */
export function InstructionsTab({ org, agent }: { org: string; agent: string }) {
  const files = useInstructions(org, agent);
  const write = useWriteInstructionFile(org, agent);
  const remove = useDeleteInstructionFile(org, agent);

  const [selected, setSelected] = useState(INSTRUCTIONS_ENTRY_FILE);
  const [draft, setDraft] = useState<string | null>(null);

  const current = files.data?.find((file) => file.path === selected) ?? files.data?.[0];
  const content = draft ?? current?.content ?? "";
  const dirty = draft !== null && draft !== current?.content;

  // Switching files discards nothing, because an edit is saved before the
  // selection can change; resetting here keeps the editor honest about which
  // file it is showing.
  useEffect(() => setDraft(null), [selected]);

  if (files.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  async function save() {
    if (!current) return;
    try {
      await write.mutateAsync({ path: current.path, content });
      setDraft(null);
      toast.success("Saved");
    } catch (failure) {
      toast.error(firstIssue(failure) ?? "Could not save.");
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[190px_1fr]">
      <aside className="flex flex-col gap-1">
        {(files.data ?? []).map((file) => (
          <button
            key={file.path}
            type="button"
            onClick={() => setSelected(file.path)}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left",
              "text-xs transition-colors duration-75",
              file.path === current?.path
                ? "bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.05)]"
                : "text-muted hover:bg-sunken hover:text-ink",
            )}
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="machine truncate">{file.path}</span>
          </button>
        ))}
        <NewFileDialog org={org} agent={agent} onCreated={setSelected} />
      </aside>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="machine text-2xs text-muted">{current?.path}</span>
          {current && current.path !== INSTRUCTIONS_ENTRY_FILE ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${current.path}`}
              onClick={async () => {
                if (!window.confirm(`Delete ${current.path}?`)) return;
                try {
                  await remove.mutateAsync(current.path);
                  setSelected(INSTRUCTIONS_ENTRY_FILE);
                  toast.success("Deleted");
                } catch (failure) {
                  toast.error(firstIssue(failure) ?? "Could not delete.");
                }
              }}
            >
              <Trash2 />
            </Button>
          ) : (
            // Stated, not hidden: the rule is easier to accept when visible.
            <span className="text-2xs text-faint">Entry file, always loaded</span>
          )}
        </div>

        <Textarea
          value={content}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          className="machine min-h-80 rounded-none border-0 text-xs leading-5 focus:border-0"
        />

        <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-3 py-2">
          <Button variant="primary" size="sm" disabled={!dirty || write.isPending} onClick={save}>
            {write.isPending ? <Spinner className="border-t-inverse" /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewFileDialog({
  org,
  agent,
  onCreated,
}: {
  org: string;
  agent: string;
  onCreated: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const write = useWriteInstructionFile(org, agent);

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="justify-start">
            <Plus />
            New file
          </Button>
        }
      />
      <DialogPanel
        title="New instruction file"
        description="Referenced from AGENTS.md, and loaded alongside it."
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError(undefined);
            try {
              await write.mutateAsync({ path: path.trim(), content: `# ${path.trim()}\n` });
              onCreated(path.trim());
              setOpen(false);
              setPath("");
            } catch (failure) {
              setError(firstIssue(failure) ?? "Could not create the file.");
            }
          }}
        >
          <DialogBody>
            <Field label="File name" error={error} hint="Markdown only, inside the bundle.">
              {(props) => (
                <Input
                  {...props}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="HEARTBEAT.md"
                  className="machine"
                  autoFocus
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="md" type="button">Cancel</Button>} />
            <Button variant="primary" size="md" type="submit" disabled={!path.trim()}>
              Create file
            </Button>
          </DialogFooter>
        </form>
      </DialogPanel>
    </DialogRoot>
  );
}
