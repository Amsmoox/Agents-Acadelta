// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { ERROR_CODE_PREFIX } from "./provenance.js";

/**
 * Every failure the API can report, as a stable machine-readable code.
 *
 * Clients switch on these strings, so a code's meaning never changes once
 * published: retire a code rather than repurpose it. The numeric ranges keep
 * related failures together — 1xxx generic, 2xxx organizations — and each
 * later domain takes the next thousand.
 */
export const ERRORS = {
  // 1xxx — generic
  VALIDATION_FAILED: { code: 1001, status: 400, message: "Request body failed validation." },
  NOT_FOUND: { code: 1002, status: 404, message: "Resource not found." },
  CONFLICT: { code: 1003, status: 409, message: "Conflicting state." },
  INTERNAL: { code: 1000, status: 500, message: "Internal error." },
  MALFORMED_JSON: { code: 1004, status: 400, message: "Request body is not valid JSON." },
  PAYLOAD_TOO_LARGE: { code: 1005, status: 413, message: "Request body is too large." },
  UNSUPPORTED_MEDIA_TYPE: {
    code: 1006,
    status: 415,
    message: "Send this request as application/json.",
  },
  BAD_REQUEST: { code: 1007, status: 400, message: "The request could not be read." },

  // 2xxx — organizations
  ORGANIZATION_NOT_FOUND: { code: 2001, status: 404, message: "Organization not found." },
  ORGANIZATION_SLUG_TAKEN: { code: 2002, status: 409, message: "That slug is already in use." },
  ORGANIZATION_ARCHIVED: {
    code: 2003,
    status: 409,
    message: "Organization is archived. Restore it before making changes.",
  },
  ORGANIZATION_SLUG_UNAVAILABLE: {
    code: 2004,
    status: 409,
    message: "Could not derive an available slug from that name. Pass one explicitly.",
  },
  // 3xxx — agents
  AGENT_NOT_FOUND: { code: 3001, status: 404, message: "Agent not found." },
  AGENT_SLUG_TAKEN: { code: 3002, status: 409, message: "That agent name is already in use." },
  AGENT_TERMINATED: {
    code: 3003,
    status: 409,
    message: "This agent was terminated. Termination cannot be undone.",
  },
  AGENT_CONFIG_FROZEN: {
    code: 3004,
    status: 409,
    message: "This agent is awaiting approval. Its configuration cannot change until it is approved.",
  },
  AGENT_REPORTING_CYCLE: {
    code: 3005,
    status: 422,
    message: "That reporting line would create a loop.",
  },
  AGENT_MANAGER_NOT_FOUND: {
    code: 3006,
    status: 422,
    message: "That manager does not exist in this organization.",
  },
  UNKNOWN_ADAPTER: { code: 3007, status: 422, message: "That agent type is not available." },
  AGENT_NOT_IN_ERROR: {
    code: 3008,
    status: 409,
    message: "This agent is not in an error state.",
  },
  AGENT_REVISION_NOT_FOUND: { code: 3009, status: 404, message: "Revision not found." },
  AGENT_ADAPTER_CONFIG_INVALID: {
    code: 3010,
    status: 422,
    message: "The agent settings are incomplete.",
  },
} as const;

export type ErrorKey = keyof typeof ERRORS;

/**
 * An error the API is willing to describe to a caller. Anything else becomes
 * AGC-1000 with no detail, so internals never leak through the error channel.
 */
export class AppError extends Error {
  readonly key: ErrorKey;
  readonly code: string;
  readonly status: number;
  readonly detail: Record<string, unknown> | undefined;

  constructor(key: ErrorKey, detail?: Record<string, unknown>) {
    const spec = ERRORS[key];
    super(spec.message);
    this.name = "AppError";
    this.key = key;
    this.code = `${ERROR_CODE_PREFIX}-${spec.code}`;
    this.status = spec.status;
    this.detail = detail;
  }

  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.detail ? { detail: this.detail } : {}),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
