import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import kleur from 'kleur';
import {
  catalogSnapshotToLlmText,
  createCatalogProjection,
  readSnapshot,
  builtInDiscoveryAdapters,
  loadCatalogSnapshot,
  scanCatalog,
  type DiscoveryAdapter,
  type ArtifactRepository,
  RESOURCE_GRAPH_FILE,
  relationshipKey,
  resourceKey,
  summarizeResourceGraph,
} from 'autocatalog-core';
import { discoverDiscoveryAdapters } from '../adapters';
import {
  ARTIFACT_RESOURCES_FILE,
  COMMIT_RESOURCES_ADVICE,
  publishResources,
  REMOVED_RESOURCES_ADVICE,
  scanResources,
  type ResourceScanFlags,
} from './resources';

const execFileAsync = promisify(execFile);

export interface RunScanOptions extends ResourceScanFlags {
  root: string;
  out: string;
  quiet?: boolean;
  adapters?: DiscoveryAdapter[];
  allowCodeExecution?: boolean;
  /** Path to a runtime architecture snapshot. */
  snapshot?: string;
}

async function repositoryMetadata(root: string): Promise<ArtifactRepository> {
  try {
    const gitRoot = (
      await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: root })
    ).stdout.trim();

    const revision = (
      await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim();

    const status = (
      await execFileAsync(
        'git',
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', root],
        {
          cwd: gitRoot,
        },
      )
    ).stdout;

    const diff = (
      await execFileAsync('git', ['diff', '--no-ext-diff', '--binary', 'HEAD', '--', root], {
        cwd: gitRoot,
        maxBuffer: 32 * 1024 * 1024,
      })
    ).stdout;

    const treeHash = createHash('sha256')
      .update(revision)
      .update('\0')
      .update(status)
      .update('\0')
      .update(diff);

    for (const item of status.split('\0')) {
      if (!item.startsWith('?? ')) continue;
      const file = path.join(gitRoot, item.slice(3));
      treeHash
        .update(item.slice(3))
        .update('\0')
        .update(await fs.readFile(file));
    }

    const url = (
      await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: gitRoot }).catch(
        () => ({ stdout: '' }),
      )
    ).stdout.trim();

    const repository: ArtifactRepository = {
      id: path.basename(root),
      revision,
      treeDigest: treeHash.digest('hex'),
      dirty: Boolean(status),
    };

    if (url) repository.url = url;

    return repository;
  } catch {
    return { id: path.basename(root) };
  }
}

/**
 * Multi-source scan: Zod discovery + JSON Schema file discovery, merged by
 * event id (higher provenance/confidence wins), then written once.
 */
export async function runScan(opts: RunScanOptions): Promise<number> {
  const startedAt = performance.now();
  const root = path.resolve(opts.root);
  const out = path.resolve(opts.out);

  let architecture: Awaited<ReturnType<typeof scanResources>>;

  try {
    architecture = await scanResources(root, { ...opts, outDir: out });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }

  const builtIns = builtInDiscoveryAdapters;

  const installed = opts.adapters
    ? []
    : await discoverDiscoveryAdapters(root, { allowCodeExecution: opts.allowCodeExecution });

  const adapterNames = new Set(builtIns.map((adapter) => adapter.name));

  const adapters = opts.adapters ?? [
    ...builtIns,
    ...installed.filter((adapter) => !adapterNames.has(adapter.name)),
  ];

  const result = await scanCatalog({
    root,
    outRoot: out,
    adapters,
    repository: await repositoryMetadata(root),
    snapshot: opts.snapshot ? await readSnapshot(opts.snapshot) : undefined,
  });

  // llms.txt is part of publishing a catalog, not part of reporting one:
  // --quiet changes what is printed, never what lands on disk. It goes in the
  // catalog directory, which this command owns; the repository root does not.
  const snapshot = result.publication ? await loadCatalogSnapshot(out) : undefined;

  // The graph goes into the catalog artifact as well, so `ac drift` comparing
  // two artifacts compares their datastores and commands too.
  const published = result.publication ? await publishResources(root, architecture.graph) : 'none';

  const resources = published === 'written';

  if (resources)
    await fs.writeFile(
      path.join(out, ARTIFACT_RESOURCES_FILE),
      `${JSON.stringify(architecture.graph, null, 2)}\n`,
    );
  else if (result.publication)
    await fs.rm(path.join(out, ARTIFACT_RESOURCES_FILE), { force: true });

  if (snapshot)
    await fs.writeFile(path.join(out, 'llms.txt'), catalogSnapshotToLlmText(snapshot.events));

  if (!opts.quiet) {
    for (const f of result.findings) {
      const marker = f.needsReview ? kleur.yellow('? needs review') : kleur.green('✓');
      const src = f.source ? ` [${f.source}]` : '';
      console.log(
        `${marker} ${f.id}  ${kleur.dim(`${f.file}${f.line != null ? `:${f.line}` : ''} (${f.symbol}, ${f.kind})${src}`)}`,
      );
    }

    for (const conflict of result.conflicts) {
      console.warn(
        kleur.yellow(
          `  ! ${conflict.eventId}: kept ${conflict.winner}, ignored ${conflict.ignored} (${conflict.reason})`,
        ),
      );
    }

    for (const note of result.skipped) console.warn(kleur.dim(`  - skipped ${note}`));

    for (const note of architecture.skipped) console.warn(kleur.dim(`  - ${note}`));

    for (const conflict of architecture.conflicts)
      console.warn(
        `Ownership conflict: ${conflict.resource.id}; selected ${conflict.selected}; alternatives ${conflict.alternatives.join(', ')}`,
      );

    for (const err of result.errors) console.error(kleur.red(`  ! ${err}`));
    const written = result.publication?.eventsWritten ?? 0;

    if (result.publication) {
      // Events and the discovered resources, counted once each: a service
      // both name is one resource.
      const events = createCatalogProjection(snapshot!).resourceGraph;
      const known = new Set(events.resources.map((resource) => resourceKey(resource.ref)));
      const knownEdges = new Set(events.relationships.map(relationshipKey));

      const summary = summarizeResourceGraph({
        ...events,
        resources: [
          ...events.resources,
          ...architecture.graph.resources.filter(
            (resource) => !known.has(resourceKey(resource.ref)),
          ),
        ],
        relationships: [
          ...events.relationships,
          ...architecture.graph.relationships.filter(
            (edge) => !knownEdges.has(relationshipKey(edge)),
          ),
        ],
      });

      const elapsed = performance.now() - startedAt;

      const duration =
        elapsed < 1_000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1_000).toFixed(1)}s`;

      const kinds = Object.entries(summary.resourcesByKind)
        .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
        .join(', ');

      const evidence = Object.entries(summary.provenance)
        .filter(([, count]) => count > 0)
        .map(([kind, count]) => `${count} ${kind}`)
        .join(', ');

      // "Facts" is every resource and every relationship, counted by where each
      // one came from. Saying so beats a total nobody can reconcile with the
      // two numbers printed above it.
      const facts = summary.resources + summary.relationships;

      console.log(kleur.bold(`\nCatalog compiled in ${duration}`));
      console.log(`  ${summary.resources} resources  ${kleur.dim(kinds)}`);
      console.log(`  ${summary.relationships} relationships`);
      console.log(`  ${facts} facts by origin  ${kleur.dim(evidence)}`);

      if (summary.needsReview > 0) {
        const fact = summary.needsReview === 1 ? 'fact needs' : 'facts need';
        console.log(kleur.yellow(`  ${summary.needsReview} ${fact} review`));
      }

      // A scan writes into someone's repository, so it ends by saying what and
      // what to do about it. Advice to commit only makes sense inside the repo.
      const shown = path.relative(root, out);
      const inside = shown && !shown.startsWith('..') && !path.isAbsolute(shown);
      const where = `${inside ? shown.split(path.sep).join('/') : out}/`;
      const folders = `${written} event folder${written === 1 ? '' : 's'}`;
      const graphFile = resources ? `, ${where}${ARTIFACT_RESOURCES_FILE}` : '';
      console.log(`\n  wrote ${where} (${folders}, ${where}llms.txt${graphFile})`);

      if (inside) {
        console.log(
          kleur.dim(
            `  Commit ${where} if the site should publish it: ac site reads contracts/\n` +
              `  (JSON Schema, OpenAPI, Avro, protobuf) and __contracts__/*.approved.txt,\n` +
              `  nothing else. Not committing? Delete it, or re-run ac . after each change:\n` +
              `  while it exists, ac site reads it in place of those.`,
          ),
        );
      }

      if (resources) {
        const { resources: count, relationships } = architecture.graph;
        console.log(
          `  wrote ${RESOURCE_GRAPH_FILE} (${count.length} resources, ${relationships.length} relationships)`,
        );
        console.log(kleur.dim(`  ${COMMIT_RESOURCES_ADVICE}`));
      }

      if (published === 'removed') console.log(`  ${REMOVED_RESOURCES_ADVICE}`);

      if (architecture.saved) console.log(`  ${architecture.saved}`);

      // Two findings a static catalog cannot produce. A contract nobody has
      // sent is maintenance being paid for nothing; an event nobody wrote down
      // is a contract with no owner.
      if (result.runtime) {
        const { observed, neverObserved, undocumented } = result.runtime;
        console.log(
          `  ${observed} observed, ${neverObserved.length} declared but never seen, ${undocumented.length} undocumented`,
        );

        for (const id of neverObserved) {
          console.log(kleur.yellow(`  ? ${id} is documented but the runtime never saw it`));
        }

        for (const id of undocumented) {
          console.log(kleur.yellow(`  ! ${id} ran but is not in the catalog`));
        }
      }

      // A silent zero is the worst answer a scanner can give: it looks like a
      // clean repository and reads like a pass in CI. Say that nothing was
      // claimed and which adapters were asked.
      if (summary.resources === 0) {
        console.warn(
          kleur.yellow(`\n  no adapter claimed a file under ${root} — nothing was documented`),
        );
        console.warn(
          kleur.dim(
            `  adapters run: ${adapters.map((adapter) => adapter.name).join(', ')}${
              opts.allowCodeExecution ? '' : ' (runtime adapters need --allow-code-execution)'
            }`,
          ),
        );
      }
    }
  }

  return result.errors.length > 0 ? 1 : 0;
}
