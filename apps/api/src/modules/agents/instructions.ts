// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { and, asc, eq } from "drizzle-orm";
import { agentInstructionFiles, agents, type Database } from "@agentco/db";
import {
  AppError,
  INSTRUCTIONS_ENTRY_FILE,
  defaultInstructions,
  instructionPathSchema,
  type InstructionFile,
} from "@agentco/shared";

/**
 * An agent's instruction bundle.
 *
 * The database holds the bytes; disk is only ever a cache written before a run.
 * That way a bundle survives a redeploy, travels with an organization export,
 * and is readable from a second node without shared storage.
 */
export function createInstructionRepository(db: Database) {
  function assertPath(path: string): string {
    const result = instructionPathSchema.safeParse(path);
    if (!result.success) {
      throw new AppError("INSTRUCTION_PATH_INVALID", {
        path,
        reason: result.error.issues[0]?.message,
      });
    }
    return result.data;
  }

  return {
    /** Called when an agent is hired, so it never exists without an identity. */
    async seed(organizationId: string, agentId: string, agentName: string, role: string) {
      await db.insert(agentInstructionFiles).values({
        organizationId,
        agentId,
        path: INSTRUCTIONS_ENTRY_FILE,
        content: defaultInstructions(agentName, role),
      });
    },

    /**
     * Guarantees the entry file exists before it is read.
     *
     * Hiring seeds one, but agents created before bundles existed have none,
     * and an agent with no identity at all is a worse outcome than a default
     * one. Self-healing here avoids a backfill migration that would have to be
     * re-run for every such gap.
     */
    async ensureEntry(organizationId: string, agentId: string): Promise<void> {
      const [existing] = await db
        .select({ id: agentInstructionFiles.id })
        .from(agentInstructionFiles)
        .where(
          and(
            eq(agentInstructionFiles.organizationId, organizationId),
            eq(agentInstructionFiles.agentId, agentId),
            eq(agentInstructionFiles.path, INSTRUCTIONS_ENTRY_FILE),
          ),
        )
        .limit(1);
      if (existing) return;

      const [agent] = await db
        .select({ name: agents.name, role: agents.role })
        .from(agents)
        .where(and(eq(agents.organizationId, organizationId), eq(agents.id, agentId)))
        .limit(1);
      if (!agent) return;

      await db
        .insert(agentInstructionFiles)
        .values({
          organizationId,
          agentId,
          path: INSTRUCTIONS_ENTRY_FILE,
          content: defaultInstructions(agent.name, agent.role),
        })
        // Two readers arriving together must not race into a duplicate.
        .onConflictDoNothing();
    },

    async list(organizationId: string, agentId: string): Promise<InstructionFile[]> {
      await this.ensureEntry(organizationId, agentId);

      const rows = await db
        .select()
        .from(agentInstructionFiles)
        .where(
          and(
            eq(agentInstructionFiles.organizationId, organizationId),
            eq(agentInstructionFiles.agentId, agentId),
          ),
        )
        .orderBy(asc(agentInstructionFiles.path));

      return rows.map((row) => ({
        path: row.path,
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },

    /** The entry file, which is what a run actually loads. */
    async entry(organizationId: string, agentId: string): Promise<string> {
      await this.ensureEntry(organizationId, agentId);
      const [row] = await db
        .select()
        .from(agentInstructionFiles)
        .where(
          and(
            eq(agentInstructionFiles.organizationId, organizationId),
            eq(agentInstructionFiles.agentId, agentId),
            eq(agentInstructionFiles.path, INSTRUCTIONS_ENTRY_FILE),
          ),
        )
        .limit(1);
      return row?.content ?? "";
    },

    async write(
      organizationId: string,
      agentId: string,
      path: string,
      content: string,
    ): Promise<InstructionFile> {
      const safePath = assertPath(path);

      const [row] = await db
        .insert(agentInstructionFiles)
        .values({ organizationId, agentId, path: safePath, content })
        .onConflictDoUpdate({
          target: [agentInstructionFiles.agentId, agentInstructionFiles.path],
          set: { content, updatedAt: new Date() },
        })
        .returning();
      if (!row) throw new AppError("INTERNAL");

      return {
        path: row.path,
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async remove(organizationId: string, agentId: string, path: string): Promise<void> {
      // The entry file is what a run loads. Removing it would leave the agent
      // with no identity at all, which is worse than any bundle it can edit
      // itself into.
      if (path === INSTRUCTIONS_ENTRY_FILE) throw new AppError("INSTRUCTION_ENTRY_REQUIRED");

      const deleted = await db
        .delete(agentInstructionFiles)
        .where(
          and(
            eq(agentInstructionFiles.organizationId, organizationId),
            eq(agentInstructionFiles.agentId, agentId),
            eq(agentInstructionFiles.path, path),
          ),
        )
        .returning();

      if (deleted.length === 0) throw new AppError("INSTRUCTION_FILE_NOT_FOUND", { path });
    },
  };
}

export type InstructionRepository = ReturnType<typeof createInstructionRepository>;
