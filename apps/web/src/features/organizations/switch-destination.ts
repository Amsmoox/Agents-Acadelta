// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * Where switching organization should land you.
 *
 * The rule is: keep the section, drop the resource.
 *
 * Keeping the section is what makes the switcher feel like a switch rather than
 * a redirect — you were looking at agents, you want to look at the other
 * organization's agents. Dropping the resource is not optional: an agent id or
 * slug means nothing in another tenant, so carrying it across produces a
 * confident 404 on a page the operator did not ask for.
 */

const ORG_PREFIX = "/organizations/";

export function destinationAfterSwitch(pathname: string, slug: string): string {
  if (!pathname.startsWith(ORG_PREFIX)) return `${ORG_PREFIX}${slug}`;

  const rest = pathname.slice(ORG_PREFIX.length).split("/").filter(Boolean);
  // rest[0] is the organization being left; everything after it is the section.
  const section = rest.slice(1);
  if (section.length === 0) return `${ORG_PREFIX}${slug}`;

  const [head, tail] = section;

  // A creation screen holds no resource, so it survives the switch intact.
  if (head === "agents" && tail === "new") return `${ORG_PREFIX}${slug}/agents/new`;

  // Anything deeper names a specific record; land on that section's index.
  return `${ORG_PREFIX}${slug}/${head}`;
}
