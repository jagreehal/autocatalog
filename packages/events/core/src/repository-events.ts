import { COMPONENTS_FILE } from './components';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { builtInDiscoveryAdapters } from './built-in-adapters';
import { conventionDiscoveryAdapter, conventionFiles, CONVENTIONS_PATH } from './scan-convention';
import { scanCatalog } from './scan-catalog';
import { hasMessageContracts, messageContractDiscoveryAdapter } from './scan-message-contract';
import { loadCatalogSnapshot, type LoadedEvent } from './load';
import { DEFAULT_SCAN_EXCLUDE, isRealFileInside } from './utils';
import {
  applySnapshot,
  readSnapshot,
  type ArchitectureSnapshot,
  type WorkflowObservation,
} from './snapshot';
import { RESOURCE_GRAPH_FILE } from './resource-store';
import { CONSUMES_FILE } from './consumes';

const execFileAsync = promisify(execFile);

/** The conventional roots a repository publishes under; any one enrols it. */
const CONTRACTS = 'contracts';

/** A domain model's folders and designs: a handbook may publish only these. */
const MODEL_ROOTS = ['glossary', 'entities', 'data-products', 'teams', 'users', 'designs'];

// A repository that only consumes other teams' events still publishes that fact.
const PUBLISHED_ROOTS = [
  'docs',
  'events',
  'agents',
  'mcp-servers',
  'flows',
  ...MODEL_ROOTS,
  CONTRACTS,
  CONSUMES_FILE,
];

/** Where scanning looks for CODEOWNERS, read at each commit with the contracts. */
const CODEOWNERS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];

/**
 * How far back contract history reaches: the commits that touched contracts/,
 * and the earlier versions kept per event. A long-lived repository still builds
 * in seconds, and the versions a consumer may still be pinned to are the recent
 * ones.
 */
const HISTORY_COMMITS = 50;

const HISTORY_VERSIONS = 10;

/** Where autotel-subscribers' ArchitectureSnapshotSubscriber is documented to write. */
export const RUNTIME_SNAPSHOT = '.autotel/snapshot.json';

/**
 * Whether a conventional folder holds catalog content. A monorepo's `docs/` or
 * `events/` can instead be a package, or a folder of packages, such as a docs
 * site's source.
 */
function isCatalogFolder(folder: string): boolean {
  if (!fs.existsSync(folder)) return false;

  if (fs.existsSync(path.join(folder, 'package.json'))) return false;

  try {
    return (
      !holdsOnlyCode(folder) &&
      !fs
        .readdirSync(folder, { withFileTypes: true })
        .some(
          (entry) =>
            entry.isDirectory() && fs.existsSync(path.join(folder, entry.name, 'package.json')),
        )
    );
  } catch {
    return true;
  }
}

const SOURCE_CODE = /\.(?:[cm]?[jt]sx?|css|py|go|rb|rs|java|kt|cs|php)$/;

/** Whether a folder is an application's own, such as a web route named `events`. */
function holdsOnlyCode(folder: string): boolean {
  const files = fs
    .readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile());

  return files.length > 0 && files.every(({ name }) => SOURCE_CODE.test(name));
}

/** Where Prisma looks for a schema, so a repository with one has data models to publish. */
const PRISMA_SCHEMAS = ['prisma/schema.prisma', 'prisma/schema', 'schema.prisma'];

/**
 * Whether a directory under an aggregation root is an enrolled repository: it
 * has a conventional root, approved message contracts beside its tests, or a
 * Prisma schema the site reads its data models from. Whether the root itself is
 * one repository is {@link isSingleRepository}'s question, since a company keeps
 * its shared contracts at the root of the aggregation too.
 */
export function publishesCatalogContent(dir: string): boolean {
  return (
    PUBLISHED_ROOTS.some((name) => isCatalogFolder(path.join(dir, name))) ||
    // Only a package or checkout: the search walks below, and a plain folder
    // of packages would otherwise claim every package's contracts as its own.
    (REPOSITORY_MARKERS.some((name) => fs.existsSync(path.join(dir, name))) &&
      hasMessageContracts(dir)) ||
    hasResourceGraph(dir) ||
    fs.existsSync(path.join(dir, COMPONENTS_FILE)) ||
    PRISMA_SCHEMAS.some((name) => fs.existsSync(path.join(dir, name)))
  );
}

/**
 * Whether `ac scan` left a resource graph that holds anything. An empty graph
 * publishes nothing. One that does not read still counts, so loading it reports
 * why rather than the repository silently disappearing.
 */
function hasResourceGraph(dir: string): boolean {
  const file = path.join(dir, RESOURCE_GRAPH_FILE);

  if (!fs.existsSync(file)) return false;

  try {
    if (!isRealFileInside(dir, file) || fs.statSync(file).size > 2 * 1024 * 1024) return true;

    const graph: { resources?: { length?: number } } | null = JSON.parse(
      fs.readFileSync(file, 'utf8'),
    );

    return !Array.isArray(graph?.resources) || graph.resources.length > 0;
  } catch {
    return true;
  }
}

/** Roots that make the directory holding them one repository, never a folder of them. */
const SINGLE_ROOTS = ['docs', 'events', 'agents', 'mcp-servers', 'flows', ...MODEL_ROOTS];

/** What a repository's own root carries and a folder of checkouts does not. */
const REPOSITORY_MARKERS = ['.git', 'package.json'];

/**
 * Whether a root is one repository rather than a folder of checkouts.
 *
 * `contracts/` alone does not decide it: a company keeps shared contracts at
 * the root of an aggregation. With a marker and no checkouts below it, though,
 * the root is one repository's own, `contracts/` included. Approved message contracts sit beside their tests,
 * in `src/` or `test/`, so they belong to the root only when the root is
 * plainly a repository's own (a git checkout or a package) and none of its
 * folders is a checkout of its own. Otherwise `src/` would be enrolled as a
 * repository, and the real root's CODEOWNERS and runtime snapshot missed. A
 * resource graph is held to the same rule: one `ac scan` at an aggregation root
 * must not hide every repository enrolled under it.
 */
export function isSingleRepository(root: string): boolean {
  if (SINGLE_ROOTS.some((name) => isCatalogFolder(path.join(root, name)))) return true;

  if (!REPOSITORY_MARKERS.some((name) => fs.existsSync(path.join(root, name)))) return false;

  const holdsCheckouts = fs
    .readdirSync(root, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, '.git')));

  return (
    !holdsCheckouts &&
    (hasMessageContracts(root) ||
      hasResourceGraph(root) ||
      isCatalogFolder(path.join(root, CONTRACTS)) ||
      fs.existsSync(path.join(root, CONSUMES_FILE)) ||
      fs.existsSync(path.join(root, COMPONENTS_FILE)))
  );
}

/** A directory that publishes catalog content, wherever it sits below the root. */
export interface CatalogRoot {
  /** The folder's own name, its pages' namespace: moving it does not change it. */
  name: string;
  /** Its Repository identity: the name, unless the root was given one of its own. */
  repository: string;
  /** Absolute path. */
  dir: string;
  /** Path below the aggregation root, forward-slashed; `''` for the root itself. */
  path: string;
  /** Roots inside this one: theirs to publish, so this one's scans skip them. */
  nested: string[];
  /** Set when an earlier root has the same name: the path of that one, which publishes instead. */
  duplicateOf?: string;
}

/** What makes a folder an EventCatalog project: its configuration file. */
const EVENTCATALOG_CONFIGS = [
  'eventcatalog.config.js',
  'eventcatalog.config.mjs',
  'eventcatalog.config.cjs',
  'eventcatalog.config.ts',
];

/**
 * Whether a folder is an EventCatalog project. Its `teams/` and `users/` are
 * EventCatalog's, not autocatalog's directory, so it is never read as an
 * autocatalog repository: `ac site` reads it as an EventCatalog source.
 */
export function isEventCatalogProject(dir: string): boolean {
  return EVENTCATALOG_CONFIGS.some((name) => fs.existsSync(path.join(dir, name)));
}

/** Every EventCatalog project under a root, the root included, skipping what scans skip. */
export function findEventCatalogProjects(root: string): string[] {
  const top = path.resolve(root);
  const exclude = new Set(DEFAULT_SCAN_EXCLUDE);
  const found: string[] = [];

  const walk = (dir: string) => {
    if (isEventCatalogProject(dir)) {
      found.push(dir);

      return;
    }

    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries)
      if (entry.isDirectory() && !entry.name.startsWith('.') && !exclude.has(entry.name))
        walk(path.join(dir, entry.name));
  };

  walk(top);

  return found.sort();
}

/** Folders that hold a root's content or its test data, never another root. */
const NOT_ROOTS = new Set([
  'docs',
  'events',
  'agents',
  'mcp-servers',
  'flows',
  CONTRACTS,
  'models',
  'prisma',
  'test',
  'tests',
  'fixtures',
  '__fixtures__',
  // Sample code: each is a catalog of its own, built from its own root.
  'examples',
  'experiments',
  'starters',
  'templates',
]);

/**
 * Every directory under `root` that publishes catalog content: sibling
 * checkouts, packages inside a monorepo, or both. Each publishes under its
 * folder's name, so where it sits is never part of its identity.
 *
 * The root itself counts only when it is plainly one repository
 * ({@link isSingleRepository}), or when `name` is given for it; otherwise it is
 * a folder of repositories whose own `contracts/` belong to the company.
 *
 * A root's whole-tree scans (approved message contracts, data models) skip
 * the roots nested in it: pass `nested` as `exclude`. Two roots of one name
 * cannot both publish, by name or by identity; the deeper one, or the later by
 * path at the same depth, carries `duplicateOf`.
 */
export function findCatalogRoots(
  root: string,
  options: {
    name?: string;
    repository?: string;
    /** Told about a folder that could not be read; the search carries on around it. */
    onWarning?: (message: string) => void;
  } = {},
): CatalogRoot[] {
  const top = path.resolve(root);
  const exclude = new Set(DEFAULT_SCAN_EXCLUDE);
  const found: CatalogRoot[] = [];

  // An EventCatalog project holds no autocatalog repository: `ac site` reads it whole.
  if (options.name === undefined && isEventCatalogProject(top)) return found;

  if (options.name !== undefined || (isSingleRepository(top) && !isEventCatalogProject(top))) {
    const name = options.name ?? path.basename(top);

    found.push({ name, repository: options.repository ?? name, dir: top, path: '', nested: [] });
  }

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const where = path.relative(top, dir).split(path.sep).join('/');

      options.onWarning?.(
        `${where}: not searched for repositories — ${error instanceof Error ? error.message : String(error)}`,
      );

      return;
    }

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith('.') ||
        exclude.has(entry.name) ||
        NOT_ROOTS.has(entry.name)
      )
        continue;

      const child = path.join(dir, entry.name);

      // An EventCatalog project is read as one, by `ac site`, and never walked into.
      if (isEventCatalogProject(child)) continue;

      if (publishesCatalogContent(child))
        found.push({
          name: entry.name,
          repository: entry.name,
          dir: child,
          path: path.relative(top, child).split(path.sep).join('/'),
          nested: [],
        });
      walk(child);
    }
  };

  walk(top);
  // Shallowest first, so a package nested deeper can never take a checkout's name.
  const depth = (candidate: CatalogRoot) => (candidate.path ? candidate.path.split('/').length : 0);

  found.sort((a, b) => depth(a) - depth(b) || a.path.localeCompare(b.path));

  const first = new Map<string, CatalogRoot>();

  for (const candidate of found) {
    candidate.nested = found.flatMap(({ dir }) =>
      dir.startsWith(candidate.dir + path.sep) ? [dir] : [],
    );

    // A root renamed by its identity claims both names.
    const earlier = first.get(candidate.name) ?? first.get(candidate.repository);

    if (earlier) candidate.duplicateOf = earlier.path;
    else for (const key of [candidate.name, candidate.repository]) first.set(key, candidate);
  }

  return found;
}

export interface LoadRepositoryEventsOptions {
  /**
   * Also read earlier versions of discovered contracts from git, as history
   * (`folder.isVersioned`), the way a committed catalog's `versioned/` folders
   * are. A committed catalog brings its own history and is unaffected.
   */
  history?: boolean;
  /** Told about what was left out but did not stop the load, such as a malformed snapshot. */
  onWarning?: (message: string) => void;
  /** Told that the repository's runtime snapshot was read, whatever it matched. */
  onSnapshot?: () => void;
  /** Handed the workflow runs the repository's runtime snapshot recorded. */
  onWorkflows?: (workflows: WorkflowObservation[]) => void;
  /** How far above the repository to look for CODEOWNERS: its monorepo's root. */
  ownersWithin?: string;
  /** Directories the whole-repository scan skips: packages that publish for themselves. */
  exclude?: string[];
}

/**
 * The events one repository publishes: its committed `events/` catalog, or,
 * when it publishes `contracts/` but no catalog, what `ac scan` finds there.
 *
 * Passive Adapters only: reading a repository is not consent to run its code.
 * A discovered catalog is published to a scratch directory and loaded back as a
 * strict snapshot, so it is held to exactly the rules a committed one is.
 */
export async function loadRepositoryEvents(
  repositoryRoot: string,
  options: LoadRepositoryEventsOptions = {},
): Promise<LoadedEvent[]> {
  const committed = path.join(repositoryRoot, 'events');

  if (isDirectory(committed)) {
    const events = (await loadCatalogSnapshot(committed)).events;
    await applyRuntimeSnapshot(repositoryRoot, events, options);

    return events;
  }

  const current = await discoverContracts(repositoryRoot, options);
  await applyRuntimeSnapshot(repositoryRoot, current, options);

  if (!options.history) return current;

  return [...current, ...(await contractHistory(repositoryRoot, current))];
}

/**
 * Join the repository's own runtime snapshot onto its current events, so
 * evidence reaches the site without committing a generated catalog. Only a
 * real file inside the repository is read. A snapshot that does not read is
 * a warning: the contracts are still the contracts.
 */
async function applyRuntimeSnapshot(
  repositoryRoot: string,
  events: LoadedEvent[],
  options: LoadRepositoryEventsOptions,
): Promise<void> {
  const file = path.join(repositoryRoot, RUNTIME_SNAPSHOT);
  const current = events.filter((event) => !event.folder.isVersioned);

  if (!isRealFileInside(repositoryRoot, file)) return;

  const notApplied = (reason: string) =>
    options.onWarning?.(
      `${RUNTIME_SNAPSHOT} was not applied, so no runtime evidence is shown — ${reason}`,
    );

  let snapshot: ArchitectureSnapshot;

  try {
    snapshot = await readSnapshot(file);
  } catch (error) {
    notApplied(error instanceof Error ? error.message : String(error));

    return;
  }

  // A saga's runs belong to its flow, which a repository with no events can declare.
  const workflows = Object.values(snapshot.workflows ?? {});

  if (workflows.length > 0) options.onWorkflows?.(workflows);

  if (current.length === 0) return;

  // The snapshot joins scanner output; a loaded event is that output, published.
  const joined = current.map((event) => ({
    ...event.frontmatter,
    meta: { consumers: event.frontmatter.consumers },
  }));

  try {
    applySnapshot(joined, snapshot);
  } catch (error) {
    notApplied(error instanceof Error ? error.message : String(error));

    return;
  }

  options.onSnapshot?.();

  for (const [index, event] of current.entries()) {
    const { observed, meta, provenance } = joined[index]!;
    event.frontmatter = {
      ...event.frontmatter,
      observed,
      consumers: meta.consumers,
      provenance: { ...event.frontmatter.provenance, ...provenance },
    };
  }
}

/**
 * Only contracts/ is scanned, because the rest of a repository holds test
 * fixtures and tooling whose stray schemas are not anything it publishes. The
 * exceptions are autotel-message-contract's approved files, which live beside
 * their tests: `__contracts__/*.approved.txt` is narrow enough that nothing
 * stray matches it, and its walk skips node_modules, dist and dot-folders; and
 * the files a conventions file names, which the repository chose to publish.
 */
async function discoverContracts(
  repositoryRoot: string,
  {
    ownersWithin,
    exclude,
    conventions,
  }: LoadRepositoryEventsOptions & { conventions?: string } = {},
): Promise<LoadedEvent[]> {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autocatalog-repository-'));
  const hasContracts = isDirectory(path.join(repositoryRoot, CONTRACTS));

  try {
    const scan = await scanCatalog({
      root: repositoryRoot,
      discoverIn: CONTRACTS,
      wholeRepository: [messageContractDiscoveryAdapter, conventionDiscoveryAdapter],
      outRoot,
      adapters: hasContracts
        ? builtInDiscoveryAdapters
        : [messageContractDiscoveryAdapter, conventionDiscoveryAdapter],
      ownersWithin,
      exclude,
      ...(conventions && { conventions }),
    });

    if (scan.errors.length > 0) throw new Error(scan.errors.join('; '));

    return scan.events.length === 0 ? [] : (await loadCatalogSnapshot(outRoot)).events;
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
}

/**
 * Earlier versions of the events `current` holds, from the commits that touched
 * contracts/ or a file a convention names, newest first. A version is what the contract declares, and the
 * last commit declaring it is what that version was. An event whose version is
 * not declared has no history: every commit would claim the same inferred one,
 * and a commit SHA is not a version a consumer can pin to.
 *
 * Each commit's contracts are read as git objects into a scratch directory and
 * discovered exactly as today's are, passively; the work tree is never touched
 * and nothing in the repository runs. A commit whose contracts did not compile
 * is skipped: an old mistake must not quarantine today's catalog. Not a git
 * checkout, or no git at all: no history, quietly.
 *
 * Every commit is read through today's conventions, so one from before they
 * were adopted still yields its events, under the ids they have now.
 */
async function contractHistory(
  repositoryRoot: string,
  current: LoadedEvent[],
): Promise<LoadedEvent[]> {
  const key = (event: LoadedEvent) => `${event.frontmatter.domain}/${event.frontmatter.id}`;

  const declared = (event: LoadedEvent) =>
    event.frontmatter.provenance.fields.version !== 'inferred';

  const today = new Map<string, LoadedEvent>();

  for (const event of current) if (declared(event)) today.set(key(event), event);

  if (today.size === 0) return [];

  const sources = await conventionFiles(repositoryRoot);

  const conventions =
    sources.length > 0 ? { conventions: path.join(repositoryRoot, CONVENTIONS_PATH) } : {};

  const commits = await git(repositoryRoot, [
    'rev-list',
    `-n${HISTORY_COMMITS}`,
    'HEAD',
    '--',
    CONTRACTS,
    ...sources,
  ])
    .then((out) => out.toString('utf8').split('\n').filter(Boolean))
    .catch(() => []);

  const seen = new Set(current.map((event) => `${key(event)}@${event.frontmatter.version}`));
  const kept = new Map<string, number>();
  const history: LoadedEvent[] = [];

  for (const commit of commits) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'autocatalog-history-'));

    try {
      const readable = await extractTree(repositoryRoot, commit, scratch, sources).then(
        () => true,
        () => false,
      );

      if (!readable) continue;

      for (const event of await discoverContracts(scratch, conventions).catch(() => [])) {
        const now = today.get(key(event));
        const version = `${key(event)}@${event.frontmatter.version}`;
        const count = kept.get(key(event)) ?? 0;

        // An event retired since has no page today to hang its history on.
        if (!now || !declared(event) || seen.has(version) || count >= HISTORY_VERSIONS) continue;
        seen.add(version);
        kept.set(key(event), count + 1);
        history.push({
          ...event,
          folder: { ...event.folder, isVersioned: true, parentEventPath: now.folder.path },
        });
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  return history;
}

/** Write contracts/, `sources` and CODEOWNERS as they were at `commit` into `into`, skipping symlinks. */
async function extractTree(
  repositoryRoot: string,
  commit: string,
  into: string,
  sources: string[],
): Promise<void> {
  const listing = await git(repositoryRoot, [
    'ls-tree',
    '-r',
    '-z',
    commit,
    '--',
    CONTRACTS,
    ...sources,
    ...CODEOWNERS,
  ]);

  for (const entry of listing.toString('utf8').split('\0').filter(Boolean)) {
    // <mode> <type> <object>\t<path>, and a path can hold a tab.
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    const [mode, type, object = ''] = entry.slice(0, tab).split(' ');
    const target = path.join(into, file);

    if (type !== 'blob' || mode === '120000' || !target.startsWith(into + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await git(repositoryRoot, ['cat-file', 'blob', object]));
  }
}

/**
 * Plumbing reads only: no hooks, filters, fsmonitor or signature checks, so
 * nothing the repository ships runs. A bare repository committed as plain files
 * is not a repository here, its config is not read, and nothing is fetched.
 * Paths are literal, because a conventions file supplies some of them.
 */
const SAFE_GIT = ['-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit'];

async function git(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', [...SAFE_GIT, '--literal-pathspecs', ...args], {
    cwd,
    encoding: 'buffer',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });

  return stdout;
}

/** A real directory, never a symlink: a link could point anywhere on this machine. */
function isDirectory(dir: string): boolean {
  return fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}
