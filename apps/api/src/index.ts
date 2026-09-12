// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { loadEnv } from "./env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const { app, close } = await buildApp(env);

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error({ err: error }, "failed to start api");
  await close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down api");
    void close().then(() => process.exit(0));
  });
}
