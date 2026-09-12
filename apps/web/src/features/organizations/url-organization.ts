// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { Organization } from "@agentco/shared";

/**
 * Whether the organization that resolved is the one the URL asked for.
 *
 * The provider deliberately falls back to a usable organization when the
 * remembered one no longer resolves. That is right on a cold start and wrong on
 * an organization-scoped page: rendering one tenant's data under another
 * tenant's address is a lie, not a fallback, and it is the kind of lie an
 * operator acts on.
 */
export function urlOrganizationMatches(
  current: Pick<Organization, "id" | "slug"> | null,
  urlRef: string | undefined,
): boolean {
  if (!urlRef) return true;
  if (!current) return false;
  return current.slug === urlRef || current.id === urlRef;
}
