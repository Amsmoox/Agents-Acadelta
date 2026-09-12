// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AgentStatus } from "./agents.js";
import { NON_INVOKABLE_STATUSES } from "./agents.js";

/**
 * A reporting chain can be broken without the agent itself being broken: its
 * manager may have been terminated, or an import may have produced a cycle.
 *
 * Rejecting those agents outright would be wrong — the agent is fine, its
 * escalation path is not. So the chain is reported as *health*, and eligibility
 * is `status × health` rather than status alone.
 */

export type OrgChainNode = {
  id: string;
  name: string;
  status: AgentStatus;
  reportsTo: string | null;
};

export type OrgChainHealth =
  | { status: "healthy"; escalationWarning?: string }
  | { status: "cycle"; path: string[]; repairGuidance: string }
  | { status: "missing_manager"; managerId: string; repairGuidance: string }
  | {
      status: "terminated_ancestor";
      agentId: string;
      agentName: string;
      repairGuidance: string;
    };

/** Nothing legitimate is this deep; anything deeper is a data error. */
const MAX_CHAIN_DEPTH = 50;

export function computeOrgChainHealth(
  agentId: string,
  agents: ReadonlyMap<string, OrgChainNode>,
): OrgChainHealth {
  const self = agents.get(agentId);
  if (!self) return { status: "healthy" };

  const seen = new Set<string>([agentId]);
  const path = [agentId];
  let pausedAncestor: OrgChainNode | null = null;
  let cursor = self.reportsTo;

  for (let depth = 0; cursor !== null && depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (seen.has(cursor)) {
      return {
        status: "cycle",
        path: [...path, cursor],
        repairGuidance: "Two agents report to each other. Change one of their managers.",
      };
    }

    const manager = agents.get(cursor);
    if (!manager) {
      return {
        status: "missing_manager",
        managerId: cursor,
        repairGuidance: "This agent's manager no longer exists. Assign a new one.",
      };
    }

    if (manager.status === "terminated") {
      return {
        status: "terminated_ancestor",
        agentId: manager.id,
        agentName: manager.name,
        repairGuidance: `${manager.name} was terminated. Reassign this agent to an active manager.`,
      };
    }

    // A paused manager does NOT break the chain. The agent stays invokable;
    // escalations routed to the paused manager simply dead-letter. Blocking the
    // descendant would cause more harm than the silent escalation it prevents.
    if (manager.status === "paused" && !pausedAncestor) pausedAncestor = manager;

    seen.add(cursor);
    path.push(cursor);
    cursor = manager.reportsTo;
  }

  if (cursor !== null) {
    return {
      status: "cycle",
      path,
      repairGuidance: "The reporting chain is longer than expected. Check for a loop.",
    };
  }

  return pausedAncestor
    ? {
        status: "healthy",
        escalationWarning: `${pausedAncestor.name} is paused, so escalations above this agent will not be picked up.`,
      }
    : { status: "healthy" };
}

export type AgentEligibility = {
  assignable: boolean;
  invokable: boolean;
  reason: "ok" | "status" | "invalid_org_chain";
};

export function computeEligibility(
  status: AgentStatus,
  health: OrgChainHealth,
): AgentEligibility {
  if (health.status !== "healthy") {
    return { assignable: false, invokable: false, reason: "invalid_org_chain" };
  }
  if (NON_INVOKABLE_STATUSES.includes(status)) {
    return { assignable: false, invokable: false, reason: "status" };
  }
  return { assignable: true, invokable: true, reason: "ok" };
}

/**
 * Walks from an agent up to the root. Stops at the first broken hop rather than
 * looping, so it is safe to call on a chain that has not been validated.
 */
export function chainOfCommand(
  agentId: string,
  agents: ReadonlyMap<string, OrgChainNode>,
): OrgChainNode[] {
  const chain: OrgChainNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = agentId;

  while (cursor !== null && chain.length < MAX_CHAIN_DEPTH && !seen.has(cursor)) {
    const node: OrgChainNode | undefined = agents.get(cursor);
    if (!node) break;
    chain.push(node);
    seen.add(cursor);
    cursor = node.reportsTo;
  }
  return chain;
}

export type OrgTreeNode = OrgChainNode & { reports: OrgTreeNode[] };

/**
 * Builds the tree, treating an agent whose manager is absent from the input as
 * a root. An agent must never disappear because its manager was filtered out —
 * hidden ancestors promote their children rather than swallowing them.
 */
export function buildOrgTree(nodes: readonly OrgChainNode[]): OrgTreeNode[] {
  const present = new Set(nodes.map((n) => n.id));
  const byManager = new Map<string | null, OrgChainNode[]>();

  for (const node of nodes) {
    const key = node.reportsTo && present.has(node.reportsTo) ? node.reportsTo : null;
    const bucket = byManager.get(key);
    if (bucket) bucket.push(node);
    else byManager.set(key, [node]);
  }

  const seen = new Set<string>();
  const build = (node: OrgChainNode): OrgTreeNode => {
    seen.add(node.id);
    const children = (byManager.get(node.id) ?? []).filter((c) => !seen.has(c.id));
    return { ...node, reports: children.map(build) };
  };

  return (byManager.get(null) ?? []).map(build);
}
