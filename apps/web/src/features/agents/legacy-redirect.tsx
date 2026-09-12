// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Page } from "@/components/ui/page";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { useCurrentOrganization } from "@/features/organizations/current-organization";

/**
 * Agents used to live at /agents, with the organization hidden in local storage.
 * Bookmarks and shared links from that era still exist, so they are forwarded to
 * the organization-scoped address rather than 404ing.
 *
 * The deep links are the ones worth rescuing — /agents/ada and /agents/new are
 * exactly what someone would have saved — so a splat sibling catches those too.
 * The record itself is dropped: an agent slug means nothing until an
 * organization is known, and guessing would be worse than landing on the roster.
 */
export function LegacyAgentsRedirect() {
  const { current, isPending } = useCurrentOrganization();
  const navigate = useNavigate();
  const slug = current?.slug;

  useEffect(() => {
    if (slug) {
      void navigate({
        to: "/organizations/$ref/agents",
        params: { ref: slug },
        replace: true,
      });
    }
  }, [slug, navigate]);

  if (isPending || slug) {
    return (
      <Page>
        <div className="flex items-center gap-2 py-16 text-xs text-muted">
          <Spinner />
          Taking you to your agents…
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <EmptyState
        title="Choose an organization"
        description="Agents belong to an organization. Pick one and its agents will be here."
        action={
          <Link to="/organizations" className={buttonVariants({ variant: "primary", size: "sm" })}>
            Go to organizations
          </Link>
        }
      />
    </Page>
  );
}
