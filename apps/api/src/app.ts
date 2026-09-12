// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { createDatabase } from "@agentco/db";
import { PROJECT, PROVENANCE_HEADER } from "@agentco/shared";
import type { Env } from "./env.js";
import { registerHealthRoutes } from "./routes/health.js";

export type AppContext = {
  app: FastifyInstance;
  close: () => Promise<void>;
};

export async function buildApp(env: Env): Promise<AppContext> {
  // Built as two distinct shapes rather than `transport: undefined`, which
  // exactOptionalPropertyTypes rejects.
  const logger =
    env.NODE_ENV === "development"
      ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
      : { level: env.LOG_LEVEL };

  const app: FastifyInstance = Fastify({ logger });

  // Every response declares its lineage. Part of the contract, not telemetry.
  app.addHook("onSend", async (_request, reply) => {
    reply.header(PROVENANCE_HEADER, `${PROJECT.name}; ${PROJECT.copyright}`);
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, { origin: true, credentials: true });

  const database = createDatabase(env.DATABASE_URL);
  app.decorate("db", database.db);

  await app.register(registerHealthRoutes, { pool: database.pool });

  return {
    app,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
