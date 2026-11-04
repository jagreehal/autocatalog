import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import kleur from 'kleur';
import {
  agentsUsingMcpTool,
  appendMcpChanges,
  cleanServerText,
  createMcpSnapshot,
  DEFAULT_CONNECTION,
  diffMcpSnapshots,
  entitiesOf,
  isPinned,
  loadCatalog,
  mcpChangesPath,
  McpChangeLogSchema,
  mcpSnapshotPath,
  McpSnapshotSchema,
  McpToolSnapshotSchema,
  renderMcpChange,
  renderMcpChangesGitHub,
  serialiseMcpSnapshot,
  toId,
  type Catalog,
  type McpChange,
  type McpServer,
  type McpSnapshot,
  type McpToolSnapshot,
} from 'autocatalog-agents-core';
import { z } from 'zod';

type Format = 'text' | 'github' | 'json';

type SnapshotArgs = {
  root: string;
  servers: string[];
  check: boolean;
  failOn: 'review' | 'breaking';
  format: Format;
  executor: string | undefined;
  allowStdio: boolean;
};

const USAGE =
  'usage: ac agents snapshot [<server>...] [--root <catalog>] [--check] [--fail-on review|breaking]\n' +
  '                          [--format text|github|json] [--executor <url>] [--allow-stdio]\n';

const parseArgs = (args: string[]): SnapshotArgs | null => {
  const parsed: SnapshotArgs = {
    root: '.',
    servers: [],
    check: false,
    failOn: 'review',
    format: 'text',
    executor: undefined,
    allowStdio: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--root') parsed.root = args[++i] ?? '.';
    else if (arg === '--check') parsed.check = true;
    else if (arg === '--allow-stdio') parsed.allowStdio = true;
    else if (arg === '--executor') parsed.executor = args[++i];
    else if (arg === '--fail-on') {
      const value = args[++i];

      if (value !== 'review' && value !== 'breaking') return null;

      parsed.failOn = value;
    } else if (arg === '--format') {
      const value = args[++i];

      if (value !== 'text' && value !== 'github' && value !== 'json') return null;

      parsed.format = value;
    } else if (arg.startsWith('-')) return null;
    else parsed.servers.push(arg);
  }

  return parsed.executor === undefined && args.includes('--executor') ? null : parsed;
};

const CONNECT_TIMEOUT_MS = 30_000;

/** A server that keeps inventing cursors still has to stop. */
const MAX_PAGES = 100;

const CLIENT_INFO = { name: 'autocatalog', version: '1.0.0' };

class SnapshotSkipped extends Error {}

/** Fill `${NAME}` from the environment; a value never appears in the catalog. */
const fromEnvironment = (values: Record<string, string> = {}): Record<string, string> => {
  const missing = new Set<string>();

  const filled = Object.entries(values).map(([key, value]) => [
    key,
    value.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
      const found = process.env[name];

      if (found === undefined) missing.add(name);

      return found ?? '';
    }),
  ]);

  if (missing.size > 0) {
    throw new SnapshotSkipped(`needs ${[...missing].sort().join(', ')} in the environment`);
  }

  return Object.fromEntries(filled);
};

type Listed = Pick<McpSnapshot, 'protocol' | 'server_version' | 'scope'> & {
  tools: McpToolSnapshot[];
};

const ListedPage = z.looseObject({
  tools: z.array(McpToolSnapshotSchema),
  nextCursor: z.string().optional(),
  cacheScope: z.enum(['public', 'private']).optional(),
});

/**
 * Walk the pages here: `client.listTools()` stops without complaint on a repeated
 * page, and a partial list reads as tools removed and replaces the baseline.
 */
const listTools = async (client: Client): Promise<Listed> => {
  const tools: McpToolSnapshot[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let scope: Listed['scope'];

  while (client.getServerCapabilities()?.tools) {
    const result = ListedPage.parse(
      await client.request(
        { method: 'tools/list', params: cursor ? { cursor } : {} },
        { timeout: CONNECT_TIMEOUT_MS },
      ),
    );

    scope = result.cacheScope ?? scope;
    tools.push(...result.tools);
    cursor = result.nextCursor;

    if (!cursor) break;

    if (seen.has(cursor)) throw new Error('repeated a page of its tools, so the list is partial');

    if (seen.size + 1 === MAX_PAGES) throw new Error(`had more tools after ${MAX_PAGES} pages`);

    seen.add(cursor);
  }

  const version = client.getServerVersion()?.version;

  return {
    tools,
    protocol: client.getNegotiatedProtocolVersion(),
    server_version: version,
    scope,
  };
};

type Connectable = Parameters<Client['connect']>[0];

const withClient = async (transport: Connectable): Promise<Listed> => {
  const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: 'auto' } });

  try {
    await client.connect(transport, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });

    return await listTools(client);
  } finally {
    await client.close().catch(() => undefined);
  }
};

const overHttp = (url: string, headers: Record<string, string>): Promise<Listed> =>
  withClient(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
      // A redirect would carry these headers to an address nobody reviewed.
      fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
    }),
  );

/** What a pinned package starts as. Unpinned is refused: it would run whatever is newest. */
export const packageCommand = (server: McpServer): string[] => {
  const pkg = server.package;

  if (!pkg || !isPinned(pkg)) {
    throw new SnapshotSkipped(
      'runs over stdio with no pinned version, so it will not be started; pin it, or use --executor',
    );
  }

  if (pkg.registry === 'npm') return ['npx', '-y', `${pkg.name}@${pkg.version}`];

  if (pkg.registry === 'pypi') return ['uvx', `${pkg.name}==${pkg.version}`];

  return ['docker', 'run', '--rm', '-i', '--network', 'none', `${pkg.name}@${pkg.version}`];
};

const overStdio = async (server: McpServer, root: string): Promise<Listed> => {
  const declared = server.snapshot?.command;
  const [command, ...args] = declared ?? packageCommand(server);

  // A package gets an empty folder and none of this process's environment. It
  // is someone else's code, and this is containment rather than a sandbox.
  const scratch = declared ? undefined : await mkdtemp(join(tmpdir(), 'ac-mcp-'));

  try {
    return await withClient(
      new StdioClientTransport({
        command: command!,
        args,
        cwd: scratch ?? root,
        env: { ...getDefaultEnvironment(), ...fromEnvironment(server.snapshot?.env) },
        stderr: 'ignore',
      }),
    );
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
};

const captureLive = async (server: McpServer, opts: SnapshotArgs): Promise<McpSnapshot> => {
  let listed: Listed;

  if (server.transport === 'http') {
    if (!server.url) throw new SnapshotSkipped('has no address to connect to');

    listed = await overHttp(server.url, fromEnvironment(server.snapshot?.headers));
  } else {
    if (!opts.allowStdio) {
      throw new SnapshotSkipped(
        'runs over stdio; pass --allow-stdio to start it, or use --executor',
      );
    }

    listed = await overStdio(server, resolve(opts.root));
  }

  return createMcpSnapshot({
    server: server.id,
    connection: server.snapshot?.connection ?? DEFAULT_CONNECTION,
    source: 'live',
    ...listed,
  });
};

const ExecutorTool = z.looseObject({
  address: z.string(),
  owner: z.string(),
  integration: z.string(),
  connection: z.string(),
  name: z.string(),
  pluginId: z.string(),
  description: z.string().optional(),
});

const ExecutorToolList = z.array(ExecutorTool);

const ExecutorSchemaView = z.looseObject({
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  // `observed` means inferred from past responses: a guess, not a promise.
  outputSchemaSource: z.string().optional(),
});

const SCHEMA_REQUESTS_AT_ONCE = 8;

const executorGet = async <T>(base: string, path: string, schema: z.ZodType<T>): Promise<T> => {
  const token = process.env.EXECUTOR_TOKEN;

  const response = await fetch(new URL(path, base), {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Executor answered ${response.status} for ${path.split('?')[0]}${response.status === 401 ? '; set EXECUTOR_TOKEN' : ''}`,
    );
  }

  return schema.parse(await response.json());
};

const executorTool = async (base: string, tool: ExecutorTool): Promise<McpToolSnapshot> => {
  const view = await executorGet(
    base,
    `/api/tools/schema?address=${encodeURIComponent(tool.address)}`,
    ExecutorSchemaView,
  );

  return McpToolSnapshotSchema.parse({
    name: tool.name,
    description: view.description ?? tool.description,
    inputSchema: view.inputSchema,
    outputSchema: view.outputSchemaSource === 'observed' ? undefined : view.outputSchema,
  });
};

const serverForIntegration = (servers: McpServer[], integration: string): McpServer | undefined => {
  const wanted = toId(integration);

  return servers.find(
    (server) =>
      server.snapshot?.integration === integration ||
      server.id === wanted ||
      server.discovery?.sources.some(({ symbol }) => symbol && toId(symbol) === wanted),
  );
};

type ExecutorTool = z.infer<typeof ExecutorTool>;

type ExecutorConnection = Pick<ExecutorTool, 'integration' | 'owner' | 'connection'> & {
  tools: ExecutorTool[];
};

type ExecutorCapture = { snapshots: McpSnapshot[]; unknown: string[] };

/**
 * Read what Executor already holds, one snapshot per connection. It has the
 * credentials and has already started each server, so nothing runs here. Its
 * list is as fresh as its own last sync.
 */
const captureExecutor = async (
  base: string,
  servers: McpServer[],
  cat: Catalog,
): Promise<ExecutorCapture> => {
  const listed = await executorGet(base, '/api/tools', ExecutorToolList);
  const groups = new Map<string, ExecutorConnection>();

  for (const tool of listed.filter(({ pluginId }) => pluginId === 'mcp')) {
    const key = JSON.stringify([tool.integration, tool.owner, tool.connection]);

    const group = groups.get(key) ?? { ...tool, tools: [] };

    group.tools.push(tool);
    groups.set(key, group);
  }

  const snapshots: McpSnapshot[] = [];
  const unknown = new Set<string>();

  for (const { integration, owner, connection, tools } of groups.values()) {
    const server = serverForIntegration(servers, integration);

    if (!server) {
      unknown.add(integration);
      continue;
    }

    const described: McpToolSnapshot[] = [];

    for (let i = 0; i < tools.length; i += SCHEMA_REQUESTS_AT_ONCE) {
      const batch = tools.slice(i, i + SCHEMA_REQUESTS_AT_ONCE);

      described.push(...(await Promise.all(batch.map((tool) => executorTool(base, tool)))));
    }

    snapshots.push(
      createMcpSnapshot({
        server: server.id,
        connection: `${encodeURIComponent(owner)}/${encodeURIComponent(connection)}`,
        source: 'executor',
        tools: described,
      }),
    );
  }

  // Executor lists tools, so a connection left with none is absent.
  for (const server of servers) {
    for (const { connection, source } of cat.snapshots.get(server.id) ?? []) {
      const listed = snapshots.some(
        (snapshot) => snapshot.server === server.id && snapshot.connection === connection,
      );

      if (source === 'executor' && !listed) {
        snapshots.push(
          createMcpSnapshot({ server: server.id, connection, source: 'executor', tools: [] }),
        );
      }
    }
  }

  return { snapshots, unknown: [...unknown].sort() };
};

const readPrevious = async (path: string): Promise<McpSnapshot | undefined> => {
  const text = await readFile(path, 'utf8').catch(() => null);

  return text === null ? undefined : McpSnapshotSchema.parse(JSON.parse(text));
};

const failureOf = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause);

  return cleanServerText(
    /\b401\b|unauthorized/i.test(message)
      ? `refused the connection (${message}); add snapshot.headers, or use --executor`
      : message,
  );
};

type Outcome = {
  changes: McpChange[];
  skipped: Array<{ server: string; reason: string }>;
  failed: Array<{ server: string; reason: string }>;
  unknownServers: string[];
};

const record = async (
  cat: Catalog,
  opts: SnapshotArgs,
  snapshot: McpSnapshot,
  log: (line: string) => void,
): Promise<McpChange[]> => {
  const root = resolve(opts.root);
  const path = mcpSnapshotPath(root, snapshot.server, snapshot.connection);
  const previous = await readPrevious(path);

  const changes = previous
    ? diffMcpSnapshots(previous, snapshot, (tool) => agentsUsingMcpTool(cat, snapshot.server, tool))
    : [];

  const state = !previous ? 'new' : changes.length > 0 ? 'changed' : 'same';

  log(
    `  ${kleur.cyan(state.padEnd(7))} ${snapshot.server} ${kleur.dim(`${snapshot.connection}, ${snapshot.tools.length} tools${snapshot.protocol ? `, ${snapshot.protocol}` : ''}`)}`,
  );

  if (!opts.check) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialiseMcpSnapshot(snapshot), 'utf8');

    if (changes.length > 0) {
      const log = mcpChangesPath(root, snapshot.server);
      const earlier = await readFile(log, 'utf8').catch(() => '[]');

      await writeFile(
        log,
        `${JSON.stringify(
          appendMcpChanges(
            McpChangeLogSchema.parse(JSON.parse(earlier)),
            changes,
            new Date().toISOString(),
          ),
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
  }

  return changes;
};

const capture = async (
  cat: Catalog,
  opts: SnapshotArgs,
  log: (line: string) => void,
): Promise<Outcome> => {
  const all = entitiesOf(cat, 'mcp-server');
  const named = opts.servers.filter((id) => !all.some((server) => server.id === id));

  if (named.length > 0) throw new Error(`no MCP server named ${named.join(', ')} in the catalog`);

  const servers = opts.servers.length
    ? all.filter(({ id }) => opts.servers.includes(id))
    : all.filter(({ status }) => status !== 'retired');

  const outcome: Outcome = { changes: [], skipped: [], failed: [], unknownServers: [] };

  if (opts.executor) {
    const { snapshots, unknown } = await captureExecutor(opts.executor, servers, cat);

    outcome.unknownServers = unknown;

    for (const snapshot of snapshots) {
      outcome.changes.push(...(await record(cat, opts, snapshot, log)));
    }

    return outcome;
  }

  for (const server of servers) {
    try {
      outcome.changes.push(...(await record(cat, opts, await captureLive(server, opts), log)));
    } catch (cause) {
      if (cause instanceof SnapshotSkipped) {
        outcome.skipped.push({ server: server.id, reason: cause.message });
      } else {
        outcome.failed.push({ server: server.id, reason: failureOf(cause) });
      }
    }
  }

  return outcome;
};

const report = (outcome: Outcome, format: Format, log: (line: string) => void): void => {
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);

    return;
  }

  if (format === 'github') {
    const annotations = renderMcpChangesGitHub(outcome.changes);

    if (annotations) process.stdout.write(`${annotations}\n`);
  } else {
    for (const change of outcome.changes) log(`  ${renderMcpChange(change)}`);
  }

  for (const { server, reason } of outcome.skipped) {
    log(`  ${kleur.yellow('skip')}    ${server} ${kleur.dim(reason)}`);
  }

  for (const { server, reason } of outcome.failed) {
    log(`  ${kleur.red('failed')}  ${server} ${kleur.dim(reason)}`);
  }

  for (const server of outcome.unknownServers) {
    log(
      `  ${kleur.yellow('unknown')} ${server} ${kleur.dim('is in Executor but not the catalog')}`,
    );
  }

  const counts = { breaking: 0, review: 0, info: 0 };

  for (const { severity } of outcome.changes) counts[severity] += 1;

  log(`\n${counts.breaking} breaking · ${counts.review} to review · ${counts.info} info`);
};

const exitCode = (outcome: Outcome, opts: SnapshotArgs): number => {
  if (!opts.check) return outcome.failed.length > 0 ? 2 : 0;

  const failing = outcome.changes.some(
    ({ severity }) =>
      severity === 'breaking' || (severity === 'review' && opts.failOn === 'review'),
  );

  if (failing || outcome.unknownServers.length > 0) return 1;

  return outcome.failed.length > 0 ? 2 : 0;
};

/**
 * Save what each MCP server offers and report what changed since last time.
 * `--check` reports without saving, for a scheduled job: a vendor's change
 * never opens a pull request, so a schedule is the only thing that sees it.
 */
export const runSnapshot = async (args: string[]): Promise<number> => {
  const opts = parseArgs(args);

  if (!opts) {
    process.stderr.write(USAGE);

    return 2;
  }

  const cat = await loadCatalog(resolve(opts.root));
  const log = opts.format === 'json' ? () => undefined : (line: string) => console.log(line);

  log(`${kleur.bold('snapshot:')} ${opts.executor ?? 'live servers'}`);

  const outcome = await capture(cat, opts, log);

  report(outcome, opts.format, log);

  return exitCode(outcome, opts);
};
