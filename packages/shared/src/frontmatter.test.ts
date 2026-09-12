// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

import { describe, expect, it } from "vitest";
import { analyzeFrontmatter, parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";

const SKILL = `---
name: task-planning
description: Turn a request into a structured plan.
tags:
  - planning
  - delegation
---

# Task Planning

## When to use
`;

describe("parseFrontmatter", () => {
  it("reads scalars and block sequences", () => {
    const parsed = parseFrontmatter(SKILL);
    expect(parsed.frontmatter["name"]).toBe("task-planning");
    expect(parsed.frontmatter["description"]).toBe("Turn a request into a structured plan.");
    expect(parsed.frontmatter["tags"]).toEqual(["planning", "delegation"]);
  });

  it("keeps the body exactly, including its leading blank line", () => {
    expect(parseFrontmatter(SKILL).body).toBe("\n# Task Planning\n\n## When to use\n");
  });

  it("treats a document with no header as all body", () => {
    const parsed = parseFrontmatter("# Just markdown\n");
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("# Just markdown\n");
  });

  it("does not treat an unterminated header as front matter", () => {
    const parsed = parseFrontmatter("---\nname: x\n\n# body\n");
    expect(parsed.frontmatter).toEqual({});
  });

  it("strips quotes and reads booleans and numbers", () => {
    const parsed = parseFrontmatter(`---\na: "quoted: value"\nb: true\nc: 42\n---\n`);
    expect(parsed.frontmatter["a"]).toBe("quoted: value");
    expect(parsed.frontmatter["b"]).toBe(true);
    expect(parsed.frontmatter["c"]).toBe(42);
  });
});

describe("round trip", () => {
  it("reproduces a document it fully understands", () => {
    const parsed = parseFrontmatter(SKILL);
    expect(serializeFrontmatter(parsed.frontmatter, parsed.body)).toBe(SKILL);
    expect(parsed.roundTrippable).toBe(true);
  });

  it("quotes a value that would otherwise change meaning", () => {
    const out = serializeFrontmatter({ description: "a: b" }, "");
    expect(parseFrontmatter(out).frontmatter["description"]).toBe("a: b");
  });
});

describe("analyzeFrontmatter", () => {
  // Anything here must send the editor to raw text: a structured editor that
  // cannot reproduce these bytes destroys them on the first save.
  it.each([
    ["comments", `---\n# a note\nname: x\n---\n`],
    ["anchors", `---\nbase: &anchor\nname: x\n---\n`],
    ["aliases", `---\nname: *anchor\n---\n`],
    ["flow collections", `---\ntags: [a, b]\n---\n`],
    ["block scalars", `---\ndescription: |\n  long text\n---\n`],
    ["nested maps", `---\nmeta:\n  nested: value\n---\n`],
  ])("refuses to claim it round-trips %s", (_label, source) => {
    expect(analyzeFrontmatter(source).roundTrippable).toBe(false);
  });

  it("accepts what it does model", () => {
    expect(analyzeFrontmatter(SKILL).roundTrippable).toBe(true);
  });
});
