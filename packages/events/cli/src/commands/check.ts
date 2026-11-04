import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  builtInDiscoveryAdapters,
  CONSUMES_FILE,
  findCatalogRoots,
  scanCatalog,
} from 'autocatalog-core';
import kleur from 'kleur';
import { githubAnnotation } from './annotation';
import { runDocsCheck } from './docs';
import { runDrift } from './drift';
import { runValidate } from './validate';

type Check = readonly [string, () => Promise<number>];

export interface RunCheckOptions {
  root: string;
  /** Compare the repository's contracts against this ref, as a pull request does. */
  baseRef?: string | undefined;
  format: 'text' | 'github';
  /** Run the rules a repository commits, for a repository you trust. */
  allowCodeExecution?: boolean | undefined;
}

/** Scan a package's source contracts the way drift does, into a folder nobody keeps. */
async function runContracts(dir: string, root: string, format: RunCheckOptions['format']) {
  const outRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-check-'));

  try {
    const { errors } = await scanCatalog({
      root: dir,
      outRoot,
      adapters: [...builtInDiscoveryAdapters],
      onlyPublished: true,
    });

    const prefix = path.relative(root, dir).split(path.sep).join('/');

    for (const error of errors) report(prefix ? `${prefix}/${error}` : error, format, root);

    if (errors.length === 0) console.log(kleur.green('✓ contracts read'));

    return errors.length > 0 ? 1 : 0;
  } finally {
    await fs.rm(outRoot, { recursive: true, force: true });
  }
}

function report(failure: string, format: RunCheckOptions['format'], root: string): void {
  console.error(
    format === 'github' ? githubAnnotation(failure, root) : `${kleur.red('✗')} ${failure}`,
  );
}

/** Compare against the base branch, which may hold contracts this change removed. */
const driftCheck = (
  dir: string,
  opts: RunCheckOptions & { baseRef: string },
  where = '',
  format: RunCheckOptions['format'] = opts.format,
) =>
  [
    `Drift from ${opts.baseRef}${where}`,
    () =>
      runDrift({
        baseRef: opts.baseRef,
        root: dir,
        current: path.join(dir, 'events'),
        format,
        failOn: 'breaking',
        allowCodeExecution: opts.allowCodeExecution ?? false,
        onlyPublished: true,
      }),
  ] as const;

/** What one package publishes beyond its documents. */
function packageChecks(dir: string, root: string, opts: RunCheckOptions): Check[] {
  const exists = (name: string) => fsSync.existsSync(path.join(dir, name));
  const where = dir === root ? '' : ` in ${path.relative(root, dir).split(path.sep).join('/')}`;

  return [
    ...(exists('contracts')
      ? [[`Contracts${where}`, () => runContracts(dir, root, opts.format)] as const]
      : []),
    ...(exists('events') || exists(CONSUMES_FILE)
      ? [[`Events${where}`, () => runValidate({ cwd: dir })] as const]
      : []),
    // The root runs whatever is on disk today, so it is not repeated here.
    ...(opts.baseRef && dir !== root && (exists('events') || exists('contracts'))
      ? // Its findings name files from the package, so the root's run marks them instead.
        [driftCheck(dir, { ...opts, baseRef: opts.baseRef }, where, 'text')]
      : []),
  ];
}

/**
 * Everything a repository's pull request should answer, from what is on disk:
 * its documents, its contracts, its events and, given a base branch, whether
 * its contracts stay compatible. What it does not publish is skipped, so one
 * command fits every repository. Drift always runs against a base branch: a
 * change may have removed the only thing that would otherwise ask for it.
 */
export async function runCheck(opts: RunCheckOptions): Promise<number> {
  const root = path.resolve(opts.root);

  // A monorepo publishes from its packages, so each one answers for itself.
  const roots = findCatalogRoots(root);
  const folders = [...new Set([root, ...roots.map(({ dir }) => dir)])];

  // The site publishes the first of these and leaves the rest out.
  const clashes = roots.flatMap(({ name, path: where, duplicateOf }) =>
    duplicateOf === undefined
      ? []
      : [`${where} and ${duplicateOf || 'the root'} both publish as ${name}; rename one folder`],
  );

  const checks: Check[] = [
    // Flows, glossaries and teams answer to this check too, with or without a docs/.
    ...(roots.length > 0
      ? [['Documents', () => runDocsCheck({ root, format: opts.format })] as const]
      : []),
    ...folders.flatMap((dir) => packageChecks(dir, root, opts)),
    ...(opts.baseRef ? [driftCheck(root, { ...opts, baseRef: opts.baseRef })] : []),
  ];

  if (checks.length === 0 && clashes.length === 0) {
    console.log(
      kleur.dim('Nothing to check: this repository publishes no docs, events or contracts.'),
    );

    return 0;
  }

  for (const clash of clashes) report(clash, opts.format, root);

  let failed = clashes.length > 0;

  for (const [name, run] of checks) {
    console.log(kleur.bold(name));

    // One check that cannot run is a failure, and the others still report.
    try {
      if ((await run()) !== 0) failed = true;
    } catch (error) {
      report(error instanceof Error ? error.message : String(error), opts.format, root);
      failed = true;
    }
  }

  return failed ? 1 : 0;
}
