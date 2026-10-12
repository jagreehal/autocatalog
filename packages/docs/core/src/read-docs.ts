import fs from 'node:fs';
import path from 'node:path';
import { type JsonObject, parseFrontmatter, stringifyFrontmatter } from 'autocatalog-core';

/**
 * One authored document, addressed by its path rather than a declared id.
 *
 *   payments-service/docs/runbook.md    -> payments-service/runbook
 *   payments-service/docs/ops/replay.md -> payments-service/ops/replay
 *
 * An id that lives in frontmatter can disagree with where the file actually is.
 * A path cannot.
 */
export interface Doc {
  /** `<repo>/<path without docs/ and without .md>` */
  id: string;
  /** Publishing repository that owns the file. */
  repo: string;
  /** Path relative to the aggregation root, with forward slashes. */
  file: string;
  /** Parsed frontmatter, deliberately unvalidated — checkDocs reports why. */
  data: JsonObject;
  /** Markdown body with frontmatter stripped. */
  body: string;
}

export interface ReadDocsOptions {
  /**
   * Treat the root itself as a single publishing repository under this name,
   * instead of aggregating every `<repo>/docs` tree across sibling repositories.
   * Defaults to the root directory's own name when `<root>/docs` exists.
   */
  repo?: string;
}

/** Where the documents are and how a matched path becomes an id. */
export interface DocsLayout {
  /** Absolute aggregation root. Every path is relative to it. */
  root: string;
  /** True when the root is one repository publishing its own `docs/`. */
  single: boolean;
  /** Glob pattern, relative to the root and always forward-slashed. */
  pattern: string;
  /** Repository that owns a matched path. */
  repoFor(file: string): string;
  /** Id for a matched path: `<repo>/<path without docs/ and without .md>`. */
  idFor(file: string): string;
}

/**
 * Decide which shape the root is in, and how ids are derived from it.
 *
 * Split out because more than one reader has to agree: the CLI check, the
 * manifest builder, and an Astro content collection all address the same
 * document, and an id derived two ways is an id that eventually disagrees.
 */
export function resolveDocsLayout(root: string, options: ReadDocsOptions = {}): DocsLayout {
  const absolute = path.resolve(root);
  const single = options.repo !== undefined || fs.existsSync(path.join(absolute, 'docs'));
  const defaultRepo = options.repo ?? path.basename(absolute);

  const repoFor = (file: string): string =>
    // Single-repo layout has no leading repo segment; supply it.
    single ? defaultRepo : file.split('/')[0]!;

  return {
    root: absolute,
    single,
    pattern: single ? 'docs/**/*.md' : '*/docs/**/*.md',
    repoFor,
    idFor(file: string): string {
      const rest = file.split('/').slice(single ? 1 : 2);

      return `${repoFor(file)}/${rest.join('/').replace(/\.md$/, '')}`;
    },
  };
}

/**
 * Read every document the convention exposes under the aggregation root.
 *
 * Works in both shapes without being told which: a company index sees many
 * sibling repositories, while a single repository running its own CI check sees
 * only its own `docs/`. Requiring callers to know the difference is the kind of
 * config that turns a convention into a framework.
 */
export function readDocs(root: string, options: ReadDocsOptions = {}): Doc[] {
  const layout = resolveDocsLayout(root, options);

  return fs
    .globSync(layout.pattern, { cwd: layout.root })
    .map((entry) => entry.split(path.sep).join('/'))
    .sort()
    .map((file) => {
      const parsed = parseFrontmatter(fs.readFileSync(path.join(layout.root, file), 'utf8'));

      return {
        id: layout.idFor(file),
        repo: layout.repoFor(file),
        file,
        data: parsed.data,
        body: parsed.content,
      };
    });
}

/**
 * Serialise a document back to markdown, for the raw twin published at
 * `<url>.md`.
 *
 * Written by the library that parsed it, so a title containing a colon
 * survives the round trip. Hand-built frontmatter is exactly how that breaks.
 */
export function docToMarkdown(data: JsonObject, body: string): string {
  return stringifyFrontmatter(data, body);
}
