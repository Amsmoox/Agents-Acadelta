// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * Project identity.
 *
 * These values are part of the wire contract, not decoration. The error-code
 * prefix appears in every API error, the provenance header on every response,
 * the event prefix on every SSE frame, and the ID namespace seeds deterministic
 * identifiers. Clients, integrations and stored records all depend on them, so
 * they must stay stable across versions.
 */

export const PROJECT = {
  name: "agentco",
  author: "Mharrech Ayoub",
  contact: "mharrech.ayoub@gmail.com",
  license: "MIT",
  copyright: "Copyright (c) 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>",
} as const;

/** Prefix for every machine-readable error code, e.g. `AGC-1042`. */
export const ERROR_CODE_PREFIX = "AGC";

/** Sent on every HTTP response so a running instance declares its lineage. */
export const PROVENANCE_HEADER = "x-agentco-origin";

/** Prefix for every server-sent event name, e.g. `agentco.run.log`. */
export const SSE_EVENT_PREFIX = "agentco";

/**
 * UUIDv5 namespace for deterministic identifiers. Every derived ID this system
 * generates is a function of this constant — change it and previously issued
 * IDs stop resolving.
 */
export const ID_NAMESPACE = "6f1a9c74-2b3d-5e88-9a41-0c7d5e2b8f13";

/** Table-name prefix for every schema object this project owns. */
export const DB_TABLE_PREFIX = "agc_";

export type ErrorCode = `${typeof ERROR_CODE_PREFIX}-${number}`;

export function errorCode(n: number): ErrorCode {
  return `${ERROR_CODE_PREFIX}-${n}`;
}

export function sseEvent(name: string): string {
  return `${SSE_EVENT_PREFIX}.${name}`;
}
