import { z } from 'zod';
import { lastChanged, sourceUrl } from './git';
import { type Doc, readDocs, type ReadDocsOptions } from './read-docs';
import { type Frontmatter, frontmatterSchema, resolveFrontmatterContract } from './frontmatter';
import { type DocKind, kindFailure, kindValidator, resolveDocKinds, textField } from './kinds';

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
  /** The document's kind (`adr`, `runbook`, ...), or null for a plain document. */
  kind: z.string().nullable(),
  /** The value of its kind's status field, when it has one. */
  status: z.string().nullable(),
  /** The value of its kind's date field, when it has one. */
  date: z.string().nullable(),
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
  /**
   * Path to the organisation's conventions file. Omit and the convention looks
   * for `contracts/autocatalog.conventions.json` the way it finds the contract.
   */
  conventionsPath?: string;
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
  const { valid, invalid } = validateDocs(root, options);

  if (invalid.size > 0) throw new DocsManifestError([...invalid.values()].flat());

  const manifest: DocsManifest = {};

  for (const doc of valid) {
    manifest[doc.id] = {
      owner: doc.front.owner,
      title: doc.front.title,
      updated: options.includeDates === false ? null : lastChanged(root, doc.file),
      source: options.includeDates === false ? null : sourceUrl(root, doc.file),
      edit: options.includeDates === false ? null : sourceUrl(root, doc.file, 'edit'),
      linkedFrom: [],
      kind: doc.kind?.id ?? null,
      status: textField(doc.data, doc.kind?.statusField),
      date: textField(doc.data, doc.kind?.dateField),
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

/**
 * Each repository with a document that breaks the contract, and what is wrong.
 * A company site leaves those repositories' documents out (pass them as
 * `exclude`) instead of failing every team's build; the repository's own
 * `ac docs check` is what refuses the merge.
 */
export function invalidDocuments(
  root: string,
  options: BuildDocsManifestOptions = {},
): Map<string, string[]> {
  return validateDocs(root, options).invalid;
}

/** The documents that keep to the contract, and how many were left out for breaking it. */
export function validDocuments(root: string, options: BuildDocsManifestOptions = {}) {
  const { valid, invalid } = validateDocs(root, options);

  return { valid, leftOut: [...invalid.values()].flat().length };
}

type ValidDoc = Doc & { front: Frontmatter; kind: DocKind | null };

/** The documents that keep to the contract, and what is wrong with the rest, by repository. */
interface ValidatedDocs {
  valid: ValidDoc[];
  invalid: Map<string, string[]>;
}

function validateDocs(root: string, options: BuildDocsManifestOptions): ValidatedDocs {
  const invalid = new Map<string, string[]>();

  const fail = (doc: Pick<Doc, 'file' | 'repo'>, message: string) =>
    invalid.set(doc.repo, [...(invalid.get(doc.repo) ?? []), message]);

  // A document that does not parse is named with its repository, like one that breaks the contract.
  const docs = readDocs(root, {
    ...options,
    onUnreadable: (doc, message) => fail(doc, `${doc.file}: ${message}`),
  });

  const validate = kindValidator(
    resolveFrontmatterContract(root, options.schemaPath).schema,
    resolveDocKinds(root, options.conventionsPath).kinds,
  );

  const valid: ValidDoc[] = [];

  for (const doc of docs) {
    const { kind, issues } = validate(doc);

    if (issues.length > 0) {
      for (const issue of issues) fail(doc, kindFailure(doc.file, kind, issue));
      continue;
    }

    // The contract is the company's own and may not declare the fields the
    // index is built from, so they are checked here rather than assumed.
    const front = frontmatterSchema.safeParse(doc.data);

    if (!front.success) {
      for (const issue of front.error.issues) {
        fail(
          doc,
          `${doc.file}: ${issue.path.join('.') || '(root)'}: ${issue.message} (the docs index is built from title and owner, whatever the frontmatter contract requires)`,
        );
      }

      continue;
    }

    valid.push({ ...doc, front: front.data, kind });
  }

  return { valid, invalid };
}
