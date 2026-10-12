import path from 'node:path';
import type { AdapterEvent } from './adapter-event';
import { enrichEvent, loadCodeowners } from './enrich-event';
import {
  mergeDiscoveries,
  validateDiscoveryResult,
  type DiscoveryAdapter,
  type DiscoveryConflict,
  type DiscoveryLimits,
  type ScanFindingBase,
} from './merge-discoveries';
import { publishCatalog, type PublishCatalogResult } from './publish-catalog';
import type { ArtifactRepository } from './catalog-artifact';
import { applySnapshot, type ArchitectureSnapshot, type SnapshotMergeResult } from './snapshot';

export interface ScanCatalogOptions {
  /** The repository: CODEOWNERS and every recorded path are relative to it. */
  root: string;
  /**
   * The directory inside `root` the Adapters read, when not all of it — a
   * repository's `contracts/`, say. Paths and ownership stay the repository's.
   */
  discoverIn?: string;
  /**
   * Adapters that read all of `root` even when `discoverIn` narrows the rest:
   * ones whose file pattern is strict enough that nothing stray matches it.
   */
  wholeRepository?: DiscoveryAdapter[];
  outRoot: string;
  adapters: DiscoveryAdapter[];
  exclude?: string[];
  repository?: ArtifactRepository;
  signal?: AbortSignal;
  limits?: DiscoveryLimits;
  /** Runtime evidence to join onto what the scanners found. */
  snapshot?: ArchitectureSnapshot;
}

export interface ScanCatalogResult {
  events: AdapterEvent[];
  findings: ScanFindingBase[];
  conflicts: DiscoveryConflict[];
  /** Files an Adapter recognised and did not catalog, each with why. */
  skipped: string[];
  errors: string[];
  publication?: PublishCatalogResult;
  /** Present when a runtime snapshot was supplied. */
  runtime?: SnapshotMergeResult;
}

/** Orchestrate discovery, resolution, enrichment, validation, and one atomic publication. */
export async function scanCatalog(opts: ScanCatalogOptions): Promise<ScanCatalogResult> {
  const root = path.resolve(opts.root);
  const outRoot = path.resolve(opts.outRoot);
  const discoverRoot = opts.discoverIn ? path.resolve(root, opts.discoverIn) : root;

  const results = await Promise.all(
    opts.adapters.map((adapter) => {
      const adapterRoot = opts.wholeRepository?.includes(adapter) ? root : discoverRoot;
      // Adapters name files relative to where they read; the catalog names them
      // as a reader finds them in the repository, which CODEOWNERS also matches.
      const within = path.relative(root, adapterRoot).split(path.sep).join('/');

      return adapter
        .discover({
          root: adapterRoot,
          outDir: outRoot,
          exclude: opts.exclude,
          signal: opts.signal,
          limits: opts.limits,
        })
        .then((result) => {
          const valid = validateDiscoveryResult(adapter.name, result, opts.limits?.maxCandidates);

          for (const { event } of valid.candidates) {
            if (within && event.source?.file) {
              event.source.file = path.posix.join(within, event.source.file);
            }
          }

          return valid;
        })
        .catch((error) => ({
          candidates: [],
          errors: [`${adapter.name}: ${error instanceof Error ? error.message : String(error)}`],
        }));
    }),
  );

  const merged = mergeDiscoveries(results);
  const events = merged.candidates.map((candidate) => candidate.event);

  if (merged.errors.length > 0) {
    return {
      events,
      findings: merged.findings,
      conflicts: merged.conflicts,
      skipped: merged.skipped,
      errors: merged.errors,
    };
  }

  const codeowners = await loadCodeowners(root);

  for (const event of events) enrichEvent(event, codeowners);

  // Evidence is joined after enrichment so it can contradict a guess: an
  // inferred consumer list that the runtime disagrees with should end up
  // marked observed, not quietly left as the heuristic's answer.
  const runtime = opts.snapshot ? applySnapshot(events, opts.snapshot) : undefined;

  try {
    const publication = await publishCatalog({
      outRoot,
      events,
      repository: opts.repository,
    });

    return {
      events,
      findings: merged.findings,
      conflicts: merged.conflicts,
      skipped: merged.skipped,
      errors: [],
      publication,
      runtime,
    };
  } catch (error) {
    return {
      events,
      findings: merged.findings,
      conflicts: merged.conflicts,
      skipped: merged.skipped,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
