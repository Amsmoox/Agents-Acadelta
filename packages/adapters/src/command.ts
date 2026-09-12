// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { getAdapter } from "./registry.js";

/**
 * How to invoke one kind of agent.
 *
 * The adapter says what to run; the runner does the running. Keeping spawning,
 * streaming, timeouts and killing in one place means those behave identically
 * for every agent type, and an adapter cannot get process supervision subtly
 * wrong on its own.
 */
export type SpawnSpec = {
  command: string;
  args: string[];
  /** Written to the child's stdin, for tools that read the prompt there. */
  stdin?: string;
  /** How the runner should read what comes back. */
  output: "stream-json" | "text";
};

export type CommandContext = {
  prompt: string;
  /** A file holding the composed system prompt: identity plus skill manifest. */
  systemPromptPath: string;
  config: Record<string, unknown>;
};

function text(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function extraArgs(config: Record<string, unknown>): string[] {
  const raw = text(config, "extraArgs");
  return raw ? raw.split(",").map((arg) => arg.trim()).filter(Boolean) : [];
}

/**
 * Returns null for adapters the local runner cannot start — a webhook agent
 * runs on someone else's machine, and pretending otherwise would produce a
 * confusing failure rather than a clear refusal.
 */
export function buildSpawnSpec(adapterType: string, ctx: CommandContext): SpawnSpec | null {
  const definition = getAdapter(adapterType);
  if (!definition) return null;

  switch (adapterType) {
    case "claude_local": {
      const args = [
        "-p",
        ctx.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--append-system-prompt-file",
        ctx.systemPromptPath,
      ];
      const model = text(ctx.config, "model");
      if (model) args.push("--model", model);
      if (ctx.config["dangerouslySkipPermissions"] === true) {
        args.push("--dangerously-skip-permissions");
      }
      const maxTurns = ctx.config["maxTurnsPerRun"];
      if (typeof maxTurns === "number" && maxTurns > 0) args.push("--max-turns", String(maxTurns));
      return { command: "claude", args: [...args, ...extraArgs(ctx.config)], output: "stream-json" };
    }

    case "codex_local": {
      const args = ["exec", ctx.prompt, "--json"];
      const model = text(ctx.config, "model");
      if (model) args.push("--model", model);
      const mode = text(ctx.config, "permissionMode");
      if (mode) args.push("--sandbox", mode);
      return { command: "codex", args: [...args, ...extraArgs(ctx.config)], output: "stream-json" };
    }

    case "process": {
      const command = text(ctx.config, "command");
      if (!command) return null;
      const raw = text(ctx.config, "args");
      const args = raw ? raw.split(",").map((arg) => arg.trim()).filter(Boolean) : [];
      // The prompt goes on stdin rather than the argument list: an argument
      // list is visible in the process table to every user on the machine.
      return { command, args, stdin: ctx.prompt, output: "text" };
    }

    default:
      return null;
  }
}

/** Fields whose change makes a resumed session meaningless. */
export const SESSION_INVALIDATING_FIELDS = ["model", "command", "permissionMode"];
