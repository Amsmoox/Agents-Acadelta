// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import pino from "pino";

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    ...(pretty ? { transport: { target: "pino-pretty" } } : {}),
  });
}
