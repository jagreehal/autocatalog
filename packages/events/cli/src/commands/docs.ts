import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import {
  createAgentsResourceGraph,
  loadCatalog as loadAgentsCatalog,
} from 'autocatalog-agents-core';
import {
  type CatalogResource,
  createEventResourceGraph,
  findCatalogRoots,
  loadRepositoryEvents,
  resourceKey,
} from 'autocatalog-core';
import {
  buildDocsManifest,
  checkDocs,
  DEFAULT_FRONTMATTER_SCHEMA,
  defaultConventionsFile,
  DOCS_CONVENTIONS_PATH,
  DOCS_MANIFEST_PATH,
  DOCS_SCHEMA_PATH,
  DocsManifestError,
  readFlows,
  syncFrontmatterContract,
} from 'autocatalog-docs-core';

/**
 * A path as a reader wants to see it: relative when that is genuinely shorter,
 * absolute when relative would be a run of `../../..` out of the tree.
 */
function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file);

  return relative.startsWith('..') ? file : relative;
}

export interface DocsCommandOptions {
  root: string;
  schema?: string;
  conventions?: string;
  manifest?: string;
  repo?: string;
  quiet?: boolean;
}

/**
 * What the checkout defines for a document's `about:` to name: each
 * repository's events, the services they infer, and its Agent system. A
 * catalog that will not load is `ac validate`'s failure to report, so here it
 * contributes nothing rather than failing the docs check twice.
 */
async function checkoutResources(root: string, repo?: string): Promise<CatalogResource[]> {
  const resources: CatalogResource[] = [];

  for (const { name, dir, nested, duplicateOf } of findCatalogRoots(root, { name: repo })) {
    if (duplicateOf !== undefined) continue;

    const graph = await loadRepositoryEvents(dir, { ownersWithin: root, exclude: nested })
      .then((events) => createEventResourceGraph(events, { repository: name }))
      .catch(() => undefined);

    resources.push(...(graph?.resources ?? []));

    if (existsSync(path.join(dir, 'agents'))) {
      const graph = await loadAgentsCatalog(dir)
        .then((catalog) => createAgentsResourceGraph(catalog, { repository: name }))
        .catch(() => undefined);

      resources.push(...(graph?.resources ?? []));
    }
  }

  // One resource per identity, as the composed site has it: a service two
  // repositories both name is one service there, not an ambiguity here.
  return [...new Map(resources.map((resource) => [resourceKey(resource.ref), resource])).values()];
}

/**
 * Validate every repository-owned `docs/` root under `root`, plus the links
 * between them. Exit code is what CI reads.
 */
export async function runDocsCheck(opts: DocsCommandOptions): Promise<number> {
  const resources = await checkoutResources(opts.root, opts.repo);

  const result = checkDocs(opts.root, {
    schemaPath: opts.schema,
    conventionsPath: opts.conventions,
    manifestPath: opts.manifest,
    repo: opts.repo,
    resources,
  });

  // A flow that does not hold together is left off the site, so it fails
  // here, where it can be fixed before merging. A step naming another
  // repository's resource is the composed site's to resolve: one checkout
  // does not hold every repository's events, services and agents.
  const flows = readFlows(
    findCatalogRoots(opts.root, { name: opts.repo }).flatMap(({ repository, dir, duplicateOf }) =>
      duplicateOf === undefined ? [{ repository, dir }] : [],
    ),
    { resources, relationships: [] },
    { deferMissing: true },
  );

  const failures = [...result.failures, ...flows.failures];

  // Which rules were applied is the first question a failure raises, so it is
  // reported on both paths — a reader fixing a failing check needs the contract
  // more than a reader watching one pass.
  const contract = [
    result.contractFile
      ? `  contract: ${displayPath(result.contractFile)}`
      : `  contract: built-in default — run 'ac docs init-schema' to own it`,
    result.conventionsFile
      ? `  kinds: ${displayPath(result.conventionsFile)}`
      : `  kinds: built-in adr, runbook, incident — run 'ac docs init-conventions' to own them`,
  ].join('\n');

  if (failures.length > 0) {
    for (const failure of failures) console.error(`${kleur.red('✗')} ${failure}`);
    console.error(kleur.dim(contract));

    return 1;
  }

  if (!opts.quiet) {
    const scope = result.checkedCrossRepoLinks
      ? 'schema + links'
      : 'schema only, no published index yet';

    const flowCount = flows.flows.length > 0 ? `, ${flows.flows.length} flow(s)` : '';

    console.log(
      kleur.green(`✓ ${result.docs} doc(s)${flowCount} across ${result.repos} repo(s) (${scope})`),
    );
    console.log(kleur.dim(contract));
  }

  return 0;
}

/**
 * Write the default contract into `contracts/` so the organisation owns it.
 *
 * Scaffolding beats layering: one file that anything reading JSON Schema can
 * read, edited in place, with no merge order between a default and an override
 * for anyone to reason about.
 */
export async function runDocsInitSchema(opts: DocsCommandOptions): Promise<number> {
  const out = opts.schema ?? path.join(path.resolve(opts.root), DOCS_SCHEMA_PATH);

  try {
    await fs.access(out);
    console.error(
      `${kleur.red('✗')} ${displayPath(out)} already exists — edit it, or pass --schema to write elsewhere`,
    );

    return 1;
  } catch {
    // Absent, which is the case this command is for.
  }

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(DEFAULT_FRONTMATTER_SCHEMA, null, 2)}\n`);

  if (!opts.quiet) {
    console.log(kleur.green(`✓ ${displayPath(out)}`));
    console.log(
      kleur.dim(
        '  Commit it. Add fields, tighten types, or set additionalProperties to false;\n' +
          '  ac docs check and the site both read it from here without a flag.\n' +
          '  Add "$id" with the URL this file is published at, and repositories that\n' +
          '  copy it can run ac docs sync-schema to find out when it changes.',
      ),
    );
  }

  return 0;
}

/**
 * Write the built-in document kinds into `contracts/` so the organisation owns
 * them, the way `init-schema` hands over the frontmatter contract.
 */
export async function runDocsInitConventions(opts: DocsCommandOptions): Promise<number> {
  const out = opts.conventions ?? path.join(path.resolve(opts.root), DOCS_CONVENTIONS_PATH);

  if (existsSync(out)) {
    console.error(
      `${kleur.red('✗')} ${displayPath(out)} already exists — edit it, or pass --conventions to write elsewhere`,
    );

    return 1;
  }

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(defaultConventionsFile(), null, 2)}\n`);

  if (!opts.quiet) {
    console.log(kleur.green(`✓ ${displayPath(out)}`));
    console.log(
      kleur.dim(
        '  Commit it in the repository that owns your conventions, usually the handbook.\n' +
          '  Add a kind, change a folder, label or schema, or set a kind to false to turn\n' +
          '  it off; ac docs check and the site both read it from here without a flag.',
      ),
    );
  }

  return 0;
}

/**
 * Compare this repository's copy of the contract with the organisation's.
 *
 * Deliberately separate from `ac docs check`: validation must work offline and
 * on every pull request, while this is the step that reaches out, and belongs
 * where a network call is acceptable.
 */
export async function runDocsSyncSchema(
  opts: DocsCommandOptions & { from?: string; write?: boolean },
): Promise<number> {
  const result = await syncFrontmatterContract(opts.root, {
    from: opts.from,
    write: opts.write,
  });

  const where = displayPath(result.file);

  switch (result.status) {
    case 'missing-local':
      console.error(`${kleur.red('✗')} no contract at ${where}`);
      console.error(
        kleur.dim(
          '  A repository publishing docs commits the organisation’s contract here.\n' +
            '  Copy it from the repository that owns it, or run ac docs init-schema\n' +
            '  if this repository is the one that owns it.',
        ),
      );

      return 1;

    case 'no-source':
      console.error(`${kleur.red('✗')} ${where} does not say where it came from`);
      console.error(
        kleur.dim(
          '  Add "$id" with the URL the canonical contract is published at, or pass\n' +
            '  --from <url|path> to name it explicitly.',
        ),
      );

      return 1;

    case 'unreachable':
      // Never pass quietly here: a sync that cannot read upstream has checked
      // nothing, and reporting success would be the whole point defeated.
      console.error(`${kleur.red('✗')} could not read ${result.source}: ${result.error}`);

      return 1;

    case 'in-sync':
      if (!opts.quiet) {
        console.log(kleur.green(`✓ ${where} matches ${result.source}`));
      }

      return 0;

    case 'written':
      console.log(kleur.green(`✓ updated ${where} from ${result.source}`));

      for (const change of result.changes) console.log(`  ${change}`);
      console.log(
        kleur.dim('  Run ac docs check — documents may no longer satisfy it — then commit it.'),
      );

      return 0;

    case 'drifted':
      console.error(`${kleur.red('✗')} ${where} has drifted from ${result.source}`);

      for (const change of result.changes) console.error(`  ${change}`);
      console.error(kleur.dim('  Run with --write to take the upstream contract.'));

      return 1;
  }
}

/** Publish the aggregated index at the path the convention reserves. */
export async function runDocsManifest(opts: DocsCommandOptions): Promise<number> {
  let manifest;

  try {
    manifest = buildDocsManifest(opts.root, {
      schemaPath: opts.schema,
      conventionsPath: opts.conventions,
      repo: opts.repo,
    });
  } catch (error) {
    if (!(error instanceof DocsManifestError)) throw error;

    for (const failure of error.failures) console.error(`${kleur.red('✗')} ${failure}`);
    console.error(kleur.red(error.message));

    return 1;
  }

  const out = opts.manifest ?? path.join(path.resolve(opts.root), DOCS_MANIFEST_PATH);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!opts.quiet) {
    const ids = Object.keys(manifest);
    const repos = new Set(ids.map((id) => id.split('/')[0]));
    console.log(
      kleur.green(`✓ ${displayPath(out)}: ${ids.length} doc(s) across ${repos.size} repo(s)`),
    );
    console.log(
      kleur.dim('  Publish it where other repositories’ ac docs check --manifest can fetch it.'),
    );
  }

  return 0;
}
