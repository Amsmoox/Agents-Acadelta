// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { agentRuns, runCredentials, type Database, type RunCredentialRow } from "@agentco/db";
import { AppError, DEFAULT_CROSS_TASK_WRITE_LIMIT } from "@agentco/shared";

/**
 * What a running agent proves it is with.
 *
 * The credential is minted with the lease and dies with it, so a token that
 * leaks out of a crashed run is inert within seconds rather than forever. Only
 * the hash is stored: the plaintext exists in the child process's environment
 * and nowhere else, including this database and the transcript.
 */

export const RUN_TOKEN_ENV = "AGENTCO_RUN_TOKEN";
export const RUN_API_ENV = "AGENTCO_API_URL";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type RunIdentity = {
  runId: string;
  organizationId: string;
  agentId: string;
  responsibleUserId: string;
  currentTaskId: string | null;
  projectId: string | null;
  crossTaskWriteLimit: number;
  crossTaskWriteCount: number;
};

export function createCredentialRepository(db: Database) {
  return {
    async mint(input: {
      runId: string;
      organizationId: string;
      agentId: string;
      responsibleUserId: string;
      expiresAt: Date;
      crossTaskWriteLimit?: number;
    }): Promise<string> {
      const token = randomBytes(32).toString("base64url");
      await db
        .insert(runCredentials)
        .values({
          runId: input.runId,
          organizationId: input.organizationId,
          agentId: input.agentId,
          tokenHash: hash(token),
          responsibleUserId: input.responsibleUserId,
          crossTaskWriteLimit: input.crossTaskWriteLimit ?? DEFAULT_CROSS_TASK_WRITE_LIMIT,
          expiresAt: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: runCredentials.runId,
          set: { tokenHash: hash(token), expiresAt: input.expiresAt, revokedAt: null },
        });
      return token;
    },

    /** Extends with the lease, so a long run does not lose its own credential. */
    async touch(runId: string, expiresAt: Date): Promise<void> {
      await db.update(runCredentials).set({ expiresAt }).where(eq(runCredentials.runId, runId));
    },

    async revoke(runId: string): Promise<void> {
      await db
        .update(runCredentials)
        .set({ revokedAt: new Date() })
        .where(eq(runCredentials.runId, runId));
    },

    async setContext(
      runId: string,
      context: { taskId: string | null; projectId: string | null },
    ): Promise<void> {
      await db
        .update(runCredentials)
        .set({ currentTaskId: context.taskId, projectId: context.projectId })
        .where(eq(runCredentials.runId, runId));
    },

    /**
     * Resolves a token to who is acting, or refuses.
     *
     * The run has to still be live: a credential that outlived its run is a
     * credential nothing is supervising.
     */
    async resolve(token: string): Promise<RunIdentity> {
      const [row] = await db
        .select({
          cred: runCredentials,
          runStatus: agentRuns.status,
        })
        .from(runCredentials)
        .innerJoin(agentRuns, eq(agentRuns.id, runCredentials.runId))
        .where(eq(runCredentials.tokenHash, hash(token)))
        .limit(1);

      if (!row) throw new AppError("RUN_CREDENTIAL_INVALID");

      const cred: RunCredentialRow = row.cred;
      if (cred.revokedAt) throw new AppError("RUN_CREDENTIAL_INVALID", { reason: "revoked" });
      if (cred.expiresAt.getTime() < Date.now()) {
        throw new AppError("RUN_CREDENTIAL_INVALID", { reason: "expired" });
      }
      if (row.runStatus !== "leased" && row.runStatus !== "running") {
        throw new AppError("RUN_CREDENTIAL_INVALID", { reason: "run_not_live" });
      }

      return {
        runId: cred.runId,
        organizationId: cred.organizationId,
        agentId: cred.agentId,
        responsibleUserId: cred.responsibleUserId,
        currentTaskId: cred.currentTaskId,
        projectId: cred.projectId,
        crossTaskWriteLimit: cred.crossTaskWriteLimit,
        crossTaskWriteCount: cred.crossTaskWriteCount,
      };
    },

    /**
     * Counts a write to a task this run is not working on, and refuses past the
     * ceiling.
     *
     * The budget is per run rather than per agent: a long-lived agent is not
     * permanently limited, and a single run that has decided to restructure the
     * whole project is stopped at twenty rather than two hundred.
     */
    async chargeCrossTaskWrite(runId: string, taskId: string | null): Promise<void> {
      const [cred] = await db
        .select()
        .from(runCredentials)
        .where(eq(runCredentials.runId, runId))
        .limit(1);
      if (!cred) throw new AppError("RUN_CREDENTIAL_INVALID");
      if (taskId && cred.currentTaskId && taskId === cred.currentTaskId) return;

      const [updated] = await db
        .update(runCredentials)
        .set({ crossTaskWriteCount: sql`${runCredentials.crossTaskWriteCount} + 1` })
        .where(
          and(
            eq(runCredentials.runId, runId),
            sql`${runCredentials.crossTaskWriteCount} < ${runCredentials.crossTaskWriteLimit}`,
          ),
        )
        .returning({ count: runCredentials.crossTaskWriteCount });

      if (!updated) {
        throw new AppError("CROSS_TASK_LIMIT", {
          limit: cred.crossTaskWriteLimit,
        });
      }
    },
  };
}

export type CredentialRepository = ReturnType<typeof createCredentialRepository>;
