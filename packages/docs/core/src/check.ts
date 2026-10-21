import fs from 'node:fs';
import path from 'node:path';
import type { CatalogResource } from 'autocatalog-core';
import { z } from 'zod';
import { resolveAbout } from './about';
import { DOCS_MANIFEST_PATH } from './manifest';
import { frontmatterSchema, resolveFrontmatterContract } from './frontmatter';
import { kindFailure, kindValidator, resolveDocKinds, supersession } from './kinds';
import { readDocs, type ReadDocsOptions } from './read-docs';

export interface CheckDocsOptions extends ReadDocsOptions {
  /**
   * Path to a committed JSON Schema. Omit and the convention looks for
   * `contracts/docs-frontmatter.json` at the root, falling back to the built-in
   * contract so a company that has not written one yet still gets an index.
   */
  schemaPath?: string;
  /**
   * Path to the organisation's conventions file. Omit and the convention looks
   * for `contracts/autocatalog.conventions.json` the way it finds the contract,
   * falling back to the built-in kinds.
   */
  conventionsPath?: string;
  /**
   * Published index to resolve cross-repository links against. Omit and
   * cross-repo targets go unchecked, which is correct before the first index
   * exists rather than a reason to fail every link.
   */
  manifestPath?: string;
  /**
   * What this checkout defines for `about:` to name. A reference to a kind
   * none of these are lives in another repository and goes unchecked here;
   * the composed site resolves it.
   */
  resources?: CatalogResource[];
}

export interface CheckDocsResult {
  failures: string[];
  docs: number;
  repos: number;
  /** False when no manifest was available, so cross-repo links went unchecked. */
  checkedCrossRepoLinks: boolean;
  /**
   * The contract that was enforced, or null for the built-in default. Reported
   * because "which rules did this pass" is the first question a failing build
   * raises, and the answer is a file somebody can open.
   */
  contractFile: string | null;
  /** The conventions file whose kinds were enforced, or null for the built-in kinds. */
  conventionsFile: string | null;
}

const relatedOnly = frontmatterSchema.pick({ related: true });

const aboutOnly = frontmatterSchema.pick({ about: true });

// Only the ids and their backlinks are read, so an index written before a field
// was added still resolves links.
const publishedIndex = z.record(z.string(), z.looseObject({ linkedFrom: z.array(z.string()) }));

function readManifest(
  manifestPath: string | undefined,
  root: string,
): z.infer<typeof publishedIndex> | null {
  const resolved = manifestPath ?? path.join(root, DOCS_MANIFEST_PATH);

  if (!fs.existsSync(resolved)) return null;

  return publishedIndex.parse(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

/**
 * The check a publishing repository runs against its own `docs/` in its own CI,
 * so a bad document fails the pull request that introduced it rather than a
 * nightly build nobody watches.
 */
export function checkDocs(root: string, options: CheckDocsOptions = {}): CheckDocsResult {
  const docs = readDocs(root, options);
  const contract = resolveFrontmatterContract(root, options.schemaPath);
  const conventions = resolveDocKinds(root, options.conventionsPath);
  const validate = kindValidator(contract.schema, conventions.kinds);
  const manifest = readManifest(options.manifestPath, root);

  const present = new Set(docs.map((doc) => doc.id));
  // What this checkout is answerable for: derived from what is on disk, so no
  // caller has to declare it. One repo in its own CI, many in a combined index.
  const owned = new Set(docs.map((doc) => doc.repo));
  const failures: string[] = [];
  const kinds = new Set<string>(options.resources?.map((resource) => resource.ref.kind));

  for (const doc of docs) {
    const { kind, issues } = validate(doc);

    if (issues.length > 0) {
      for (const issue of issues) failures.push(kindFailure(doc.file, kind, issue));
      continue;
    }

    // Fenced blocks are excluded: documentation teaches this rule by showing
    // the wrong form, and flagging its own example would be absurd.
    const prose = doc.body.replace(/^```[\s\S]*?^```/gm, '');

    for (const [, link] of prose.matchAll(/]\((\.\.\/\.\.\/[^)]+)\)/g)) {
      failures.push(
        `${doc.file}: links into another repo by path (${link}) — declare it in related: instead`,
      );
    }

    // Only `related` is read here, so a company contract that renames other
    // built-in fields still passes the check.
    const front = relatedOnly.safeParse(doc.data);

    if (!front.success) {
      failures.push(`${doc.file}: related: must be an array of document ids`);
      continue;
    }

    // A decision names the one it replaces by id too, so a renamed ADR breaks
    // its chain as loudly as a renamed runbook breaks a `related:` link. The
    // kind's own schema has already said these are arrays of ids.
    const succession = kind ? supersession(doc.data) : { supersedes: [], supersededBy: [] };

    const references = [
      ['related', front.data.related ?? []],
      ['supersedes', succession.supersedes],
      ['supersededBy', succession.supersededBy],
    ] as const;

    for (const [field, targets] of references) {
      for (const target of targets) {
        // Own documents resolve against the filesystem. Cross-repo targets exist
        // only in the published index, so before one exists there is nothing to
        // check against. A stale index rejects a link that would have worked and
        // never accepts one that is broken, so publish the target first.
        const targetRepo = target.split('/')[0] ?? '';

        const dangling = owned.has(targetRepo)
          ? !present.has(target)
          : manifest !== null && !(target in manifest);

        if (dangling) failures.push(`${doc.file}: ${field} '${target}' does not resolve`);
      }
    }

    const about = aboutOnly.safeParse(doc.data);

    if (!about.success) {
      failures.push(`${doc.file}: about: must be an array of kind/id references`);
      continue;
    }

    for (const target of about.data.about ?? []) {
      if (!kinds.has(target.split('/')[0] ?? '')) continue;
      const resolution = resolveAbout(target, options.resources ?? [], doc.repo);

      if ('failure' in resolution) failures.push(`${doc.file}: ${resolution.failure}`);
    }
  }

  // Renaming or deleting a document breaks whoever links to it, and the index
  // is the only place that records who that is.
  for (const [id, entry] of Object.entries(manifest ?? {})) {
    const repo = id.split('/')[0] ?? '';

    if (owned.has(repo) && !present.has(id) && entry.linkedFrom.length > 0) {
      failures.push(`${id} no longer exists but is linked from ${entry.linkedFrom.join(', ')}`);
    }
  }

  return {
    failures,
    docs: docs.length,
    repos: owned.size,
    checkedCrossRepoLinks: manifest !== null,
    contractFile: contract.file,
    conventionsFile: conventions.file,
  };
}
