// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./agents.js";
import {
  buildOrgTree,
  chainOfCommand,
  computeEligibility,
  computeOrgChainHealth,
  type OrgChainNode,
} from "./org-chain.js";

function node(id: string, reportsTo: string | null, status: AgentStatus = "idle"): OrgChainNode {
  return { id, name: id.toUpperCase(), status, reportsTo };
}

function graph(...nodes: OrgChainNode[]) {
  return new Map(nodes.map((n) => [n.id, n]));
}

describe("computeOrgChainHealth", () => {
  it("reports a clean chain as healthy", () => {
    const health = computeOrgChainHealth("dev", graph(node("ceo", null), node("dev", "ceo")));
    expect(health.status).toBe("healthy");
  });

  it("treats a root agent as healthy", () => {
    expect(computeOrgChainHealth("ceo", graph(node("ceo", null))).status).toBe("healthy");
  });

  it("detects a two-agent loop", () => {
    const health = computeOrgChainHealth("a", graph(node("a", "b"), node("b", "a")));
    expect(health.status).toBe("cycle");
  });

  it("detects a longer loop", () => {
    const health = computeOrgChainHealth(
      "a",
      graph(node("a", "b"), node("b", "c"), node("c", "a")),
    );
    expect(health.status).toBe("cycle");
  });

  it("reports a manager that no longer exists", () => {
    const health = computeOrgChainHealth("dev", graph(node("dev", "ghost")));
    expect(health.status).toBe("missing_manager");
    if (health.status === "missing_manager") expect(health.managerId).toBe("ghost");
  });

  it("reports a terminated ancestor, naming it", () => {
    const health = computeOrgChainHealth(
      "dev",
      graph(node("ceo", null), node("lead", "ceo", "terminated"), node("dev", "lead")),
    );
    expect(health.status).toBe("terminated_ancestor");
    if (health.status === "terminated_ancestor") {
      expect(health.agentName).toBe("LEAD");
      expect(health.repairGuidance).toContain("LEAD");
    }
  });

  it("keeps a chain with a paused manager healthy, with a warning", () => {
    // A paused manager does not break the chain — escalations dead-letter, and
    // blocking the descendant would do more harm than the silence it prevents.
    const health = computeOrgChainHealth(
      "dev",
      graph(node("ceo", null), node("lead", "ceo", "paused"), node("dev", "lead")),
    );
    expect(health.status).toBe("healthy");
    if (health.status === "healthy") expect(health.escalationWarning).toContain("LEAD");
  });

  it("prefers the terminated ancestor over a paused one further up", () => {
    const health = computeOrgChainHealth(
      "dev",
      graph(
        node("ceo", null, "paused"),
        node("lead", "ceo", "terminated"),
        node("dev", "lead"),
      ),
    );
    expect(health.status).toBe("terminated_ancestor");
  });
});

describe("computeEligibility", () => {
  it("allows a healthy idle agent", () => {
    const result = computeEligibility("idle", { status: "healthy" });
    expect(result).toEqual({ assignable: true, invokable: true, reason: "ok" });
  });

  it.each(["paused", "terminated", "pending_approval"] as const)("blocks %s", (status) => {
    const result = computeEligibility(status, { status: "healthy" });
    expect(result.invokable).toBe(false);
    expect(result.reason).toBe("status");
  });

  it("blocks an otherwise-fine agent whose chain is broken", () => {
    const result = computeEligibility("idle", {
      status: "missing_manager",
      managerId: "ghost",
      repairGuidance: "",
    });
    expect(result).toEqual({ assignable: false, invokable: false, reason: "invalid_org_chain" });
  });
});

describe("chainOfCommand", () => {
  it("walks to the root", () => {
    const chain = chainOfCommand(
      "dev",
      graph(node("ceo", null), node("lead", "ceo"), node("dev", "lead")),
    );
    expect(chain.map((n) => n.id)).toEqual(["dev", "lead", "ceo"]);
  });

  it("terminates on a loop instead of hanging", () => {
    const chain = chainOfCommand("a", graph(node("a", "b"), node("b", "a")));
    expect(chain.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("buildOrgTree", () => {
  it("nests reports under their manager", () => {
    const tree = buildOrgTree([node("ceo", null), node("dev", "ceo")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.reports.map((r) => r.id)).toEqual(["dev"]);
  });

  it("promotes an agent whose manager was filtered out, instead of losing it", () => {
    // A hidden ancestor must never swallow live agents.
    const tree = buildOrgTree([node("dev", "terminated-lead")]);
    expect(tree.map((n) => n.id)).toEqual(["dev"]);
  });

  it("supports several roots", () => {
    const tree = buildOrgTree([node("a", null), node("b", null), node("a1", "a")]);
    expect(tree.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("does not loop forever on a cycle", () => {
    const tree = buildOrgTree([node("a", "b"), node("b", "a")]);
    expect(Array.isArray(tree)).toBe(true);
  });

  it("draws a project's team from the company structure, filtered", () => {
    // This is what lets a project have no hierarchy of its own. The company is
    // nadia -> sam -> jun, and nadia -> leo. A project staffed with sam and jun
    // but not nadia keeps sam above jun, and sam becomes the root rather than
    // disappearing along with the manager who is not on the project.
    const company = [
      node("nadia", null),
      node("sam", "nadia"),
      node("jun", "sam"),
      node("leo", "nadia"),
    ];
    const team = new Set(["sam", "jun"]);

    const tree = buildOrgTree(company.filter((agent) => team.has(agent.id)));

    expect(tree.map((n) => n.id)).toEqual(["sam"]);
    expect(tree[0]?.reports.map((r) => r.id)).toEqual(["jun"]);
  });
});
