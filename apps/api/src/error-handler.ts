// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import type { FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError, isAppError } from "@agentco/shared";

/**
 * One shape for every failure: `{ error: { code, message, detail? } }`.
 *
 * Only errors the API chose to describe reach the caller with detail. Anything
 * unrecognised is logged in full and answered with AGC-1000 and nothing else,
 * so stack traces and driver messages never escape through the error channel.
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const failure = new AppError("VALIDATION_FAILED", {
        issues: error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message,
        })),
      });
      return reply.status(failure.status).send(failure.toResponse());
    }

    if (isAppError(error)) {
      // Expected outcomes, not incidents: log at debug so real faults stay visible.
      request.log.debug({ code: error.code, detail: error.detail }, error.message);
      return reply.status(error.status).send(error.toResponse());
    }

    request.log.error({ err: error }, "unhandled error");
    const internal = new AppError("INTERNAL");
    return reply.status(internal.status).send(internal.toResponse());
  });

  app.setNotFoundHandler((request, reply) => {
    const failure = new AppError("NOT_FOUND", { method: request.method, url: request.url });
    return reply.status(failure.status).send(failure.toResponse());
  });
}
