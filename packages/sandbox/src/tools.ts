// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * The commands a running agent has.
 *
 * Declared once, here, so the shim that executes them and the manifest that
 * describes them to the model cannot drift apart — a tool the prompt promises
 * and the shim does not have is worse than no tool at all.
 */

export type ToolSpec = {
  name: string;
  summary: string;
  usage: string;
  method: "GET" | "POST";
  path: (args: string[]) => string;
  /** Positional arguments become this body. Returns null for a GET. */
  body?: (args: string[], rest: string) => Record<string, unknown> | null;
  /** Minimum positional arguments, excluding the free-text tail. */
  minArgs: number;
};

export const TOOLS: ToolSpec[] = [
  {
    name: "whoami",
    summary: "Who you are, and the task you are working on right now.",
    usage: "whoami",
    method: "GET",
    path: () => "/agent/me",
    minArgs: 0,
  },
  {
    name: "team",
    summary: "The other agents on this project and what they are for.",
    usage: "team",
    method: "GET",
    path: () => "/agent/team",
    minArgs: 0,
  },
  {
    name: "project",
    summary: "The project brief, and every task in it.",
    usage: "project",
    method: "GET",
    path: () => "/agent/project",
    minArgs: 0,
  },
  {
    name: "tasks",
    summary: "List tasks on this project.",
    usage: "tasks [--mine]",
    method: "GET",
    path: (args) => (args.includes("--mine") ? "/agent/tasks?mine=true" : "/agent/tasks"),
    minArgs: 0,
  },
  {
    name: "task",
    summary: "Read one task in full, with its whole thread.",
    usage: "task <KEY>",
    method: "GET",
    path: (args) => `/agent/tasks/${encodeURIComponent(args[0] ?? "")}`,
    minArgs: 1,
  },
  {
    name: "create",
    summary: "File a task, for yourself or for another agent.",
    usage: 'create <agentId|-> <kind> "<title>" -- <description>',
    method: "POST",
    path: () => "/agent/tasks",
    body: (args, rest) => ({
      ...(args[0] && args[0] !== "-" ? { assigneeAgentId: args[0] } : {}),
      kind: args[1] ?? "standard",
      title: args[2] ?? "",
      ...(rest ? { description: rest } : {}),
    }),
    minArgs: 3,
  },
  {
    name: "comment",
    summary: "Say something on a task. Everyone can read it.",
    usage: "comment <KEY> <intent> -- <text>",
    method: "POST",
    path: (args) => `/agent/tasks/${encodeURIComponent(args[0] ?? "")}/comment`,
    body: (args, rest) => ({ intent: args[1] ?? "note", body: rest }),
    minArgs: 2,
  },
  {
    name: "status",
    summary: "Move a task. A review verdict needs a reason.",
    usage: "status <KEY> <in_progress|in_review|blocked|done> -- <comment>",
    method: "POST",
    path: (args) => `/agent/tasks/${encodeURIComponent(args[0] ?? "")}/status`,
    body: (args, rest) => ({ status: args[1] ?? "", ...(rest ? { comment: rest } : {}) }),
    minArgs: 2,
  },
  {
    name: "assign",
    summary: "Hand a task to another agent.",
    usage: "assign <KEY> <agentId> -- <why>",
    method: "POST",
    path: (args) => `/agent/tasks/${encodeURIComponent(args[0] ?? "")}/assign`,
    body: (args, rest) => ({ agentId: args[1] ?? "", ...(rest ? { comment: rest } : {}) }),
    minArgs: 2,
  },
  {
    name: "objective",
    summary: "The standing objective you are carrying, if you have one.",
    usage: "objective",
    method: "GET",
    path: () => "/agent/objective",
    minArgs: 0,
  },
  {
    name: "finish",
    summary: "Ask to end your objective. Refused while work under it is still open.",
    usage: "finish -- <what was achieved>",
    method: "POST",
    path: () => "/agent/objective/finish",
    body: (_args, rest) => ({ summary: rest }),
    minArgs: 0,
  },
  {
    name: "block-on",
    summary: "Declare that this task cannot start until another one is done.",
    usage: "block-on <KEY> <blockerTaskId>",
    method: "POST",
    path: (args) => `/agent/tasks/${encodeURIComponent(args[0] ?? "")}/block-on`,
    body: (args) => ({ blockerTaskId: args[1] ?? "" }),
    minArgs: 2,
  },
];

export function findTool(name: string): ToolSpec | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export type Invocation =
  | { ok: true; method: "GET" | "POST"; path: string; body: Record<string, unknown> | null }
  | { ok: false; error: string };

/**
 * Turns a command line into a request.
 *
 * This runs on the server rather than in the shim. The shim then never has to
 * be reissued when a tool changes, and — more to the point — there is one
 * implementation of what each command means instead of two that drift.
 */
export function resolveInvocation(argv: string[]): Invocation {
  const [name, ...rest] = argv;
  if (!name) return { ok: false, error: "No command given. Run `agentco help`." };

  const tool = findTool(name);
  if (!tool) {
    return {
      ok: false,
      error: `No such command: ${name}. Available: ${TOOLS.map((t) => t.name).join(", ")}.`,
    };
  }

  const { args, rest: text } = splitArgs(rest);
  if (args.length < tool.minArgs) return { ok: false, error: `Usage: agentco ${tool.usage}` };

  return {
    ok: true,
    method: tool.method,
    path: tool.path(args),
    body: tool.body ? tool.body(args, text) : null,
  };
}

/**
 * Splits a shim invocation into positional arguments and the free-text tail.
 *
 * `--` separates them, because prose is what most of these carry and quoting a
 * paragraph through a shell is how a model loses half of it.
 */
export function splitArgs(argv: string[]): { args: string[]; rest: string } {
  const index = argv.indexOf("--");
  if (index === -1) return { args: argv, rest: "" };
  return { args: argv.slice(0, index), rest: argv.slice(index + 1).join(" ").trim() };
}

/** The section of the system prompt that tells an agent what it can do. */
export function buildToolManifest(command = "agentco"): string {
  const lines = TOOLS.map((tool) => `  ${command} ${tool.usage}\n      ${tool.summary}`);
  return [
    "## Your tools",
    "",
    `You act on the system by running \`${command}\` as a shell command. Every`,
    "command prints JSON. Nothing else you do is recorded — thinking about a task",
    "does not move it, and telling the user something in your output does not",
    "reach them. Only these do.",
    "",
    ...lines,
    "",
    "Notes:",
    "  - `--` separates arguments from free text. Everything after it is one string.",
    "  - Use the task KEY (like X-14), not its id, wherever a key is asked for.",
    "  - A review verdict is `status <KEY> done -- <why>` to accept, or",
    "    `status <KEY> in_progress -- <what to change>` to send it back. Both need a reason.",
    "  - Finish by moving your task. A run that ends without moving anything has",
    "    achieved nothing and will simply be tried again.",
  ].join("\n");
}
