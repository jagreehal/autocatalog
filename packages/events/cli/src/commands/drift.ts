import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import kleur from 'kleur';
import {
  builtInDiscoveryAdapters,
  compatibilityBreaks,
  driftCatalogs,
  driftEventLabel,
  driftOpenApi,
  renderDriftGitHub,
  renderDriftMarkdown,
  readSnapshot,
  scanCatalog,
  summariseDrift,
  type CompatibilityMode,
  type DiscoveryAdapter,
  scanArchitecture,
  driftResources,
  asDriftFinding,
  parseResourceGraph,
  readOptionalResourceJson,
  type DriftFinding,
  type ResourceGraph,
} from 'autocatalog-core';
import { linkAgentsToEvents } from 'autocatalog-agents-core';
import { discoverDiscoveryAdapters } from '../adapters';
import { ARTIFACT_RESOURCES_FILE } from './resources';

const execFileAsync = promisify(execFile);

export interface RunDriftOptions {
  base?: string; // baseline catalog directory (e.g. the default branch's events/)
  baseRef?: string; // Git ref whose source will be scanned as the baseline
  root?: string; // source tree to scan in Git-ref mode
  current?: string; // current catalog directory
  format?: 'text' | 'markdown' | 'json' | 'github';
  failOn?: 'breaking' | 'suspicious' | 'never';
  /** When set, replaces the severity gate with a Schema Registry strategy. */
  compatibility?: CompatibilityMode;
  quiet?: boolean;
  adapters?: DiscoveryAdapter[];
  allowCodeExecution?: boolean;
  /** A runtime architecture snapshot to check the current catalog against. */
  snapshot?: string;
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd })).stdout.trim();
}

async function linkDependencies(currentRoot: string, worktreeRoot: string): Promise<void> {
  const source = path.join(currentRoot, 'node_modules');
  const destination = path.join(worktreeRoot, 'node_modules');

  try {
    await fs.access(source);
    await fs.symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    // A JSON-Schema-only repository does not need installed JS dependencies.
  }
}

async function dependencyLock(root: string): Promise<string | undefined> {
  for (const name of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']) {
    try {
      return await fs.readFile(path.join(root, name), 'utf8');
    } catch {
      // try the next supported lockfile
    }
  }

  return undefined;
}

async function catalogsForGitRef(opts: RunDriftOptions & { baseRef: string }): Promise<{
  base: string;
  current: string;
  /** The two source trees, for contracts that live beside the events. */
  sources: [string, string];
  cleanup: () => Promise<void>;
}> {
  const currentRoot = await fs.realpath(path.resolve(opts.root ?? process.cwd()));
  const gitRoot = await fs.realpath(await gitOutput(currentRoot, ['rev-parse', '--show-toplevel']));
  const relativeRoot = path.relative(gitRoot, currentRoot);

  if (relativeRoot.startsWith('..')) throw new Error(`${currentRoot} is outside ${gitRoot}`);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-drift-'));
  const worktree = path.join(temp, 'baseline');
  const baseEvents = path.join(temp, 'base-events');
  const currentEvents = path.join(temp, 'current-events');
  let worktreeAdded = false;

  try {
    let baselineRevision: string;

    try {
      baselineRevision = await gitOutput(gitRoot, [
        'rev-parse',
        '--verify',
        `${opts.baseRef}^{commit}`,
      ]);
    } catch {
      throw new Error(
        `[source_ref_not_found] Git ref ${opts.baseRef} is unavailable. Fetch it before running drift (for example: git fetch origin ${opts.baseRef}).`,
      );
    }

    await execFileAsync('git', ['worktree', 'add', '--detach', worktree, baselineRevision], {
      cwd: gitRoot,
    });
    worktreeAdded = true;

    const installed = opts.adapters
      ? []
      : await discoverDiscoveryAdapters(currentRoot, {
          allowCodeExecution: opts.allowCodeExecution,
        });

    const adapters = opts.adapters ?? [...builtInDiscoveryAdapters, ...installed];

    if (installed.length > 0) {
      const [currentLock, baselineLock] = await Promise.all([
        dependencyLock(gitRoot),
        dependencyLock(worktree),
      ]);

      if (!currentLock || !baselineLock || currentLock !== baselineLock) {
        throw new Error(
          '[dependencies_unavailable] Runtime Git-ref discovery requires identical committed and current dependency lockfiles. Generate and compare Catalog artifacts separately when dependencies differ.',
        );
      }

      await linkDependencies(gitRoot, worktree);

      if (relativeRoot) await linkDependencies(currentRoot, path.join(worktree, relativeRoot));
    }

    const currentRevision = await gitOutput(gitRoot, ['rev-parse', 'HEAD']);

    const [baseline, current] = await Promise.all([
      scanCatalog({
        root: path.join(worktree, relativeRoot),
        outRoot: baseEvents,
        adapters,
        repository: { revision: baselineRevision, requestedRef: opts.baseRef },
      }),
      scanCatalog({
        root: currentRoot,
        outRoot: currentEvents,
        adapters,
        repository: { revision: currentRevision },
      }),
    ]);

    const errors = [...baseline.errors, ...current.errors];

    if (errors.length > 0) throw new Error(`Could not build drift snapshots: ${errors.join('; ')}`);

    return {
      base: baseEvents,
      current: currentEvents,
      sources: [path.join(worktree, relativeRoot), currentRoot],
      cleanup: async () => {
        if (worktreeAdded) {
          await execFileAsync('git', ['worktree', 'remove', '--force', worktree], { cwd: gitRoot });
        }

        await fs.rm(temp, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (worktreeAdded) {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktree], {
        cwd: gitRoot,
      }).catch(() => undefined);
    }

    await fs.rm(temp, { recursive: true, force: true });
    throw error;
  }
}

/** The resource graph `ac scan --out` put in a catalog artifact, if it has one. */
async function artifactResources(events: string): Promise<ResourceGraph | undefined> {
  const file = path.join(events, ARTIFACT_RESOURCES_FILE);

  try {
    const value = await readOptionalResourceJson(file, { root: events });

    return value === undefined ? undefined : parseResourceGraph(value);
  } catch (error) {
    throw new Error(
      `${file}: not a resource graph (${error instanceof Error ? error.message : String(error)}). Regenerate the artifact with ac scan.`,
      { cause: error },
    );
  }
}

export async function runDrift(opts: RunDriftOptions): Promise<number> {
  if (Boolean(opts.base) === Boolean(opts.baseRef)) {
    throw new Error('Specify exactly one of --base or --base-ref');
  }

  // Read before any scan: a snapshot that is not one fails fast, not after a worktree.
  const snapshot = opts.snapshot ? await readSnapshot(opts.snapshot) : undefined;

  const generated = opts.baseRef
    ? await catalogsForGitRef({ ...opts, baseRef: opts.baseRef })
    : undefined;

  const base = generated?.base ?? path.resolve(opts.base!);
  const current = generated?.current ?? path.resolve(opts.current ?? './events');

  try {
    // Agents that declare they consume an event are its consumers too. They are
    // linked against the baseline, because that is the contract they rely on.
    const agentsRoot = opts.baseRef
      ? path.resolve(opts.root ?? process.cwd())
      : path.dirname(current);

    const agents = await linkAgentsToEvents({ agentsRoot, eventsRoot: base });

    const events = await driftCatalogs(base, current, {
      consumersOf: (domain, id) => agents?.participants.get(`${domain}/${id}`)?.consumers ?? [],
      consumerFieldsOf: (domain, id) =>
        agents?.participants.get(`${domain}/${id}`)?.consumerFields ?? {},
      sourceRoot: generated?.sources[1],
      snapshot,
    });

    // An API published beside the events breaks its clients the same way, but
    // only the Git-ref mode has the source trees its OpenAPI documents live in.
    const eventReport = generated
      ? summariseDrift([...events.findings, ...(await driftOpenApi(...generated.sources))])
      : events;

    const resourceGraphs = generated
      ? await Promise.all(
          generated.sources.map(async (root) => {
            const scanned = await scanArchitecture({ root, publish: false });

            if (scanned.errors.length)
              throw new Error(`Resource drift scan failed: ${scanned.errors.join('; ')}`);

            return scanned.graph;
          }),
        )
      : await Promise.all([artifactResources(base), artifactResources(current)]);

    // Against a side with no graph every resource would read as added or
    // removed, so one missing graph means no resource comparison, said out loud.
    const [before, after] = resourceGraphs;
    const missing = before && !after ? current : !before && after ? base : undefined;

    if (missing && !opts.quiet)
      console.warn(
        `${path.join(missing, ARTIFACT_RESOURCES_FILE)} is missing, so datastore and command resources were not compared. Regenerate both artifacts with ac scan.`,
      );

    const resourceFindings: DriftFinding[] =
      before && after ? driftResources(before, after).map(asDriftFinding) : [];

    const report = resourceFindings.length
      ? summariseDrift([...eventReport.findings, ...resourceFindings])
      : eventReport;

    const incompatible = opts.compatibility
      ? compatibilityBreaks(report, opts.compatibility)
      : undefined;

    if (!opts.quiet) {
      if (opts.format === 'json') {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.format === 'github') {
        if (report.findings.length > 0) console.log(renderDriftGitHub(report));
        // The step summary is the report anyone reads after the annotations
        // point them at the diff. Absent outside Actions, so this is a no-op locally.
        const summary = process.env.GITHUB_STEP_SUMMARY;

        if (summary) await fs.appendFile(summary, `${renderDriftMarkdown(report)}\n`);
      } else if (opts.format === 'markdown') {
        console.log(renderDriftMarkdown(report));
      } else {
        for (const f of report.findings) {
          const color =
            f.severity === 'breaking'
              ? kleur.red
              : f.severity === 'suspicious'
                ? kleur.yellow
                : f.severity === 'additive'
                  ? kleur.green
                  : kleur.dim;

          const impact =
            f.consumers.length > 0 ? kleur.bold(` → breaks ${f.consumers.join(', ')}`) : '';

          const advice = f.advice ? `. ${f.advice}` : '';

          console.log(
            `${color(f.severity.padEnd(10))} ${driftEventLabel(f)}: ${f.message}${impact}${advice}`,
          );
        }

        console.log(
          `\n${kleur.red(`${report.breaking} breaking`)} · ${kleur.yellow(
            `${report.suspicious} suspicious`,
          )} · ${kleur.green(`${report.additive} additive`)}`,
        );

        if (incompatible) {
          const label = `${incompatible.length} incompatible under ${opts.compatibility!.toUpperCase()}`;
          console.log(incompatible.length > 0 ? kleur.red(label) : kleur.green(label));
        }
      }
    }

    // A compatibility strategy is a different question from severity, so it
    // replaces the severity gate rather than stacking with it.
    if (incompatible) return incompatible.length > 0 ? 1 : 0;

    const failOn = opts.failOn ?? 'breaking';

    if (failOn === 'never') return 0;

    // A major version bump acknowledges a breaking change: still reported,
    // with who to tell, but not a failure.
    if (report.hasBreaking) return 1;

    if (failOn === 'suspicious' && report.suspicious > 0) return 1;

    return 0;
  } finally {
    await generated?.cleanup();
  }
}
