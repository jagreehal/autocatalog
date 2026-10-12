import { z } from 'zod';
import { lastChanged, sourceUrl } from './git';
import { type Doc, readDocs, type ReadDocsOptions } from './read-docs';
import {
  type Frontmatter,
  frontmatterSchema,
  frontmatterValidator,
  resolveFrontmatterContract,
} from './frontmatter';

/** The published path the convention reserves for the aggregated index. */
export const DOCS_MANIFEST_PATH = 'contracts/docs-manifest.json';

const docsManifestEntrySchema = z.object({
  owner: z.string(),
  title: z.string(),
  /** ISO date of the last commit touching the file, or null if git cannot say. */
  updated: z.string().nullable(),
  /** The file on its repository's web host, or null when there is no web origin. */
  source: z.string().nullable(),
  /** The file in its web host's editor, or null when there is no web origin. */
  edit: z.string().nullable(),
  /** Ids of documents declaring this one in `related`. Sorted for determinism. */
  linkedFrom: z.array(z.string()),
});

const docsManifestSchema = z.record(z.string(), docsManifestEntrySchema);

export type DocsManifestEntry = z.infer<typeof docsManifestEntrySchema>;

export type DocsManifest = z.infer<typeof docsManifestSchema>;

export interface BuildDocsManifestOptions extends ReadDocsOptions {
  /**
   * Path to a committed JSON Schema. Omit and the convention looks for
   * `contracts/docs-frontmatter.json` at the root, falling back to the built-in
   * contract.
   */
  schemaPath?: string;
  /** Skip git lookups. Used by tests and by callers that only need structure. */
  includeDates?: boolean;
}

export class DocsManifestError extends Error {
  constructor(readonly failures: string[]) {
    super(`refusing to publish a manifest for ${failures.length} invalid document(s)`);
    this.name = 'DocsManifestError';
  }
}

/**
 * Build the aggregated index.
 *
 * The aggregator is a producer like any other, so it refuses to publish a
 * manifest describing documents that do not satisfy the contract. Publishing a
 * partial index would make the two questions the manifest exists to answer —
 * do my links resolve, and who links to the file I am about to rename —
 * quietly unreliable.
 */
export function buildDocsManifest(
  root: string,
  options: BuildDocsManifestOptions = {},
): DocsManifest {
  const docs = readDocs(root, options);

  const validator = frontmatterValidator(
    resolveFrontmatterContract(root, options.schemaPath).schema,
  );

  const failures: string[] = [];
  const valid: Array<Doc & { front: Frontmatter }> = [];

  for (const doc of docs) {
    const issues = validator.validate(doc.data);

    if (issues.length > 0) {
      for (const issue of issues) failures.push(`${doc.file}: ${issue.path}: ${issue.message}`);
      continue;
    }

    // The contract is the company's own and may not declare the fields the
    // index is built from, so they are checked here rather than assumed.
    const front = frontmatterSchema.safeParse(doc.data);

    if (!front.success) {
      for (const issue of front.error.issues) {
        failures.push(
          `${doc.file}: ${issue.path.join('.') || '(root)'}: ${issue.message} (the docs index is built from title and owner, whatever the frontmatter contract requires)`,
        );
      }

      continue;
    }

    valid.push({ ...doc, front: front.data });
  }

  if (failures.length > 0) throw new DocsManifestError(failures);

  const manifest: DocsManifest = {};

  for (const doc of valid) {
    manifest[doc.id] = {
      owner: doc.front.owner,
      title: doc.front.title,
      updated: options.includeDates === false ? null : lastChanged(root, doc.file),
      source: options.includeDates === false ? null : sourceUrl(root, doc.file),
      edit: options.includeDates === false ? null : sourceUrl(root, doc.file, 'edit'),
      linkedFrom: [],
    };
  }

  // Backlinks are derived, never authored: the target of a link cannot be
  // expected to know who points at it.
  for (const doc of valid) {
    for (const target of doc.front.related ?? []) {
      manifest[target]?.linkedFrom.push(doc.id);
    }
  }

  for (const entry of Object.values(manifest)) entry.linkedFrom.sort();

  return manifest;
}
