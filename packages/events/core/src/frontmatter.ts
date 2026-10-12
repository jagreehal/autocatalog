import { parse, stringify } from 'yaml';
import { jsonObjectSchema, type JsonObject } from './json';

// Frontmatter is a YAML block fenced by `---` at the very start of the file.
// A BOM ahead of it is common on Windows-authored documents.
// The closing fence sits on its own line, and an empty block has no lines at
// all, so the body between the fences is optional.
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface Frontmatter {
  data: JsonObject;
  /** The document with its frontmatter block removed. */
  content: string;
}

/**
 * Split a document into its frontmatter and its body.
 *
 * Replaces gray-matter, which is a frontmatter parser wrapped around engines
 * for JS, CoffeeScript and TOML that nothing here uses — and whose JavaScript
 * engine is a direct `eval`, so every site that bundles a loader inherits the
 * bundler warning for a code path this project never takes.
 *
 * YAML 1.2 rather than js-yaml's 1.1: an unquoted `2024-01-02` stays the string
 * the contract asked for instead of becoming a Date, and it matches how Astro
 * reads the same file.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const match = FRONTMATTER.exec(raw);

  if (!match) return { data: {}, content: raw };

  // An empty block parses to null, and a scalar one to something that is not
  // a mapping. Neither is frontmatter, and neither is an error. A YAML value
  // JSON has no word for, such as .inf or !!binary, becomes what JSON makes of
  // it rather than costing every other key in the block.
  const parsed = jsonObjectSchema.safeParse(
    JSON.parse(JSON.stringify(parse(match[1] ?? '') ?? null)),
  );

  return {
    data: parsed.success ? parsed.data : {},
    content: raw.slice(match[0].length),
  };
}

/**
 * Write a document back out, frontmatter first.
 *
 * The YAML is serialised rather than hand-built, so a title containing a colon
 * comes back as the title it went in as.
 */
export function stringifyFrontmatter<T extends Record<string, unknown>>(
  data: T,
  content: string,
): string {
  const body = content.startsWith('\n') ? content.slice(1) : content;

  return `---\n${stringify(data).trimEnd()}\n---\n${body}`;
}
