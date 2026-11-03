import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import {
  findMcpServersInCode,
  isMcpCodeFile,
  isMcpServerJson,
  readMcpServerJson,
  type BuiltMcpServer,
} from './mcp-code.js';
import {
  forEachFile,
  lineAt,
  listFiles,
  toId,
  toName,
  type DiscoveredSource,
  type ScanFile,
} from './discovery.js';
import type { McpPackage, McpServer } from './schemas.js';

export const MCP_ADAPTER = 'mcp';

/** One server as a client config writes it, before anything is kept. */
type ConfiguredServer = { name: string; url: string | undefined; argv: string[] };

export type DiscoveredMcpServer = {
  id: string;
  name: string;
  origin: McpServer['origin'];
  transport: McpServer['transport'];
  url?: string | undefined;
  package?: McpPackage | undefined;
  command?: string | undefined;
  description?: string | undefined;
  sources: DiscoveredSource[];
  /** Set when configs disagree on the version of one package. */
  versions?: string[] | undefined;
  /** Filled for a folder of checkouts: the repositories that configure it. */
  used_by?: string[] | undefined;
  /** Filled for a folder of checkouts: the repository whose code it is. */
  built_in?: string | undefined;
};

export type McpConfigDiscovery = {
  root: string;
  /** The config files read, whether or not they named a server. */
  files: string[];
  servers: DiscoveredMcpServer[];
  warnings: string[];
};

// A field of the wrong shape reads as absent: one odd entry should not cost the
// rest of the file. Every other field a config holds is dropped here, which is
// what keeps `env` and `headers` out of the catalog.
const OptionalText = z.string().trim().min(1).optional().catch(undefined);

const OptionalArgs = z.array(z.string()).optional().catch(undefined);

const Command = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .catch(undefined);

const ServerEntry = z.object({
  url: OptionalText,
  httpUrl: OptionalText,
  serverUrl: OptionalText,
  command: Command,
  args: OptionalArgs,
});

const ServerMap = z
  .record(z.string(), ServerEntry.nullable().catch(null))
  .optional()
  .catch(undefined);

const Integration = z.object({
  kind: z.string().optional().catch(undefined),
  name: OptionalText,
  namespace: OptionalText,
  endpoint: OptionalText,
  command: Command,
  args: OptionalArgs,
});

const ConfigDocument = z.object({
  mcpServers: ServerMap,
  servers: ServerMap,
  mcp_servers: ServerMap,
  mcp: ServerMap,
  integrations: z.array(Integration.nullable().catch(null)).optional().catch(undefined),
  // Claude Code keeps per-project servers in the one file under the home folder.
  projects: z
    .record(z.string(), z.object({ mcpServers: ServerMap }).catch({ mcpServers: undefined }))
    .optional()
    .catch(undefined),
});

type ConfigDocument = z.infer<typeof ConfigDocument>;

type ServerMap = z.infer<typeof ServerMap>;

const argvOf = (entry: {
  command?: string | string[] | undefined;
  args?: string[] | undefined;
}) => {
  const { command = [], args = [] } = entry;

  return [...(Array.isArray(command) ? command : command.trim().split(/\s+/)), ...args].filter(
    Boolean,
  );
};

const fromServerMap = (map: ServerMap): ConfiguredServer[] =>
  Object.entries(map ?? {}).flatMap(([name, entry]) =>
    entry
      ? [{ name, url: entry.url ?? entry.httpUrl ?? entry.serverUrl, argv: argvOf(entry) }]
      : [],
  );

const fromIntegrations = ({ integrations = [] }: ConfigDocument): ConfiguredServer[] =>
  integrations.flatMap((entry) => {
    const name = entry?.name ?? entry?.namespace;

    return entry?.kind === 'mcp' && name
      ? [{ name, url: entry.endpoint, argv: argvOf(entry) }]
      : [];
  });

const fromClaudeHome = (doc: ConfigDocument): ConfiguredServer[] => [
  ...fromServerMap(doc.mcpServers),
  ...Object.values(doc.projects ?? {}).flatMap(({ mcpServers }) => fromServerMap(mcpServers)),
];

/** The configs a repository commits, each with where it keeps its servers. */
const CONFIGS: Array<{ file: RegExp; read: (doc: ConfigDocument) => ConfiguredServer[] }> = [
  { file: /(^|\/)\.mcp\.json$/, read: (doc) => fromServerMap(doc.mcpServers) },
  { file: /(^|\/)\.cursor\/mcp\.json$/, read: (doc) => fromServerMap(doc.mcpServers) },
  { file: /(^|\/)\.gemini\/settings\.json$/, read: (doc) => fromServerMap(doc.mcpServers) },
  { file: /(^|\/)\.vscode\/mcp\.json$/, read: (doc) => fromServerMap(doc.servers) },
  { file: /(^|\/)\.codex\/config\.toml$/, read: (doc) => fromServerMap(doc.mcp_servers) },
  { file: /(^|\/)opencode\.jsonc?$/, read: (doc) => fromServerMap(doc.mcp) },
  { file: /(^|\/)executor\.jsonc?$/, read: fromIntegrations },
];

/** The same clients' per-person configs, relative to the home folder. */
const HOME_CONFIGS: Array<{ file: string; read: (doc: ConfigDocument) => ConfiguredServer[] }> = [
  { file: '.claude.json', read: fromClaudeHome },
  { file: '.cursor/mcp.json', read: (doc) => fromServerMap(doc.mcpServers) },
  { file: '.gemini/settings.json', read: (doc) => fromServerMap(doc.mcpServers) },
  { file: '.codex/config.toml', read: (doc) => fromServerMap(doc.mcp_servers) },
  { file: '.codeium/windsurf/mcp_config.json', read: (doc) => fromServerMap(doc.mcpServers) },
  { file: '.config/opencode/opencode.json', read: (doc) => fromServerMap(doc.mcp) },
  { file: '.config/Code/User/mcp.json', read: (doc) => fromServerMap(doc.servers) },
  {
    file: 'Library/Application Support/Code/User/mcp.json',
    read: (doc) => fromServerMap(doc.servers),
  },
  {
    file: 'Library/Application Support/Claude/claude_desktop_config.json',
    read: (doc) => fromServerMap(doc.mcpServers),
  },
];

/** What marks a sighting in a person's own config rather than a repository's. */
export const HOME_PREFIX = '~/';

const toPosix = (file: string): string => file.split('\\').join('/');

const configFor = (file: string) =>
  CONFIGS.find(({ file: pattern }) => pattern.test(toPosix(file)));

/**
 * Long mixed strings in a package position are treated as credentials. The
 * query string and arguments never get this far, so nothing relies on it alone.
 */
const looksSecret = (value: string): boolean =>
  value.length >= 16 && /^[\w-]+$/.test(value) && /\d/.test(value) && /[a-z]/i.test(value);

/**
 * Address paths are words: `api`, `v1`, `mcp`, `2026-07-28`. Anything else is
 * treated as a token, which costs a tidy path now and then and never the other
 * way round. A short token of letters alone still reads as a word.
 */
const isPlainSegment = (segment: string): boolean =>
  /^v\d+(\.\d+)*$/.test(segment) ||
  /^\d{4}-\d{2}-\d{2}$/.test(segment) ||
  (segment.length < 16 && /^[a-z]+([-_.][a-z]+)*$/i.test(segment));

const REDACTED = '{redacted}';

/** The address without anything that can carry a credential. */
const safeUrl = (raw: string): string | undefined => {
  if (/\$\{|\{\{|\$[A-Z_]/.test(raw)) return undefined;

  try {
    const { origin, pathname, protocol } = new URL(raw);

    if (protocol !== 'https:' && protocol !== 'http:') return undefined;

    const path = pathname
      .split('/')
      .map((segment) => (!segment || isPlainSegment(segment) ? segment : REDACTED))
      .join('/');

    // One server written with and without a trailing slash is still one server.
    return `${origin}${path.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
};

const RUNNERS: Array<{ prefix: string[]; registry: McpPackage['registry'] }> = [
  { prefix: ['npx'], registry: 'npm' },
  { prefix: ['bunx'], registry: 'npm' },
  { prefix: ['pnpx'], registry: 'npm' },
  { prefix: ['pnpm', 'dlx'], registry: 'npm' },
  { prefix: ['yarn', 'dlx'], registry: 'npm' },
  { prefix: ['npm', 'exec'], registry: 'npm' },
  { prefix: ['uvx'], registry: 'pypi' },
  { prefix: ['uv', 'tool', 'run'], registry: 'pypi' },
  { prefix: ['pipx', 'run'], registry: 'pypi' },
  { prefix: ['docker', 'run'], registry: 'oci' },
  { prefix: ['podman', 'run'], registry: 'oci' },
];

/** Flags whose value names the package rather than an option. */
const PACKAGE_FLAGS = new Set(['-p', '--package', '--from']);

/** `docker run` flags that take a value, so the value is not read as the image. */
const CONTAINER_VALUE_FLAGS = new Set([
  '-e',
  '--env',
  '--env-file',
  '-v',
  '--volume',
  '--mount',
  '-p',
  '--publish',
  '--name',
  '--network',
  '-u',
  '--user',
  '-w',
  '--workdir',
  '--platform',
  '--entrypoint',
  '-l',
  '--label',
]);

const packageSpec = (args: string[], registry: McpPackage['registry']): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--') return args[i + 1];

    if (!arg.startsWith('-')) return arg;

    if (registry === 'oci') {
      if (CONTAINER_VALUE_FLAGS.has(arg)) i++;
    } else if (PACKAGE_FLAGS.has(arg)) {
      return args[i + 1];
    } else {
      const [flag, value] = arg.split(/=(.*)/);

      if (value && PACKAGE_FLAGS.has(flag!)) return value;
    }
  }

  return undefined;
};

const splitSpec = (spec: string, registry: McpPackage['registry']): [string, string?] => {
  if (registry === 'pypi') {
    const [name, version] = spec.split('==');

    return [name!.replace(/\[.*\]$/, ''), version];
  }

  const at = spec.lastIndexOf('@');

  if (at > 0) {
    const name = spec.slice(0, at);

    // `image:tag@digest` runs the digest, so the tag says nothing more.
    return [registry === 'oci' ? name.replace(/:[^/]*$/, '') : name, spec.slice(at + 1)];
  }

  if (registry === 'oci') {
    const colon = spec.lastIndexOf(':');

    if (colon > spec.lastIndexOf('/')) return [spec.slice(0, colon), spec.slice(colon + 1)];
  }

  return [spec];
};

const MAX_VERSION_LENGTH = 128;

const EXACT_VERSION: Record<McpPackage['registry'], RegExp> = {
  npm: /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/,
  // PEP 440: `==1.0` is one release, where npm reads `1.0` as a range.
  pypi: /^(\d+!)?\d[-_.a-z0-9]*(\+[\w.]+)?$/i,
  // A registry lets any tag move, so only a digest names one image.
  oci: /^sha256:[a-f0-9]{64}$/,
};

/** Whether a package names one release, rather than a range or tag that moves. */
export const isPinned = (pkg: McpPackage): pkg is McpPackage & { version: string } =>
  pkg.version !== undefined &&
  pkg.version.length <= MAX_VERSION_LENGTH &&
  EXACT_VERSION[pkg.registry].test(pkg.version);

const parsePackage = (argv: string[]): McpPackage | undefined => {
  const [program, ...rest] = argv;

  if (!program) return undefined;

  const runner = RUNNERS.find(
    ({ prefix }) =>
      posix.basename(toPosix(program)) === prefix[0] &&
      prefix.slice(1).every((word, i) => rest[i] === word),
  );

  if (!runner) return undefined;

  const spec = packageSpec(rest.slice(runner.prefix.length - 1), runner.registry);

  if (!spec) return undefined;

  const [name, version] = splitSpec(spec, runner.registry);

  if (!/^@?[a-z0-9][\w./-]*$/i.test(name) || looksSecret(name)) return undefined;

  const found = { registry: runner.registry, name, version };

  return isPinned(found) ? found : { ...found, version: undefined };
};

const looksLocal = (argv: string[]): boolean =>
  argv.some((arg) => /^(\.{1,2}\/|\$\{)|\.(c|m)?(js|ts)$|\.py$/.test(arg));

/** A slug that survives across repositories: the address, without `mcp` as noise. */
const endpointId = (url: string): string => {
  const { host: address, pathname } = new URL(url);
  const host = address.replace(/^(www|mcp)\./, '');
  const path = pathname.split(`/${encodeURI(REDACTED)}`).join('');

  return toId(`${host}${path.replace(/\/(mcp|sse)\/?$/, '')}`);
};

/** A proxy to a remote server is that remote server. */
const proxiedUrl = (argv: string[], pkg: McpPackage | undefined): string | undefined =>
  pkg?.name === 'mcp-remote' ? argv.find((arg) => /^https?:\/\//.test(arg)) : undefined;

const programName = (argv: string[]): string | undefined => {
  const name = argv[0] ? posix.basename(toPosix(argv[0])) : undefined;

  return name && /^[\w.+-]+$/.test(name) ? name : undefined;
};

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.(internal|local|corp|lan)$/;

const isInternal = (value: string, internal: string[]): boolean =>
  internal.some((suffix) => value === suffix || value.endsWith(`.${suffix}`));

/** Where a server comes from, as far as its address shows. A person confirms it. */
const originOf = (
  url: string | undefined,
  pkg: McpPackage | undefined,
  argv: string[],
  internal: string[],
): McpServer['origin'] => {
  if (url) {
    const { hostname } = new URL(url);

    return PRIVATE_HOST.test(hostname) || isInternal(hostname, internal) ? 'built' : 'unknown';
  }

  if (pkg) {
    return internal.some((scope) => pkg.name.startsWith(`${scope}/`)) ? 'built' : 'third-party';
  }

  return looksLocal(argv) ? 'built' : 'unknown';
};

const normalise = (
  configured: ConfiguredServer,
  source: DiscoveredSource,
  warnings: string[],
  internal: string[],
): DiscoveredMcpServer | undefined => {
  const { name, argv } = configured;
  const parsed = parsePackage(argv);
  const rawUrl = configured.url ?? proxiedUrl(argv, parsed);
  const pkg = proxiedUrl(argv, parsed) ? undefined : parsed;
  const url = rawUrl ? safeUrl(rawUrl) : undefined;

  if (rawUrl && !url) {
    warnings.push(`${source.file}: "${name}" has an address that cannot be kept as written`);
  }

  const id = url ? endpointId(url) : pkg ? toId(pkg.name) : toId(name);

  if (!id || (!rawUrl && argv.length === 0)) {
    warnings.push(`${source.file}: "${name}" has no address or command`);

    return undefined;
  }

  const command = rawUrl || pkg ? undefined : programName(argv);

  return {
    id,
    name: toName(toId(name)) || id,
    origin: rawUrl && !url ? 'unknown' : originOf(url, pkg, argv, internal),
    transport: rawUrl ? 'http' : 'stdio',
    url,
    package: pkg,
    command,
    sources: [source],
  };
};

const lineOfName = (content: string, name: string): number => {
  const index = content.search(new RegExp(`["'.]${name.replace(/[^\w-]/g, '.')}["'\\]]`));

  return index === -1 ? 1 : lineAt(content, index);
};

const parseConfig = (file: string, content: string): ConfigDocument => {
  if (file.endsWith('.toml')) return ConfigDocument.parse(parseToml(content));

  const errors: ParseError[] = [];
  const document = ConfigDocument.parse(parseJsonc(content, errors, { allowTrailingComma: true }));

  if (errors.length > 0) throw new Error(`invalid JSON at offset ${errors[0]!.offset}`);

  return document;
};

type ConfigFile = Pick<ScanFile, 'text'> & {
  label: string;
  read: (doc: ConfigDocument) => ConfiguredServer[];
};

const repositoryConfigs = async (root: string): Promise<ConfigFile[]> => {
  const found = await listFiles(root, (file) => configFor(file) !== undefined);

  return found
    .map(({ relPath, text }) => ({
      label: toPosix(relPath),
      text,
      read: configFor(relPath)!.read,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

const homeConfigs = async (home: string): Promise<ConfigFile[]> => {
  const files = await Promise.all(
    HOME_CONFIGS.map(async ({ file, read }) => {
      const text = await readFile(join(home, file), 'utf8').catch(() => null);

      return text === null ? [] : [{ label: `${HOME_PREFIX}${file}`, text, read }];
    }),
  );

  return files.flat();
};

export type McpConfigOptions = {
  /** Also read this person's own client configs, from this home folder. */
  home?: string | undefined;
  /** Hosts and package scopes the company owns, so they read as `built`. */
  internal?: string[] | undefined;
  /** `root` holds one checkout per folder, so a file's first segment names its repository. */
  perRepository?: boolean | undefined;
};

const toBuilt = (built: BuiltMcpServer, warnings: string[]): DiscoveredMcpServer | undefined => {
  const url = built.url ? safeUrl(built.url) : undefined;

  if (built.url && !url) {
    warnings.push(
      `${built.source.file}: "${built.name}" has an address that cannot be kept as written`,
    );
  }

  const id = url ? endpointId(url) : toId(built.package?.name ?? built.name);

  return id
    ? {
        id,
        name: toName(toId(built.name)) || id,
        origin: 'built',
        transport: built.transport,
        url,
        package: built.package,
        description: built.description,
        sources: [built.source],
      }
    : undefined;
};

const repositoryOf = (file: string): string | undefined =>
  file.startsWith(HOME_PREFIX) ? undefined : file.split('/')[0];

/**
 * Find the MCP servers a repository builds or uses: client configs, `server.json`
 * and SDK code. Static by design: a config is a request to run a program, and
 * scanning one never starts it or connects to it.
 */
export const discoverMcpServers = async (
  root: string,
  options: McpConfigOptions = {},
): Promise<McpConfigDiscovery> => {
  const { home, internal = [], perRepository } = options;
  const files = [...(await repositoryConfigs(root)), ...(home ? await homeConfigs(home) : [])];
  const servers = new Map<string, DiscoveredMcpServer>();
  const warnings: string[] = [];

  // Only a config says what runs. Code naming a package has no opinion on its version.
  const add = (server: DiscoveredMcpServer, runs: boolean) => {
    const known = servers.get(server.id);

    if (!known) {
      servers.set(server.id, server);

      return;
    }

    const [source] = server.sources;

    known.sources.push(...server.sources);
    known.description ??= server.description;
    known.package ??= server.package;

    if (server.origin === 'built') known.origin = 'built';

    const [was, now] = [known.package?.version, server.package?.version];

    if (was && now && was !== now) {
      known.versions = [...new Set([...(known.versions ?? [was]), now])].sort();

      warnings.push(
        `${source?.file}: "${source?.symbol}" runs ${now} of ${server.id}, and ${known.sources[0]!.file} runs ${was}`,
      );
    } else if (runs && was !== now && known.package) {
      // A pin holds only if every config keeps it.
      known.package = { ...known.package, version: undefined };

      warnings.push(
        `${source?.file}: "${source?.symbol}" and another config pin ${server.id} differently`,
      );
    }
  };

  for (const { label: file, text: content, read } of files) {
    let configured: ConfiguredServer[];

    try {
      configured = read(parseConfig(file, content));
    } catch (cause) {
      warnings.push(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }

    for (const entry of configured) {
      const source = { file, line: lineOfName(content, entry.name), symbol: entry.name };
      const server = normalise(entry, source, warnings, internal);

      if (server) add(server, true);
    }
  }

  const codeHits: BuiltMcpServer[] = [];

  await forEachFile(
    root,
    (file) => isMcpCodeFile(toPosix(file)) || isMcpServerJson(file),
    async (file) => {
      if (isMcpServerJson(file.relPath)) {
        const published = readMcpServerJson(file);

        if (published) codeHits.push(published);
      } else {
        codeHits.push(...(await findMcpServersInCode(root, file)));
      }
    },
  );

  const byFile = (a: BuiltMcpServer, b: BuiltMcpServer) =>
    a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line;

  for (const built of codeHits.sort(byFile)) {
    const server = toBuilt(built, warnings);

    if (!server) continue;

    if (perRepository) server.built_in = repositoryOf(built.source.file);

    const known = servers.get(server.id);

    if (known && server.built_in) known.built_in ??= server.built_in;

    add(server, false);
  }

  const inventory = [...servers.values()].sort((a, b) => a.id.localeCompare(b.id));

  if (perRepository) {
    const configs = new Set(files.map(({ label }) => label));

    for (const server of inventory) {
      // A repository's own code defines a server; only a config uses one.
      server.used_by = [
        ...new Set(
          server.sources.flatMap(({ file }) =>
            configs.has(file) ? (repositoryOf(file) ?? []) : [],
          ),
        ),
      ].sort();
    }
  }

  return { root, files: files.map(({ label }) => label), servers: inventory, warnings };
};

const OWNER_TO_REVIEW = 'review-needed';

/** The manifest a newly discovered server starts from. */
export const mcpServerDraft = (server: DiscoveredMcpServer) => ({
  name: server.name,
  owner: OWNER_TO_REVIEW,
  origin: server.origin,
  transport: server.transport,
  url: server.url,
  package: server.package,
  command: server.command,
  description: server.description,
  versions: server.versions,
  used_by: server.used_by,
  repository: server.built_in ? { id: server.built_in } : undefined,
  discovery: {
    confidence: 'inferred',
    adapter: MCP_ADAPTER,
    sources: server.sources,
    needs_review: ['owner', 'origin'],
  },
});

/** A manifest on disk: whatever a person left there, kept as written. */
const StoredMcpServer = z.record(z.string(), z.unknown());

const StoredDiscovery = z.looseObject({});

const Sightings = z.looseObject({
  adapter: z.string(),
  sources: z.array(z.object({ file: z.string(), symbol: z.string().optional() })),
});

/**
 * Where a discovered manifest was last seen, as `file#name` for each config.
 * Empty for a hand-written entry, which a scan never treats as stale.
 */
export const mcpServerSightings = (stored: StoredMcpServer): string[] => {
  const discovery = Sightings.safeParse(stored.discovery);

  return discovery.success && discovery.data.adapter === MCP_ADAPTER
    ? discovery.data.sources.map(({ file, symbol }) => `${file}#${symbol ?? ''}`)
    : [];
};

export type StoredMcpServer = z.infer<typeof StoredMcpServer>;

export const parseStoredMcpServer = (json: string): StoredMcpServer =>
  StoredMcpServer.parse(JSON.parse(json));

const StoredEndpoint = z.looseObject({
  url: z.string().optional().catch(undefined),
  package: z.looseObject({ name: z.string() }).optional().catch(undefined),
});

const StoredSnapshot = z.looseObject({
  headers: z.unknown().optional(),
  env: z.unknown().optional(),
});

const NeedsReview = z.array(z.string()).catch([]);

/**
 * Whether a refresh would send this entry's credentials somewhere new. A config
 * is anyone's to edit, so a changed address is a claim until a person checks it.
 */
export const mcpCredentialsAtRisk = (
  existing: StoredMcpServer,
  server: DiscoveredMcpServer,
): boolean => {
  const stored = StoredEndpoint.parse(existing);
  const snapshot = StoredSnapshot.safeParse(existing.snapshot);

  return (
    snapshot.success &&
    (snapshot.data.headers !== undefined || snapshot.data.env !== undefined) &&
    (stored.url !== server.url || stored.package?.name !== server.package?.name)
  );
};

/**
 * Bring a manifest up to date with a new scan. The scan owns where a server is
 * and what configures it; everything a person decided stays. An entry with no
 * `discovery` was written by hand and is left alone. Credentials do not follow a
 * changed endpoint: they stop here, and the entry goes back for review.
 */
export const refreshMcpServer = (
  existing: StoredMcpServer,
  server: DiscoveredMcpServer,
): StoredMcpServer => {
  const discovery = StoredDiscovery.safeParse(existing.discovery);

  if (!discovery.success) return existing;

  const atRisk = mcpCredentialsAtRisk(existing, server);

  const {
    headers: _headers,
    env: _env,
    ...uncredentialed
  } = StoredSnapshot.safeParse(existing.snapshot).data ?? {};

  // Spread over `existing` so each key keeps its place and an unchanged file
  // stays unchanged. JSON leaves out a value that is now undefined.
  return {
    ...existing,
    transport: server.transport,
    url: server.url,
    package: server.package,
    command: server.command,
    versions: server.versions,
    used_by: server.used_by,
    repository: existing.repository ?? (server.built_in ? { id: server.built_in } : undefined),
    snapshot: atRisk ? uncredentialed : existing.snapshot,
    discovery: {
      ...discovery.data,
      sources: server.sources,
      ...(atRisk && {
        confidence: 'inferred',
        needs_review: [...new Set([...NeedsReview.parse(discovery.data.needs_review), 'snapshot'])],
      }),
    },
  };
};
