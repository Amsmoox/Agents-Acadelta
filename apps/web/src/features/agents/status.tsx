// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { AgentStatus, OrgChainHealth } from "@agentco/shared";
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
