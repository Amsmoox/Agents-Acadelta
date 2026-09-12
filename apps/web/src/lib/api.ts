// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * Every API failure arrives in one shape, so the UI never has to guess how to
 * read an error. ApiError carries the stable AGC- code, which is what callers
 * branch on — never the message, which is for people.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const BASE = "/api";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "AGC-0000", "Can't reach the server. Is the API running?");
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "AGC-1000",
      error?.message ?? "Something went wrong.",
      error?.detail,
    );
  }

  return body as T;
}

/** First validation issue, ready to show under the offending field. */
export function firstIssue(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const issues = error.detail?.["issues"];
  if (Array.isArray(issues) && issues.length > 0) {
    const issue = issues[0] as { message?: string };
    return issue.message;
  }
  return error.message;
}
