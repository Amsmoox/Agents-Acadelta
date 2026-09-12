// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

// How a running agent reaches back into the system.
//
// The tool surface is delivered as a command on PATH rather than as a protocol,
// because every harness this supports can already run a command and not all of
// them speak the same protocol. One shim, one HTTP client, one set of rules.

export * from "./tools.js";
export * from "./shim.js";
