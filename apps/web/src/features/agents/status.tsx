// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AgentEligibility, AgentStatus, OrgChainHealth } from "@agentco/shared";
import type { Tone } from "@/components/ui/status";

/** One mapping from status to tone, imported everywhere. Never re-derived. */
export const STATUS_TONE: Record<AgentStatus, Tone> = {
  running: "active",
  idle: "idle",
  paused: "attention",
  pending_approval: "attention",
  error: "danger",
  terminated: "idle",
};

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Running",
  idle: "Idle",
  paused: "Paused",
  pending_approval: "Awaiting approval",
  error: "Error",
  terminated: "Terminated",
};

/**
 * Why an agent is paused, in the operator's terms.
 *
 * A budget stop and someone clicking pause look identical on screen otherwise,
 * and they call for completely different responses: one needs a bigger limit,
 * the other needs a person to press resume.
 */
export function pauseExplanation(reason: string | null): string {
  switch (reason) {
    case "budget":
      return "This agent reached its monthly budget and stopped itself. Raise the limit to let it run again.";
    case "system":
      return "The platform paused this agent.";
    case "manual":
      return "Someone paused this agent.";
    default:
      return "This agent is paused.";
  }
}

/** Names the broken hop rather than saying "something is wrong". */
export function chainProblem(health: OrgChainHealth): string | null {
  switch (health.status) {
    case "healthy":
      return null;
    case "cycle":
      return "This agent's reporting line forms a loop, so escalation has no end point.";
    case "missing_manager":
      return "This agent's manager no longer exists.";
    case "terminated_ancestor":
      return `${health.agentName} was terminated, so this agent has no working escalation path.`;
  }
}

/**
 * Why an agent cannot be given work.
 *
 * The overview used to answer "Can be assigned work" with a bare "No", which
 * tells you there is a problem and nothing about which one — and the two causes
 * need opposite responses: one is a status you can change here, the other is a
 * broken reporting line somewhere else entirely.
 */
export function eligibilityExplanation(
  eligibility: AgentEligibility,
  status: AgentStatus,
): string | null {
  if (eligibility.assignable) return null;
  switch (eligibility.reason) {
    case "invalid_org_chain":
      return "No — its reporting line is broken.";
    case "status":
      return `No — it is ${STATUS_LABEL[status].toLowerCase()}.`;
    default:
      return "No.";
  }
}
