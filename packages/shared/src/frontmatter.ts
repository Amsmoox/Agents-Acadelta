// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Mharrech Ayoub <mharrech.ayoub@gmail.com>

/**
 * A deliberately small YAML front-matter reader and writer.
 *
 * It understands exactly what a skill header needs: plain scalars, quoted
 * strings, and block sequences. Everything else — anchors, aliases, tags, flow
 * collections, nested maps, multi-line block scalars, comments — it refuses to
 * claim it understands.
 *
 * That refusal is the point. A structured editor that cannot reproduce the bytes
 * it read will silently destroy the parts it did not understand the first time
 * someone saves. `analyzeFrontmatter` exists so the editor can fall back to
 * editing raw text instead, which is always safe.
 */

export type FrontmatterValue = string | number | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export type ParsedDocument = {
  frontmatter: Frontmatter;
  body: string;
  /** True when re-serialising the parsed form reproduces the original bytes. */
  roundTrippable: boolean;
};

const DELIMITER = "---";

function splitDocument(source: string): { header: string | null; body: string } {
  const normalized = source.replace(/^\uFEFF/, "");
  if (!normalized.startsWith(`${DELIMITER}\n`) && !normalized.startsWith(`${DELIMITER}\r\n`)) {
    return { header: null, body: source };
  }

  const rest = normalized.slice(normalized.indexOf("\n") + 1);
  const closing = rest.search(/^---[ \t]*(\r?\n|$)/m);
  if (closing === -1) return { header: null, body: source };

  const header = rest.slice(0, closing);
  const afterClose = rest.slice(closing);
  const body = afterClose.slice(afterClose.indexOf("\n") + 1);
  return { header, body: afterClose.includes("\n") ? body : "" };
}

function parseScalar(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
    (value.startsWith("'") && value.endsWith("'") && value.length > 1)
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

/** Constructs this reader does not model; their presence forces raw editing. */
const UNSUPPORTED = /(^|\s)(&\w|\*\w|!!|<<:)|^\s*[\w"'-]+\s*:\s*[[{]|^\s*[\w-]+\s*:\s*[|>]/;

export function analyzeFrontmatter(source: string): { roundTrippable: boolean; reason?: string } {
  const { header } = splitDocument(source);
  if (header === null) return { roundTrippable: true };

  for (const line of header.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      if (line.trimStart().startsWith("#")) {
        return { roundTrippable: false, reason: "comments" };
      }
      continue;
    }
    if (UNSUPPORTED.test(line)) {
      return { roundTrippable: false, reason: "unsupported YAML" };
    }
    // Nesting beyond a top-level key with a block sequence.
    if (/^\s{2,}\S/.test(line) && !line.trimStart().startsWith("- ")) {
      return { roundTrippable: false, reason: "nested maps" };
    }
  }
  return { roundTrippable: true };
}

export function parseFrontmatter(source: string): ParsedDocument {
  const { header, body } = splitDocument(source);
  if (header === null) return { frontmatter: {}, body: source, roundTrippable: true };

  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of header.split("\n")) {
    if (line.trim() === "") continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      const existing = frontmatter[currentKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(String(parseScalar(item[1] ?? "")));
      frontmatter[currentKey] = list;
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;

    const [, key = "", raw = ""] = pair;
    if (raw.trim() === "") {
      currentKey = key;
      frontmatter[key] = [];
    } else {
      currentKey = null;
      frontmatter[key] = parseScalar(raw);
    }
  }

  // An empty block sequence is indistinguishable from an empty scalar; drop it
  // rather than inventing a value the author did not write.
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value) && value.length === 0) delete frontmatter[key];
  }

  return { frontmatter, body, roundTrippable: analyzeFrontmatter(source).roundTrippable };
}

function serializeValue(value: FrontmatterValue): string[] {
  if (Array.isArray(value)) return value.map((item) => `  - ${item}`);
  return [];
}

export function serializeFrontmatter(frontmatter: Frontmatter, body: string): string {
  const lines: string[] = [DELIMITER];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`, ...serializeValue(value));
      continue;
    }
    const needsQuotes = typeof value === "string" && /^[\s>|@`%*&!#-]|: |^$/.test(value);
    lines.push(`${key}: ${needsQuotes ? JSON.stringify(value) : value}`);
  }

  lines.push(DELIMITER, "");
  return `${lines.join("\n")}${body}`;
}
