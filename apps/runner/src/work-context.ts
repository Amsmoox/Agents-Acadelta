// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, eq, ne, sql } from "drizzle-orm";
import { agents, objectives, projects, tasks, type Database } from "@agentco/db";
import {
  buildIdlePrompt,
  buildTaskPrompt,
  createTaskRepository,
  type TaskPromptInput,
} from "@agentco/core";

/**
 * Everything the run needs to know about the work it is about to do.
 *
 * Gathered here rather than in the supervisor because it is all reads, and the
 * supervisor's job is processes. A run with no task still gets a prompt: being
 * woken with nothing assigned is a normal thing to happen when a wake and a
 * reassignment race, and the agent should be told that rather than left to
 * infer it from silence.
 */
export async function buildWorkPrompt(
  db: Database,
  input: { organizationId: string; agentId: string; taskId: string | null; reasons: { type: string; detail?: string }[] },
): Promise<string> {
  if (!input.taskId) return buildIdlePrompt(input.reasons);

  const repo = createTaskRepository(db);
  const task = await repo.get(input.organizationId, input.taskId);
  const comments = await repo.comments(input.organizationId, input.taskId);

  const [project] = await db
    .select({ name: projects.name, brief: projects.brief })
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .limit(1);

  let objective: TaskPromptInput["objective"] = null;
  if (task.objectiveId) {
    const [row] = await db
      .select()
      .from(objectives)
      .where(eq(objectives.id, task.objectiveId))
      .limit(1);
    if (row && row.status === "active") {
      objective = {
        title: row.title,
        directive: row.directive,
        exitCriteria: row.exitCriteria,
        cyclesLeft: Math.max(0, row.maxCycles - row.cycleCount),
      };
    }
  }

  const siblingRows = await db
    .select({
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      assignee: agents.name,
    })
    .from(tasks)
    .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
    .where(
      and(
        eq(tasks.projectId, task.projectId),
        ne(tasks.id, task.id),
        sql`${tasks.status} not in ('done','cancelled')`,
      ),
    )
    .orderBy(tasks.number)
    .limit(60);

  return buildTaskPrompt({
    task,
    comments,
    project: project ?? null,
    objective,
    siblings: siblingRows.map((row) => ({
      key: row.key,
      title: row.title,
      status: row.status,
      assignee: row.assignee,
    })),
  });
}
