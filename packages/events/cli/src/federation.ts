import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import kleur from 'kleur';
import { z } from 'zod';
import {
  composeResourceGraphs,
  createEventResourceGraph,
  earlierVersions,
  findCatalogRoots,
  findEventCatalogProjects,
  loadRepositoryEvents,
  mergeArchitectureGraphs,
  readDeclarationsFile,
  resolveReferences,
  scanArchitecture,
  type JsonValue,
  type RepositoryReferences,
  type ResourceGraph,
} from 'autocatalog-core';
import { runFromEventCatalog } from './commands/from-eventcatalog';
import {
  cloneRepositories,
  gitStderr,
  ignoredDirectory,
  listRepositories,
  repositoryName,
  tokenHeader,
  type EnrolledRepository,
} from './enrol';

/**
 * Federation: one company catalog from catalogs each team owns, built
 * reproducibly. Enrolment says which repositories belong (a topic, or
 * `--repo`); `autocatalog.lock.json` pins each to a commit and tree, so the
 * site builds what was reviewed and moves only when someone locks again.
 * EventCatalog projects are federated as they are, read from a copy the
 * command owns, beside autocatalog repositories.
 */

const execFileAsync = promisify(execFile);

export const LOCK_FILE = 'autocatalog.lock.json';

const lockEntry = z.strictObject({
  // A folder name the clone goes into: no separators, never `.` or `..`.
  name: z
    .string()
    .regex(/^[^/\\]+$/)
    .refine((name) => !/^\.\.?$/.test(name), 'not a folder name'),
  // Never read as a git option.
  url: z
    .string()
    .min(1)
    .refine((url) => !url.startsWith('-'), 'not a URL'),
  commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  /** The commit's tree: what was locked, checked again when it is built. */
  tree: z.string().regex(/^[0-9a-f]{40,64}$/),
  lockedAt: z.string(),
});

const lockFile = z.strictObject({
  spec: z.literal('autocatalog/lock-v1'),
  repositories: z.array(lockEntry),
});

export type LockEntry = z.infer<typeof lockEntry>;

/**
 * The lock's entries, or undefined when there is no lock. A lock someone named
 * (`required`) that is not there is an error: building unpinned instead would
 * quietly ignore the pins they asked for.
 */
export async function readLock(
  file: string,
  { required = false }: { required?: boolean } = {},
): Promise<LockEntry[] | undefined> {
  let text: string;

  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

    if (missing && !required) return undefined;

    throw new Error(`${file}: ${missing ? 'no lock here' : String(error)}`, { cause: error });
  }

  let json: JsonValue;

  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file}: not JSON (${error instanceof Error ? error.message : String(error)})`,
      {
        cause: error,
      },
    );
  }

  const parsed = lockFile.safeParse(json);

  if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);

  return parsed.data.repositories;
}

async function writeLock(file: string, entries: LockEntry[]): Promise<void> {
  const repositories = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  await fs.writeFile(
    file,
    `${JSON.stringify({ spec: 'autocatalog/lock-v1', repositories }, null, 2)}\n`,
  );
}

/** git, sending the token only where {@link tokenHeader} allows, for the repository at `url`. */
async function git(
  dir: string,
  args: string[],
  auth?: { url: string; token?: string },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [
      ...(auth ? tokenHeader(auth.url, auth.token) : []),
      '-C',
      dir,
      ...args,
    ]);

    return stdout.trim();
  } catch (error) {
    // execFile's message repeats the command line, token header included:
    // only git's own `fatal:` line leaves this function, and the original
    // error is deliberately not kept as the cause, since it carries the token.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error(gitStderr(error instanceof Error ? error : new Error('git failed')));
  }
}

export interface EnrolmentFlags {
  topic?: string;
  owner?: string;
  repos?: string[];
}

export async function enrolled(
  flags: EnrolmentFlags,
  token?: string,
): Promise<EnrolledRepository[]> {
  if (Boolean(flags.topic) !== Boolean(flags.owner))
    throw new Error('--topic and --owner go together: whose repositories, with which topic.');

  return [
    ...(flags.topic && flags.owner
      ? await listRepositories({ owner: flags.owner, topic: flags.topic, token })
      : []),
    ...(flags.repos ?? []).map((url) => ({ name: repositoryName(url), cloneUrl: url })),
  ];
}

export interface PreparedSources {
  /** The aggregation root the site reads. */
  root: string;
  /** EventCatalog projects, imported into folders the command owns, each one repository. */
  sources: string[];
  /** Where each source was imported from, by source folder. */
  origins: Map<string, string>;
  /** What each repository was pinned to, by name, when a lock was used. */
  pinned: Map<string, LockEntry>;
  /** Repositories left out, and why. */
  failures: Array<{ name: string; reason: string }>;
}

/**
 * Clone the pinned repositories and check each out at its locked commit,
 * refusing one whose tree is not the tree that was locked.
 */
export async function clonePinned(
  entries: LockEntry[],
  opts: { cache: string; token?: string },
): Promise<{ root: string; failures: PreparedSources['failures'] }> {
  const cloned = await cloneRepositories(
    entries.map(({ name, url }) => ({ name, cloneUrl: url })),
    { into: opts.cache, ...(opts.token && { token: opts.token }) },
  );

  const failures = [...cloned.failed];

  for (const entry of entries) {
    if (!cloned.cloned.includes(entry.name)) continue;

    const dir = path.join(cloned.root, entry.name);

    try {
      await git(dir, ['checkout', '--quiet', '--detach', entry.commit], {
        url: entry.url,
        token: opts.token,
      });

      const tree = await git(dir, ['rev-parse', 'HEAD^{tree}']);

      if (tree !== entry.tree) throw new Error(`its tree is ${tree}, not the ${entry.tree} locked`);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true });
      failures.push({
        name: entry.name,
        reason: `could not build the locked commit ${entry.commit.slice(0, 12)}: ${error instanceof Error ? error.message : 'git failed'}`,
      });
    }
  }

  return { root: cloned.root, failures };
}

/**
 * Each EventCatalog project under the root, imported into a folder under
 * `into` that the command owns, so a federated EventCatalog is read the way an
 * autocatalog repository is without anything being written to its checkout.
 */
export async function importEventCatalogSources(
  root: string,
  into: string,
): Promise<{
  sources: string[];
  origins: Map<string, string>;
  failures: PreparedSources['failures'];
}> {
  const projects = findEventCatalogProjects(root);
  const sources: string[] = [];
  const origins = new Map<string, string>();
  const failures: PreparedSources['failures'] = [];

  await fs.rm(into, { recursive: true, force: true });

  if (projects.length === 0) return { sources, origins, failures };

  await ignoredDirectory(into);

  const names = new Set<string>();

  for (const project of projects) {
    const name = path.basename(project);

    if (names.has(name)) {
      failures.push({
        name,
        reason: `${path.relative(root, project)}: another EventCatalog project is named ${name}`,
      });
      continue;
    }

    names.add(name);

    const target = path.join(into, name);

    await fs.mkdir(target, { recursive: true });

    const code = await runFromEventCatalog({
      source: project,
      out: path.join(target, 'events'),
      cwd: target,
      quiet: true,
    });

    if (code === 0) {
      sources.push(target);
      origins.set(target, project);
    } else failures.push({ name, reason: 'its EventCatalog project could not be read' });
  }

  return { sources, origins, failures };
}

// ---------------------------------------------------------------------------
// ac federation lock

export async function runFederationLock(
  opts: EnrolmentFlags & {
    lock: string;
    cache: string;
    only?: string[];
  },
): Promise<number> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const lock = path.resolve(opts.lock);
  const previous = (await readLock(lock)) ?? [];
  const repositories = await enrolled(opts, token);

  if (repositories.length === 0) {
    console.error(kleur.red('Nothing is enrolled: pass --topic and --owner, or --repo.'));

    return 1;
  }

  const only = new Set(opts.only ?? []);
  const unknown = [...only].filter((name) => !repositories.some((repo) => repo.name === name));

  if (unknown.length) {
    console.error(
      kleur.red(`--only names repositories that are not enrolled: ${unknown.join(', ')}`),
    );

    return 1;
  }

  const cloned = await cloneRepositories(repositories, {
    into: path.resolve(opts.cache),
    ...(token && { token }),
  });

  for (const failure of cloned.failed)
    console.warn(kleur.yellow(`Left out ${failure.name}: ${failure.reason}`));

  // Nothing could be read: the lock stays as it was rather than pinning nothing.
  if (cloned.cloned.length === 0) {
    console.error(
      kleur.red(
        `No enrolled repository could be cloned, so ${path.basename(lock)} was left as it was.`,
      ),
    );

    return 1;
  }

  const now = new Date().toISOString();
  const entries: LockEntry[] = [];

  for (const repo of repositories) {
    const kept = previous.find((entry) => entry.name === repo.name);

    // --only moves the named repositories and keeps every other pin as it was.
    if (only.size > 0 && !only.has(repo.name) && kept) {
      entries.push(kept);
      continue;
    }

    if (!cloned.cloned.includes(repo.name)) {
      if (kept) entries.push(kept);
      continue;
    }

    const dir = path.join(cloned.root, repo.name);
    const commit = await git(dir, ['rev-parse', 'HEAD']);
    const tree = await git(dir, ['rev-parse', 'HEAD^{tree}']);

    // The URL follows enrolment even when the commit is the same: a repository
    // moved to a new home with shared history is pinned where it now lives.
    entries.push(
      kept?.commit === commit
        ? { ...kept, url: repo.cloneUrl }
        : { name: repo.name, url: repo.cloneUrl, commit, tree, lockedAt: now },
    );
  }

  await writeLock(lock, entries);

  for (const entry of entries) {
    const before = previous.find((p) => p.name === entry.name);

    const change = !before
      ? kleur.green('added')
      : before.commit === entry.commit
        ? kleur.dim('unchanged')
        : kleur.yellow(`${before.commit.slice(0, 7)} → ${entry.commit.slice(0, 7)}`);

    console.log(`${entry.name.padEnd(28)} ${entry.commit.slice(0, 12)}  ${change}`);
  }

  for (const gone of previous.filter((p) => !entries.some((e) => e.name === p.name)))
    console.log(`${gone.name.padEnd(28)} ${kleur.red('removed: no longer enrolled')}`);

  console.log(
    kleur.dim(
      `\nwrote ${path.relative(process.cwd(), lock) || lock}: commit it, then ac federation status`,
    ),
  );

  return 0;
}

// ---------------------------------------------------------------------------
// ac federation status

interface SourceStatus {
  repository: string;
  kind: 'autocatalog' | 'eventcatalog';
  commit?: string;
  lockedAt?: string;
  events: number;
  commands: number;
  services: number;
  references: number;
  unresolved: string[];
}

export interface FederationStatus {
  sources: SourceStatus[];
  /** Resources more than one repository defines: each id has one owner. */
  duplicates: string[];
  unresolved: string[];
  failures: PreparedSources['failures'];
}

const kindCount = (graph: ResourceGraph, kind: string) =>
  graph.resources.filter((resource) => resource.ref.kind === kind).length;

/** What each federated source contributes, and what does not join up. */
export async function federationStatus(prepared: PreparedSources): Promise<FederationStatus> {
  const roots = [
    ...findCatalogRoots(prepared.root).map(({ repository, dir }) => ({
      repository,
      dir,
      kind: 'autocatalog' as const,
    })),
    ...prepared.sources.map((dir) => ({
      repository: path.basename(dir),
      dir,
      kind: 'eventcatalog' as const,
    })),
  ];

  const graphs: ResourceGraph[] = [];
  const earlier: ResourceGraph[] = [];
  const references: RepositoryReferences[] = [];
  const sources: SourceStatus[] = [];
  const owners = new Map<string, Set<string>>();

  const failures = [...prepared.failures];

  for (const { repository, dir, kind } of roots) {
    // A source that does not compile is named with the reason, as the site
    // quarantines it, never counted as a source with nothing in it.
    let loaded: Awaited<ReturnType<typeof loadRepositoryEvents>>;
    let file: Awaited<ReturnType<typeof readDeclarationsFile>>;

    try {
      // With earlier versions, as the site loads them, so `^1` resolves here
      // to the release it resolves to there.
      loaded = await loadRepositoryEvents(dir, { history: true });
      file = await readDeclarationsFile(dir);
    } catch (error) {
      failures.push({
        name: repository,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const scanned = await scanArchitecture({ root: dir, publish: false });

    if (scanned.errors.length) {
      failures.push({ name: repository, reason: scanned.errors.join('; ') });
      continue;
    }

    const resources = scanned.graph;
    const events = loaded.filter((event) => !event.folder.isVersioned);
    const eventGraph = createEventResourceGraph(loaded, { repository, urls: false });

    graphs.push(eventGraph, resources);
    earlier.push(earlierVersions(loaded, repository));
    references.push({ repository, receives: file.receives, sends: file.sends });

    for (const event of events) {
      const key = `event ${event.frontmatter.domain}/${event.frontmatter.id}`;

      owners.set(key, (owners.get(key) ?? new Set()).add(repository));
    }

    for (const resource of resources.resources.filter((r) => r.ref.kind === 'command')) {
      const key = `command ${resource.ref.namespace ?? ''}/${resource.ref.id}`;

      owners.set(key, (owners.get(key) ?? new Set()).add(repository));
    }

    // A source inside a pinned repository (an EventCatalog project in a
    // monorepo, a package) carries that repository's pin.
    const within =
      path.relative(prepared.root, prepared.origins.get(dir) ?? dir).split(path.sep)[0] ?? '';

    const pin = prepared.pinned.get(repository) ?? prepared.pinned.get(within);

    sources.push({
      repository,
      kind,
      ...(pin && { commit: pin.commit, lockedAt: pin.lockedAt }),
      events: events.length,
      commands: kindCount(resources, 'command'),
      services: kindCount(mergeArchitectureGraphs(eventGraph, resources), 'service'),
      references: file.receives.length + file.sends.length,
      unresolved: [],
    });
  }

  let composed: ResourceGraph;

  try {
    composed = composeResourceGraphs(
      ...graphs.filter((graph) => graph.resources.some((r) => r.ref.kind === 'event')),
    );
  } catch {
    composed = mergeArchitectureGraphs(...graphs);
  }

  composed = mergeArchitectureGraphs(
    composed,
    ...graphs.filter((graph) => !graph.resources.some((r) => r.ref.kind === 'event')),
  );

  const resolved = resolveReferences(composed, references, mergeArchitectureGraphs(...earlier));

  for (const line of resolved.unresolved) {
    const repository = line.split(':')[0];

    sources.find((source) => source.repository === repository)?.unresolved.push(line);
  }

  const duplicates = [...owners.entries()]
    .flatMap(([key, repositories]) =>
      repositories.size > 1
        ? [`${key} is defined by ${[...repositories].sort().join(' and ')}`]
        : [],
    )
    .sort();

  return { sources, duplicates, unresolved: resolved.unresolved, failures };
}

const age = (iso: string | undefined) => {
  if (!iso) return '';

  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);

  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
};

export function renderFederationStatus(status: FederationStatus): string {
  const lines = [
    `${'source'.padEnd(26)} ${'kind'.padEnd(13)} ${'pinned'.padEnd(22)} events commands services references`,
  ];

  for (const s of status.sources)
    lines.push(
      `${s.repository.padEnd(26)} ${s.kind.padEnd(13)} ${(s.commit ? `${s.commit.slice(0, 7)} ${age(s.lockedAt)}` : 'not locked').padEnd(22)} ${String(s.events).padStart(6)} ${String(s.commands).padStart(8)} ${String(s.services).padStart(8)} ${`${s.references - s.unresolved.length}/${s.references}`.padStart(10)}`,
    );

  if (status.failures.length) {
    lines.push('', kleur.red('Left out:'));

    for (const f of status.failures) lines.push(`  ${f.name}: ${f.reason}`);
  }

  if (status.duplicates.length) {
    lines.push('', kleur.red('Defined more than once (each id has one owner):'));

    for (const d of status.duplicates) lines.push(`  ${d}`);
  }

  if (status.unresolved.length) {
    lines.push('', kleur.yellow('References that do not resolve:'));

    for (const u of status.unresolved) lines.push(`  ${u}`);
  }

  if (!status.failures.length && !status.duplicates.length && !status.unresolved.length)
    lines.push('', kleur.green('Every source composed, and every reference resolves.'));

  return lines.join('\n');
}

/** Repositories enrolled since the lock was written: said, and left out until it is locked. */
export async function enrolledSinceLock(
  flags: EnrolmentFlags,
  pins: LockEntry[],
  lockPath: string,
  token?: string,
): Promise<PreparedSources['failures']> {
  if (!flags.topic && !flags.owner && !flags.repos?.length) return [];

  const locked = new Set(pins.map((pin) => pin.name));

  return (await enrolled(flags, token)).flatMap((repo) =>
    locked.has(repo.name)
      ? []
      : [
          {
            name: repo.name,
            reason: `enrolled but not in ${path.basename(lockPath)}; run ac federation lock`,
          },
        ],
  );
}

/** The sources a federated build reads: pinned clones, enrolled clones, or a root on disk. */
export async function prepareSources(
  opts: EnrolmentFlags & {
    root: string;
    cache: string;
    lock?: string;
    unlocked?: boolean;
  },
): Promise<PreparedSources> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const lockPath = path.resolve(opts.lock ?? LOCK_FILE);

  const pins = opts.unlocked
    ? undefined
    : await readLock(lockPath, { required: Boolean(opts.lock) });

  const cache = path.resolve(opts.cache);
  const failures: PreparedSources['failures'] = [];
  const pinned = new Map<string, LockEntry>();
  let root = path.resolve(opts.root);

  if (pins) {
    const cloned = await clonePinned(pins, { cache, ...(token && { token }) });

    failures.push(...cloned.failures);
    root = cloned.root;

    for (const pin of pins) pinned.set(pin.name, pin);

    failures.push(...(await enrolledSinceLock(opts, pins, lockPath, token)));
  } else if (opts.topic || opts.owner || opts.repos?.length) {
    const cloned = await cloneRepositories(await enrolled(opts, token), {
      into: cache,
      ...(token && { token }),
    });

    failures.push(...cloned.failed);
    root = cloned.root;
  }

  const imported = await importEventCatalogSources(
    root,
    path.join(path.dirname(cache), 'eventcatalog-sources'),
  );

  failures.push(...imported.failures);

  return { root, sources: imported.sources, origins: imported.origins, pinned, failures };
}

export async function runFederationStatus(
  opts: EnrolmentFlags & {
    root: string;
    cache: string;
    lock?: string;
    format: 'text' | 'json';
  },
): Promise<number> {
  const prepared = await prepareSources(opts).catch((error: Error) => error);

  if (prepared instanceof Error) {
    console.error(kleur.red(prepared.message));

    return 1;
  }

  const status = await federationStatus(prepared);

  console.log(
    opts.format === 'json' ? JSON.stringify(status, null, 2) : renderFederationStatus(status),
  );

  // A source left out or two owners of one id is a broken federation; a
  // reference still to resolve is not.
  return status.duplicates.length > 0 || status.failures.length > 0 ? 1 : 0;
}
