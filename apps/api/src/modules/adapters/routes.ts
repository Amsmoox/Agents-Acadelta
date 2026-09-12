// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import { listAdapters } from "@agentco/adapters";

/**
 * The catalogue of agent types and their declared configuration.
 *
 * The web app renders its forms from this rather than hard-coding a form per
 * adapter, so adding an adapter needs no change on the client.
 */
export async function registerAdapterRoutes(app: FastifyInstance) {
  app.get("/adapters", async () => ({
    data: listAdapters().map((adapter) => ({
      type: adapter.type,
      label: adapter.label,
      summary: adapter.summary,
      hidden: adapter.hidden ?? false,
      experimental: adapter.experimental ?? false,
      configSchema: adapter.configSchema,
      capabilities: {
        supportsSessionResume: adapter.supportsSessionResume ?? false,
        supportsInstructionsBundle: adapter.supportsInstructionsBundle ?? false,
        requiresMaterializedSkills: adapter.requiresMaterializedSkills ?? false,
      },
    })),
  }));
}
