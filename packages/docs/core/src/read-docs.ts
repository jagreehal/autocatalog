import fs from 'node:fs';
import path from 'node:path';
import {
  type CatalogRoot,
  findCatalogRoots,
  type JsonObject,
  parseFrontmatter,
  stringifyFrontmatter,
} from 'autocatalog-core';

/**
 * One authored document, addressed by its path rather than a declared id.
 *
 *   payments-service/docs/runbook.md    -> payments-service/runbook
 *   payments-service/docs/ops/replay.md -> payments-service/ops/replay
 *   acme-platform/services/orders/docs/runbook.md -> orders/runbook
 *
 * An id that lives in frontmatter can disagree with where the file actually is.
 * A path cannot.
 */
export interface Doc {
  /** `<repo>/<path without docs/ and without .md or .mdx>` */
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
   * Treat the root itself as a publishing repository under this name. Defaults
   * to the root directory's own name when the root is one repository.
   */
  repo?: string;
  /**
   * The root's Repository identity, when it is not `repo`. A package below the
   * root cannot publish under it.
   */
  repository?: string;
}

/** Where the documents are and how a matched path becomes an id. */
export interface DocsLayout {
  /** Absolute aggregation root. Every path is relative to it. */
  root: string;
  /** Each repository or package with a `docs/` folder, one per name. */
  roots: CatalogRoot[];
  /** Glob pattern, relative to the root and always forward-slashed. */
  pattern: string;
  /** The repository whose `docs/` holds a path, or undefined for none. */
  rootFor(file: string): CatalogRoot | undefined;
  /** Repository that owns a matched path. */
  repoFor(file: string): string;
  /** Id for a matched path: `<repo>/<path without docs/ and without .md>`. */
  idFor(file: string): string;
}

const docsDir = (root: CatalogRoot) => (root.path ? `${root.path}/docs/` : 'docs/');

/**
 * Find every `docs/` and decide how ids are derived from it.
 *
 * Split out because more than one reader has to agree: the CLI check, the
 * manifest builder, and an Astro content collection all address the same
 * document, and an id derived two ways is an id that eventually disagrees.
 */
export function resolveDocsLayout(root: string, options: ReadDocsOptions = {}): DocsLayout {
  const absolute = path.resolve(root);

  // Two folders of one name would publish the same ids; the site names the
  // later one and leaves all of it out, and so does this.
  const roots = findCatalogRoots(absolute, {
    name: options.repo,
    repository: options.repository,
  }).filter(
    (candidate) =>
      candidate.duplicateOf === undefined && fs.existsSync(path.join(candidate.dir, 'docs')),
  );

  const dirs = roots.map((candidate) => docsDir(candidate).slice(0, -1));

  const rootFor = (file: string) => roots.find((candidate) => file.startsWith(docsDir(candidate)));

  const repoFor = (file: string): string => {
    const owner = rootFor(file);

    if (!owner) throw new Error(`${file} is not in any repository's docs/`);

    return owner.name;
  };

  return {
    root: absolute,
    roots,
    pattern: `${dirs.length > 1 ? `{${dirs.join(',')}}` : (dirs[0] ?? 'docs')}/**/*.{md,mdx}`,
    rootFor,
    repoFor,
    idFor(file: string): string {
      const rest = file.slice(docsDir(rootFor(file)!).length);

      return `${repoFor(file)}/${rest.replace(/\.mdx?$/, '')}`;
    },
  };
}

/**
 * Read every document the convention exposes under the aggregation root.
 *
 * Works in every shape without being told which: sibling checkouts, packages
 * inside a monorepo, or one repository running its own CI check.
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
