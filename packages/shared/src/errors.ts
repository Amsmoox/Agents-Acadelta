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
  PAGE_CURSOR_EXPIRED: {
    code: 1008,
    status: 400,
    message: "That page is no longer available. Start from the beginning.",
  },

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
  // 25xx — projects
  PROJECT_NOT_FOUND: { code: 2501, status: 404, message: "Project not found." },
  PROJECT_SLUG_TAKEN: { code: 2502, status: 409, message: "That project name is already in use." },
  PROJECT_PREFIX_TAKEN: {
    code: 2503,
    status: 409,
    message: "That task prefix is already used by another project.",
  },
  PROJECT_ARCHIVED: {
    code: 2504,
    status: 409,
    message: "Project is archived. Restore it before making changes.",
  },
  PROJECT_HAS_OPEN_WORK: {
    code: 2505,
    status: 409,
    message: "This project still has work in progress.",
  },
  PROJECT_MEMBER_NOT_ASSIGNABLE: {
    code: 2506,
    status: 422,
    message: "That agent cannot be given work, so it cannot be a project member.",
  },
  PROJECT_SLUG_UNAVAILABLE: {
    code: 2507,
    status: 409,
    message: "Could not derive an available name from that. Pass a slug explicitly.",
  },
  PROJECT_PREFIX_UNAVAILABLE: {
    code: 2508,
    status: 409,
    message: "Could not derive an available task prefix from that name. Pass one explicitly.",
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
  AGENT_MANAGER_TERMINATED: {
    code: 3011,
    status: 422,
    message: "That manager is terminated, so it cannot be anyone's escalation path.",
  },
  // 4xxx - knowledge: instructions and skills
  SKILL_NOT_FOUND: { code: 4001, status: 404, message: "Skill not found." },
  SKILL_SLUG_TAKEN: { code: 4002, status: 409, message: "That skill name is already in use." },
  SKILL_HEADER_INVALID: { code: 4003, status: 422, message: "The skill header is not valid." },
  INSTRUCTION_FILE_NOT_FOUND: { code: 4004, status: 404, message: "Instruction file not found." },
  INSTRUCTION_PATH_INVALID: { code: 4005, status: 422, message: "That file path is not allowed." },
  INSTRUCTION_ENTRY_REQUIRED: {
    code: 4006,
    status: 409,
    message: "AGENTS.md is the entry file and cannot be deleted.",
  },
  // 6xxx — work
  TASK_NOT_FOUND: { code: 6001, status: 404, message: "Task not found." },
  TASK_DUPLICATE: {
    code: 6002,
    status: 409,
    message: "An open task with that title already exists here.",
  },
  TASK_CLAIM_CONFLICT: {
    code: 6003,
    status: 409,
    message: "Another run is already working on this task.",
  },
  TASK_TERMINAL: { code: 6004, status: 409, message: "That task is already finished." },
  TASK_DEPTH_EXCEEDED: {
    code: 6005,
    status: 422,
    message: "This delegation chain is too deep. Something is looping.",
  },
  TASK_DELEGATION_CYCLE: {
    code: 6006,
    status: 422,
    message: "That agent already owns an open task in this chain, so this would loop.",
  },
  TASK_ASSIGNEE_NOT_MEMBER: {
    code: 6007,
    status: 422,
    message: "That agent is not on this project.",
  },
  TASK_REVIEW_COMMENT_REQUIRED: {
    code: 6008,
    status: 422,
    message: "A review verdict needs a reason. Say what you checked, or what to change.",
  },
  TASK_REVIEW_NOT_ALLOWED: {
    code: 6009,
    status: 403,
    message: "You cannot cast the verdict on this task.",
  },
  TASK_DEPENDENCY_CYCLE: {
    code: 6010,
    status: 422,
    message: "That would make two tasks wait for each other.",
  },
  CROSS_TASK_LIMIT: {
    code: 6011,
    status: 429,
    message: "This run has changed as many other tasks as it may. Finish, and continue next run.",
  },
  RUN_CREDENTIAL_INVALID: {
    code: 6012,
    status: 401,
    message: "That run credential is not valid.",
  },
  OBJECTIVE_NOT_FOUND: { code: 6013, status: 404, message: "Objective not found." },
  OBJECTIVE_ALREADY_ACTIVE: {
    code: 6014,
    status: 409,
    message: "That agent already carries an objective on this project.",
  },
  OBJECTIVE_NOT_ACTIVE: { code: 6015, status: 409, message: "That objective has finished." },
  TASK_NOT_IN_REVIEW: { code: 6016, status: 409, message: "That task is not in review." },

  // 5xxx - execution
  RUN_NOT_FOUND: { code: 5001, status: 404, message: "Run not found." },
  RUN_NOT_ACTIVE: { code: 5002, status: 409, message: "That run has already finished." },
  AGENT_NOT_INVOKABLE: {
    code: 5003,
    status: 409,
    message: "This agent cannot run right now.",
  },
  ADAPTER_NOT_RUNNABLE: {
    code: 5004,
    status: 422,
    message: "This agent type cannot be run by the local runner yet.",
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
