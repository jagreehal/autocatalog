import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import kleur from 'kleur';
import {
  AUTOCATALOG_ENTITY_FILE,
  DIR_BY_KIND,
  discoverFramework,
  discoverMcpServers,
  entitiesOf,
  HOME_PREFIX,
  loadCatalog,
  MCP_ADAPTER,
  MCP_SNAPSHOT_ADAPTER,
  mcpCredentialsAtRisk,
  mcpServerDraft,
  mcpServerSightings,
  mcpSnapshotPath,
  mcpToolDraft,
  mcpToolId,
  parseStoredMcpServer,
  refreshMcpServer,
  type DiscoveredAgent,
  type DiscoveredMcpServer,
  type DiscoveredModel,
  type DiscoveredTool,
  type DiscoveryAdapter,
  type DiscoveryResult,
} from 'autocatalog-agents-core';

type DiscoverSource = DiscoveryAdapter | typeof MCP_ADAPTER | typeof MCP_SNAPSHOT_ADAPTER;

type DiscoverArgs = {
  adapter: DiscoverSource;
  source: string;
  root: string;
  dryRun: boolean;
  home: boolean;
  prune: boolean;
  perRepository: boolean;
  internal: string[];
};

const usage = (): string =>
  'usage: ac-agents discover --from pydantic-ai|ai-sdk|mcp|mcp-snapshot [<source-dir>] [--root <catalog>] [--dry-run]\n' +
  '       with mcp: [--home] [--prune] [--per-repository] [--internal <host-or-@scope>,...]\n';

const parseArgs = (args: string[]): DiscoverArgs | null => {
  let adapter: DiscoverSource | null = null;
  let source: string | null = null;
  let root = '.';
  let dryRun = false;
  let home = false;
  let prune = false;
  let perRepository = false;
  let internal: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--from') {
      const value = args[++i];

      if (
        value === 'pydantic-ai' ||
        value === 'ai-sdk' ||
        value === MCP_ADAPTER ||
        value === MCP_SNAPSHOT_ADAPTER
      ) {
        adapter = value;
      } else return null;
    } else if (arg === '--root') {
      root = args[++i] ?? '.';
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--home') {
      home = true;
    } else if (arg === '--prune') {
      prune = true;
    } else if (arg === '--per-repository') {
      perRepository = true;
    } else if (arg === '--internal') {
      internal = (args[++i] ?? '').split(',').filter(Boolean);
    } else if (!source) {
      source = arg;
    } else {
      return null;
    }
  }

  if (!adapter) return null;

  return { adapter, source: source ?? '.', root, dryRun, home, prune, perRepository, internal };
};

const discovery = (
  adapter: DiscoveryAdapter,
  source: { file: string; line: number; symbol?: string },
  needsReview: string[],
) => ({
  confidence: 'inferred',
  adapter,
  sources: [source],
  needs_review: needsReview,
});

const jsonFile = <T extends Record<string, unknown>>(data: T): string =>
  `${JSON.stringify(data, null, 2)}\n`;

const bodyFile = (body: string): string => `${body.trim()}\n`;

const agentData = (adapter: DiscoveryAdapter, agent: DiscoveredAgent) => ({
  name: agent.name,
  owner: 'review-needed',
  model: agent.model ?? 'review-needed-model',
  tools: agent.tools,
  policies: [],
  risk: 'medium',
  discovery: discovery(adapter, agent.source, ['owner', 'domain', 'risk', 'policies', 'evals']),
});

const toolData = (adapter: DiscoveryAdapter, tool: DiscoveredTool) => ({
  name: tool.name,
  owner: 'review-needed',
  side_effects: 'unknown',
  risk: 'low',
  discovery: discovery(adapter, tool.source, [
    'owner',
    'domain',
    'side_effects',
    'risk',
    'policies',
  ]),
});

const modelData = (adapter: DiscoveryAdapter, model: DiscoveredModel) => ({
  id: model.id,
  name: model.name,
  owner: 'review-needed',
  provider: model.provider,
  model_id: model.model_id,
  discovery: discovery(adapter, model.source, [
    'owner',
    'status',
    'cost_per_million_input_tokens',
    'cost_per_million_output_tokens',
  ]),
});

const writeDrafts = async (catalogRoot: string, result: DiscoveryResult): Promise<string[]> => {
  const written: string[] = [];

  for (const model of result.models) {
    const dir = join(catalogRoot, 'models', model.id);
    const path = join(dir, AUTOCATALOG_ENTITY_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(path, jsonFile(modelData(result.adapter, model)), 'utf8');
    written.push(path);
  }

  for (const tool of result.tools) {
    const dir = join(catalogRoot, 'tools', tool.id);
    const manifestPath = join(dir, AUTOCATALOG_ENTITY_FILE);
    const bodyPath = join(dir, 'index.mdx');
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, jsonFile(toolData(result.adapter, tool)), 'utf8');
    await writeFile(
      bodyPath,
      bodyFile(tool.description ?? `Inferred from ${tool.source.file}:${tool.source.line}.`),
      'utf8',
    );
    written.push(manifestPath);
  }

  for (const agent of result.agents) {
    if (!agent.model) continue;
    const dir = join(catalogRoot, 'agents', agent.id);
    const manifestPath = join(dir, AUTOCATALOG_ENTITY_FILE);
    const bodyPath = join(dir, 'index.mdx');
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, jsonFile(agentData(result.adapter, agent)), 'utf8');
    await writeFile(
      bodyPath,
      bodyFile(agent.instructions ?? `Inferred from ${agent.source.file}:${agent.source.line}.`),
      'utf8',
    );
    written.push(manifestPath);
  }

  return written;
};

type ServerWrite = 'new' | 'updated' | 'unchanged' | 'kept' | 'moved';

const serversDir = (catalogRoot: string): string => join(catalogRoot, DIR_BY_KIND['mcp-server']);

type StaleServer = { id: string; sightings: string[] };

/**
 * Manifests a scan could have seen and did not. A scan of a repository says
 * nothing about servers found in someone's home folder, so those stay.
 */
const staleServers = async (
  catalogRoot: string,
  seen: Set<string>,
  home: boolean,
): Promise<StaleServer[]> => {
  const entries = await readdir(serversDir(catalogRoot), { withFileTypes: true }).catch(() => []);
  const stale: StaleServer[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue;

    const path = join(serversDir(catalogRoot), entry.name, AUTOCATALOG_ENTITY_FILE);
    const text = await readFile(path, 'utf8').catch(() => null);
    const sightings = text ? mcpServerSightings(parseStoredMcpServer(text)) : [];
    const inScope = home || sightings.every((sighting) => !sighting.startsWith(HOME_PREFIX));

    if (sightings.length > 0 && inScope) stale.push({ id: entry.name, sightings });
  }

  return stale;
};

/** A stale entry whose config now names a new address is that server, moved. */
const movedTo = (stale: StaleServer, servers: DiscoveredMcpServer[]): string | undefined =>
  servers.find(({ sources }) =>
    sources.some(({ file, symbol }) => stale.sightings.includes(`${file}#${symbol ?? ''}`)),
  )?.id;

/** Write one server's manifest, keeping what a person has already decided in it. */
const writeServer = async (
  catalogRoot: string,
  server: DiscoveredMcpServer,
): Promise<ServerWrite> => {
  const dir = join(catalogRoot, DIR_BY_KIND['mcp-server'], server.id);
  const path = join(dir, AUTOCATALOG_ENTITY_FILE);
  const before = await readFile(path, 'utf8').catch(() => null);

  if (before === null) {
    await mkdir(dir, { recursive: true });
    await writeFile(path, jsonFile(mcpServerDraft(server)), 'utf8');

    return 'new';
  }

  const existing = parseStoredMcpServer(before);

  if (existing.discovery && mcpCredentialsAtRisk(existing, server)) {
    process.stdout.write(
      `  ${kleur.yellow('warning')} ${server.id} changed endpoint, so its snapshot credentials were removed. Check the new address, then add them back.\n`,
    );
  }

  const after = jsonFile(refreshMcpServer(existing, server));

  if (!existing.discovery) return 'kept';

  if (after === before) return 'unchanged';

  await writeFile(path, after, 'utf8');

  return 'updated';
};

const endpointOf = (server: DiscoveredMcpServer): string =>
  server.url ??
  (server.package
    ? `${server.package.registry}:${server.package.name}${server.package.version ? `@${server.package.version}` : ''}`
    : (server.command ?? (server.origin === 'built' ? 'in code' : 'local command')));

const runMcpDiscover = async (parsed: DiscoverArgs): Promise<number> => {
  const sourceRoot = resolve(parsed.source);
  const catalogRoot = resolve(parsed.root);

  const result = await discoverMcpServers(sourceRoot, {
    home: parsed.home ? homedir() : undefined,
    internal: parsed.internal,
    perRepository: parsed.perRepository,
  });

  process.stdout.write(`${kleur.bold('discover:')} mcp ${kleur.dim(sourceRoot)}\n`);
  process.stdout.write(`  client configs ${result.files.length}\n`);
  process.stdout.write(`  servers ${result.servers.length}\n`);

  for (const warning of result.warnings) {
    process.stdout.write(`  ${kleur.yellow('warning')} ${warning}\n`);
  }

  if (result.servers.length === 0) {
    process.stdout.write(
      `  ${kleur.dim('nothing found: read client configs, server.json and MCP SDK code')}\n`,
    );
  }

  const counts: Record<ServerWrite, number> = {
    new: 0,
    updated: 0,
    unchanged: 0,
    kept: 0,
    moved: 0,
  };

  const onDisk = new Set(
    (await readdir(serversDir(catalogRoot), { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  const stale = await staleServers(
    catalogRoot,
    new Set(result.servers.map(({ id }) => id)),
    parsed.home,
  );

  const moves = new Map<string, string>();

  for (const entry of stale) {
    const target = movedTo(entry, result.servers);

    if (target && !onDisk.has(target) && !moves.has(target)) moves.set(target, entry.id);
  }

  for (const server of result.servers) {
    const files = [...new Set(server.sources.map(({ file }) => file))].join(', ');
    const line = `${server.id} ${kleur.dim(`${endpointOf(server)} (${files})`)}`;

    if (parsed.dryRun) {
      process.stdout.write(`  ${kleur.cyan('mcp-server')} ${line}\n`);
      continue;
    }

    try {
      const from = moves.get(server.id);

      if (from) {
        await rename(join(serversDir(catalogRoot), from), join(serversDir(catalogRoot), server.id));
      }

      const outcome = from ? 'moved' : await writeServer(catalogRoot, server);

      if (from) await writeServer(catalogRoot, server);

      counts[outcome]++;
      process.stdout.write(
        `  ${kleur.green(outcome)} ${line}${from ? kleur.dim(` from ${from}`) : ''}\n`,
      );
    } catch (cause) {
      process.stdout.write(
        `  ${kleur.yellow('skip')} ${server.id} ${kleur.dim(cause instanceof Error ? cause.message : String(cause))}\n`,
      );
    }
  }

  const moved = new Set(moves.values());

  for (const { id } of stale.filter(({ id }) => !moved.has(id))) {
    if (parsed.prune && !parsed.dryRun) {
      await rm(join(serversDir(catalogRoot), id), { recursive: true, force: true });
      process.stdout.write(`  ${kleur.yellow('removed')} ${id}\n`);
    } else {
      process.stdout.write(
        `  ${kleur.yellow('gone')} ${id} ${kleur.dim('no config names it; --prune removes it')}\n`,
      );
    }
  }

  if (moves.size > 0) {
    process.stdout.write(
      `\nA moved server has a new id. ac agents validate names anything still using the old one.\n`,
    );
  }

  if (counts.new > 0) {
    process.stdout.write(
      `\nNext: set owner and origin in ${DIR_BY_KIND['mcp-server']}/*/${AUTOCATALOG_ENTITY_FILE}, then run ac agents audit.\n`,
    );
  }

  return 0;
};

/** Draft a Tool entry for each tool a snapshot holds, leaving existing entries alone. */
const runSnapshotDiscover = async (parsed: DiscoverArgs): Promise<number> => {
  const catalogRoot = resolve(parsed.root);
  const cat = await loadCatalog(catalogRoot);

  process.stdout.write(`${kleur.bold('discover:')} mcp-snapshot ${kleur.dim(catalogRoot)}\n`);

  const known = new Set(cat.entities.get('tool')?.keys());
  let written = 0;

  for (const server of entitiesOf(cat, 'mcp-server')) {
    for (const snapshot of cat.snapshots.get(server.id) ?? []) {
      const file = relative(
        catalogRoot,
        mcpSnapshotPath(catalogRoot, server.id, snapshot.connection),
      );

      for (const tool of snapshot.tools) {
        const id = mcpToolId(server.id, tool.name);

        if (known.has(id)) continue;

        known.add(id);
        written += 1;
        process.stdout.write(`  ${kleur.green('new')} tool/${id}\n`);

        if (parsed.dryRun) continue;

        const dir = join(catalogRoot, DIR_BY_KIND.tool, id);
        const draft = mcpToolDraft(server, tool, { file, line: 1, symbol: tool.name });

        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, AUTOCATALOG_ENTITY_FILE), jsonFile(draft), 'utf8');
      }
    }
  }

  process.stdout.write(`  tools ${written}\n`);

  return 0;
};

export const runDiscover = async (args: string[]): Promise<number> => {
  const parsed = parseArgs(args);

  if (!parsed) {
    process.stderr.write(usage());

    return 2;
  }

  if (parsed.adapter === MCP_ADAPTER) return runMcpDiscover(parsed);

  if (parsed.adapter === MCP_SNAPSHOT_ADAPTER) return runSnapshotDiscover(parsed);

  const sourceRoot = resolve(parsed.source);
  const catalogRoot = resolve(parsed.root);
  const result = await discoverFramework(parsed.adapter, sourceRoot);

  process.stdout.write(`${kleur.bold('discover:')} ${result.adapter} ${kleur.dim(sourceRoot)}\n`);
  process.stdout.write(`  agents ${result.agents.length}\n`);
  process.stdout.write(`  tools  ${result.tools.length}\n`);
  process.stdout.write(`  models ${result.models.length}\n`);

  for (const warning of result.warnings) {
    process.stdout.write(`  ${kleur.yellow('warning')} ${warning}\n`);
  }

  if (parsed.dryRun) {
    for (const agent of result.agents) {
      const suffix = agent.model
        ? ''
        : kleur.yellow(' (not writable: model was not statically proven)');

      process.stdout.write(
        `  ${kleur.cyan('agent')} ${agent.id} tools=[${agent.tools.join(', ')}]${suffix}\n`,
      );
    }

    for (const tool of result.tools) process.stdout.write(`  ${kleur.cyan('tool')}  ${tool.id}\n`);

    for (const model of result.models)
      process.stdout.write(
        `  ${kleur.cyan('model')} ${model.id} (${model.provider}:${model.model_id})\n`,
      );

    return 0;
  }

  const written = await writeDrafts(catalogRoot, result);

  for (const agent of result.agents.filter((item) => !item.model)) {
    process.stdout.write(
      `  ${kleur.yellow('skip')} agent/${agent.id} ${kleur.dim('model was not statically proven')}\n`,
    );
  }

  for (const path of written) process.stdout.write(`  ${kleur.green('write')} ${path}\n`);

  return 0;
};
