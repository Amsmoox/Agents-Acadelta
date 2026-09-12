// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Spinner } from "./feedback";
import { DialogBody, DialogFooter, DialogPanel, DialogRoot } from "./dialog";

/**
 * Confirmation, as part of the interface rather than the browser's.
 *
 * `window.confirm` cannot be styled, cannot be read by a screen reader as part
 * of this page, blocks the whole tab while it is open, is suppressible by the
 * browser, and looks like a phishing prompt. It is also unusable in a test that
 * drives the real UI.
 *
 * The awaitable shape is deliberate: replacing a native confirm is then a
 * one-line change at the call site, which is the only reason those calls tend
 * to survive as long as they do.
 *
 *   if (await confirm({ title: "Delete this?", tone: "danger" })) { ... }
 */

export type ConfirmOptions = {
  title: string;
  /** What will happen. Say the consequence, not "are you sure". */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** Shown while the confirmed action runs, if it is awaited here. */
  onConfirm?: () => Promise<unknown>;
};

type Pending = ConfirmOptions & { resolve: (confirmed: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    pendingRef.current = null;
    setPending(null);
    setBusy(false);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <DialogRoot
        open={pending !== null}
        onOpenChange={(open) => {
          // Dismissing by escape or backdrop is a decision too: it means no.
          if (!open && !busy) settle(false);
        }}
      >
        {pending ? (
          <DialogPanel title={pending.title}>
            {pending.description ? (
              <DialogBody>
                <p className="text-xs leading-5 text-muted">{pending.description}</p>
              </DialogBody>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" size="md" disabled={busy} onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={pending.tone === "danger" ? "danger" : "primary"}
                size="md"
                disabled={busy}
                autoFocus
                onClick={async () => {
                  if (!pending.onConfirm) {
                    settle(true);
                    return;
                  }
                  // Awaiting here keeps the dialog up while the work runs, so a
                  // slow delete cannot be fired twice.
                  setBusy(true);
                  try {
                    await pending.onConfirm();
                  } finally {
                    settle(true);
                  }
                }}
              >
                {busy ? <Spinner className="border-t-inverse" /> : null}
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        ) : null}
      </DialogRoot>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}
