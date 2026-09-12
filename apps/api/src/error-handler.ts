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
function transportFailure(error: unknown): AppError | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };

  if (code === "FST_ERR_CTP_EMPTY_JSON_BODY" || code === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return new AppError("MALFORMED_JSON");
  }
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || statusCode === 413) {
    return new AppError("PAYLOAD_TOO_LARGE");
  }
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || statusCode === 415) {
    return new AppError("UNSUPPORTED_MEDIA_TYPE");
  }
  // Anything else Fastify itself classified as a client error.
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return new AppError("BAD_REQUEST");
  }
  return null;
}

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

    // Fastify rejects malformed JSON, oversized bodies and unusable content
    // types before any handler runs. Those carry their own status code and are
    // the caller's problem, not a server fault — without this they all fell
    // through to a 500 and the caller was told nothing useful.
    const transport = transportFailure(error);
    if (transport) {
      request.log.debug({ code: transport.code }, transport.message);
      return reply.status(transport.status).send(transport.toResponse());
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
