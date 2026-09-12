// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { PROJECT } from "@agentco/shared";
import { buildInfo } from "../build-info.js";

/**
 * Liveness, readiness and provenance.
 *
 * `/health` answers without touching Postgres so it stays useful when the
 * database is the thing that is down; `/health/ready` proves the connection
 * actually works; `/health/provenance` reports where this build came from.
 */
export async function registerHealthRoutes(app: FastifyInstance, opts: { pool: Pool }) {
  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await opts.pool.query("select 1");
      return { status: "ok", database: "ok" };
    } catch (error) {
      app.log.error({ err: error }, "database readiness check failed");
      return reply.status(503).send({ status: "degraded", database: "unreachable" });
    }
  });

  // Reports only to whoever asks. Makes no outbound request to anyone.
  app.get("/health/provenance", async () => ({
    project: PROJECT.name,
    author: PROJECT.author,
    license: PROJECT.license,
    copyright: PROJECT.copyright,
    version: buildInfo.version,
    commit: buildInfo.commit,
    builtAt: buildInfo.builtAt,
  }));
}
