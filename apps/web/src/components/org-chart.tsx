// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { OrgTreeNode } from "@agentco/shared";
import { StatusDot } from "@/components/ui/status";
import { AdapterIcon } from "@/components/adapter-icon";
import { STATUS_LABEL, STATUS_TONE } from "@/features/agents/status";
import { cn } from "@/lib/utils";

/**
 * The reporting structure, drawn.
 *
 * An indented list says who reports to whom and makes you read it; a chart
 * shows it, and the shape of a company — one manager with six reports, or a
 * chain four deep — is the thing you are looking at it to learn.
 *
 * There is one hierarchy in this system and it belongs to the organization.
 * A project draws the same tree filtered to its own members, rather than
 * carrying a second structure that could disagree with the first.
 *
 * Connectors are elements rather than pseudo-elements: the arms have to know
 * whether they are on the first or the last sibling, and passing that down is
 * clearer than four `:first-child` rules that have to be read together.
 */

export type OrgChartNodeExtra = {
  /** Small text under the name — a job title, or what the agent is for. */
  caption?: string | null;
  /** A short marker beside the name, for a role the tree cannot show. */
  tag?: string | undefined;
  adapterType?: string | undefined;
};

export type OrgChartProps = {
  nodes: OrgTreeNode[];
  org: string;
  /** Extra per-agent detail, keyed by agent id. */
  detail?: Record<string, OrgChartNodeExtra>;
  className?: string;
};

const CONNECTOR = "bg-line-strong";

function Card({
  node,
  org,
  extra,
}: {
  node: OrgTreeNode;
  org: string;
  extra?: OrgChartNodeExtra | undefined;
}) {
  const tone = STATUS_TONE[node.status];
  const label = STATUS_LABEL[node.status];
  const caption = extra?.caption ?? null;

  return (
    <Link
      to="/organizations/$ref/agents/$agentRef"
      params={{ ref: org, agentRef: node.id }}
      title={`${node.name} — ${label}`}
      className={cn(
        "group flex w-40 flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-surface",
        "px-2.5 py-2 text-left transition-colors duration-75",
        "hover:border-line-strong hover:bg-sunken",
        // Keyboard users get the same affordance the pointer does.
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
      )}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot tone={tone} />
        {extra?.adapterType ? (
          <AdapterIcon type={extra.adapterType} className="size-3.5 shrink-0" />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{node.name}</span>
      </div>

      {caption || extra?.tag ? (
        <div className="flex items-center gap-1.5 pl-[0.5625rem]">
          {extra?.tag ? (
            <span className="machine shrink-0 rounded-[var(--radius-sm)] border border-line px-1 text-[0.5625rem] uppercase text-muted">
              {extra.tag}
            </span>
          ) : null}
          {caption ? <span className="truncate text-2xs text-muted">{caption}</span> : null}
        </div>
      ) : null}
    </Link>
  );
}

function Node({
  node,
  org,
  detail,
  isFirst,
  isLast,
  isRoot,
}: {
  node: OrgTreeNode;
  org: string;
  detail: Record<string, OrgChartNodeExtra>;
  isFirst: boolean;
  isLast: boolean;
  isRoot: boolean;
}) {
  const reports = node.reports;

  return (
    // No padding here: the connector spans the full slot, and a gap taken out
    // of it would break the bar between one sibling and the next. The breathing
    // room goes around the card instead, inside the slot the arms measure.
    <li className="flex flex-col items-center">
      {/* The elbow into this node, drawn by the child rather than by the parent,
          so a row of siblings lines up without anything being measured. */}
      {!isRoot ? (
        <div className="relative h-4 w-full">
          {!isFirst ? (
            <div className={cn("absolute left-0 top-0 h-px w-1/2", CONNECTOR)} />
          ) : null}
          {!isLast ? (
            <div className={cn("absolute left-1/2 top-0 h-px w-1/2", CONNECTOR)} />
          ) : null}
          <div className={cn("absolute left-1/2 top-0 h-4 w-px -translate-x-1/2", CONNECTOR)} />
        </div>
      ) : null}

      <div className="px-2">
        <Card node={node} org={org} extra={detail[node.id]} />
      </div>

      {reports.length > 0 ? (
        <>
          <div className={cn("h-4 w-px", CONNECTOR)} />
          <ul className="flex items-start">
            {reports.map((child, index) => (
              <Node
                key={child.id}
                node={child}
                org={org}
                detail={detail}
                isFirst={index === 0}
                isLast={index === reports.length - 1}
                isRoot={false}
              />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export function OrgChart({ nodes, org, detail = {}, className }: OrgChartProps) {
  const scroller = useRef<HTMLDivElement>(null);

  // A chart wider than its frame opens at its left edge, which on a phone is a
  // screenful of the most junior people while the person everything reports to
  // is somewhere off to the right. The root is in the middle, so start there.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, [nodes]);

  if (nodes.length === 0) return null;

  return (
    // A wide company is wider than any screen, and squeezing it would make the
    // names unreadable rather than the chart smaller. Scroll the diagram, never
    // the page: the body must not move sideways.
    <div ref={scroller} className={cn("overflow-x-auto", className)}>
      <ul className="flex w-max min-w-full items-start justify-center gap-4 px-2 py-4">
        {nodes.map((node) => (
          <Node
            key={node.id}
            node={node}
            org={org}
            detail={detail}
            isFirst
            isLast
            isRoot
          />
        ))}
      </ul>
    </div>
  );
}
