// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { Database } from "@agentco/db";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

export {};
