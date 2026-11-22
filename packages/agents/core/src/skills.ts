import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, posix, relative } from 'node:path';
import { parseFrontmatter } from 'autocatalog-core';
import { z } from 'zod';
import { forEachFile, toId, type DiscoveredSource } from './discovery.js';
import { discoverMcpServers } from './mcp-config.js';

export const SKILLS_ADAPTER = 'skills';

/** Instructions an agent loads: a `SKILL.md`, a slash command, or a Cursor rule. */
export type DiscoveredSkill = {
  id: string;
  name: string;
  format: 'skill' | 'command' | 'cursor-rule';
  /** Filled for a folder of checkouts: the repository it is in. */
  repository?: string | undefined;
  description?: string | undefined;
  allowed_tools: string[];
  plugin?: string | undefined;
  sources: DiscoveredSource[];
};

/** A coding-agent plugin: one a repository builds, lists in a marketplace, or turns on. */
export type DiscoveredPlugin = {
  id: string;
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  marketplace?: string | undefined;
  source?: string | undefined;
  path?: string | undefined;
  skills: string[];
  agents: string[];
  commands: string[];
  hooks: string[];
  servers: string[];
  enabled_in: string[];
  /** Filled for a folder of checkouts: the repository that builds it. */
  repository?: string | undefined;
  /** Filled for a folder of checkouts: the repositories that turn it on. */
  used_by?: string[] | undefined;
  sources: DiscoveredSource[];
};

export type SkillsDiscoveryOptions = {
  /** Read `root` as a folder of checkouts, one repository per folder. */
  perRepository?: boolean | undefined;
};

export type SkillsDiscovery = {
  skills: DiscoveredSkill[];
  plugins: DiscoveredPlugin[];
  files: string[];
  warnings: string[];
};

const Text = z.string().trim().min(1).optional().catch(undefined);

const Paths = z
  .union([z.string().transform((path) => [path]), z.array(z.string())])
  .catch([])
  .default([]);

/**
 * `Read, Grep` or `Bash(git add:*) Read`: split on commas, or on spaces outside
 * a tool's parentheses.
 */
export const AllowedTools = z
  .union([z.string().transform((value) => value.split(/,|\s+(?![^()]*\))/)), z.array(z.string())])
  .catch([])
  .default([])
  .transform((items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort());

const HookMap = z.record(z.string(), z.unknown());

/** The events a hooks config runs commands on: `{ "hooks": { "PreToolUse": … } }`, or the inner map. */
const HookEvents = z
  .union([
    z.object({ hooks: HookMap }).transform(({ hooks }) => Object.keys(hooks)),
    HookMap.transform((map) => Object.keys(map)),
  ])
  .catch([]);

/** A manifest's `hooks`: a file, several, or the config itself. */
const ManifestHooks = z
  .union([
    z.string().transform((file) => ({ files: [file], events: [] })),
    z.array(z.string()).transform((files) => ({ files, events: [] })),
    HookEvents.transform((events) => ({ files: [], events })),
  ])
  .catch({ files: [], events: [] })
  .default({ files: [], events: [] });

const PluginManifest = z.object({
  name: Text,
  description: Text,
  version: Text,
  agents: Paths,
  commands: Paths,
  skills: Paths,
  hooks: ManifestHooks,
});

/** Where a marketplace fetches a plugin from, as one line. */
const PluginSource = z
  .union([
    z.string(),
    z
      .object({ source: Text, repo: Text, url: Text })
      .transform(({ source, repo, url }) => (repo ? `${source ?? 'github'}:${repo}` : url)),
  ])
  .optional()
  .catch(undefined);

const Marketplace = z.object({
  name: Text,
  plugins: z
    .array(
      z
        .object({ name: Text, description: Text, version: Text, source: PluginSource })
        .nullable()
        .catch(null),
    )
    .catch([])
    .default([]),
});

const Settings = z.object({
  enabledPlugins: z.record(z.string(), z.boolean().catch(false)).catch({}).default({}),
});

const SkillFrontmatter = z.object({
  name: Text,
  description: Text,
  'allowed-tools': AllowedTools,
});

const NamedFrontmatter = z.object({ name: Text });

/** A JSON file read through its schema; a file that is not JSON fails it. */
const parseJson = <T extends z.ZodType>(schema: T, text: string) => {
  try {
    return schema.safeParse(JSON.parse(text));
  } catch {
    return schema.safeParse(undefined);
  }
};

const SKILL = /(^|\/)SKILL\.md$/;

const PLUGIN = /(^|\/)\.claude-plugin\/plugin\.json$/;

const MARKETPLACE = /(^|\/)\.claude-plugin\/marketplace\.json$/;

// Only the settings a team commits: settings.local.json is one person's.
const SETTINGS = /(^|\/)\.claude\/settings\.json$/;

const COMMAND = /(^|\/)\.claude\/commands\/.+\.md$/;

const CURSOR_RULE = /(^|\/)\.cursor\/rules\/.+\.mdc?$/;

/** Where each kind of instruction file is found, and what it is called. */
const INSTRUCTIONS: Array<{ file: RegExp; format: DiscoveredSkill['format'] }> = [
  { file: SKILL, format: 'skill' },
  { file: COMMAND, format: 'command' },
  { file: CURSOR_RULE, format: 'cursor-rule' },
];

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Markdown files directly in a folder, or the file itself. */
const markdownIn = async (path: string): Promise<string[]> => {
  if (path.endsWith('.md')) return [path];

  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(path, entry.name));
};

/**
 * Agent skills and Claude Code plugins a repository commits: every `SKILL.md`,
 * each `.claude-plugin/plugin.json` with what it ships, each marketplace's
 * plugins, and the plugins `.claude/settings.json` turns on. Reads only; a
 * hook's command and a server's arguments stay in the files they came from.
 */
export const discoverSkills = async (
  root: string,
  { perRepository }: SkillsDiscoveryOptions = {},
): Promise<SkillsDiscovery> => {
  const files: Array<{ rel: string; abs: string; text: string }> = [];
  const warnings: string[] = [];

  await forEachFile(
    root,
    (relPath) => {
      const rel = relPath.split('\\').join('/');

      return [SKILL, PLUGIN, MARKETPLACE, SETTINGS, COMMAND, CURSOR_RULE].some((file) =>
        file.test(rel),
      );
    },
    ({ relPath, absPath, text }) => {
      files.push({ rel: relPath.split('\\').join('/'), abs: absPath, text });
    },
  );

  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const repositoryOf = (rel: string) => (perRepository ? rel.split('/')[0] : undefined);

  // A manifest can point anywhere; only paths inside what is being read are
  // followed, judged after links resolve, so a link cannot reach out.
  const realRoot = await realpath(root);

  const inside = async (abs: string) => {
    const real = await realpath(abs).catch(() => undefined);
    const rel = real === undefined ? relative(root, abs) : relative(realRoot, real);

    return !rel.startsWith('..') && !isAbsolute(rel);
  };

  const plugins = new Map<string, DiscoveredPlugin>();
  // A plugin's folder, from the repository's root, to the plugin there.
  const folders = new Map<string, DiscoveredPlugin>();
  // Other folders a plugin's manifest keeps its skills in.
  const skillHomes = new Map<string, DiscoveredPlugin>();

  // Plugins each repository defines, by name: two repositories may each keep one of a name.
  const defined = new Map<string, DiscoveredPlugin[]>();

  const pluginNamed = (name: string, repository?: string): DiscoveredPlugin => {
    const id = repository ? `${toId(repository)}-${toId(name)}` : toId(name);
    const known = plugins.get(id);

    if (known) return known;

    const plugin: DiscoveredPlugin = {
      id,
      name,
      skills: [],
      agents: [],
      commands: [],
      hooks: [],
      servers: [],
      enabled_in: [],
      sources: [],
    };

    plugins.set(id, plugin);

    return plugin;
  };

  for (const file of files.filter(({ rel }) => PLUGIN.test(rel))) {
    const manifest = parseJson(PluginManifest, file.text);

    if (!manifest.success) {
      warnings.push(`${file.rel}: not a plugin manifest, skipped`);
      continue;
    }

    const folder = posix.dirname(posix.dirname(file.rel));
    const absFolder = dirname(dirname(file.abs));
    const name = manifest.data.name ?? basename(absFolder);
    const plugin = pluginNamed(name, repositoryOf(file.rel));

    if (!defined.get(name)?.includes(plugin))
      defined.set(name, [...(defined.get(name) ?? []), plugin]);

    plugin.description ??= manifest.data.description;
    plugin.version ??= manifest.data.version;
    plugin.path = folder;
    plugin.repository ??= repositoryOf(file.rel);
    plugin.sources.push({ file: file.rel, line: 1, symbol: plugin.name });
    folders.set(folder, plugin);

    for (const dir of manifest.data.skills) {
      if (await inside(join(absFolder, dir)))
        skillHomes.set(posix.normalize(posix.join(folder, dir)), plugin);
      else warnings.push(`${file.rel}: skills path "${dir}" is outside, not read`);
    }

    const named = async (dirs: string[], nameOf: (file: string, text: string) => string) => {
      const out: string[] = [];

      for (const dir of dirs) {
        if (!(await inside(join(absFolder, dir)))) {
          warnings.push(`${file.rel}: "${dir}" is outside, not read`);
          continue;
        }

        for (const md of await markdownIn(join(absFolder, dir))) {
          out.push(nameOf(md, await readFile(md, 'utf8')));
        }
      }

      return out;
    };

    plugin.commands = sorted(
      await named(['commands', ...manifest.data.commands], (md) => basename(md, '.md')),
    );

    plugin.agents = sorted(
      await named(
        ['agents', ...manifest.data.agents],
        (md, text) =>
          NamedFrontmatter.parse(parseFrontmatter(text).data).name ?? basename(md, '.md'),
      ),
    );

    // Hooks come from hooks/hooks.json, and from the manifest inline or by path.
    const events = [...manifest.data.hooks.events];

    for (const hookFile of ['hooks/hooks.json', ...manifest.data.hooks.files]) {
      if (!(await inside(join(absFolder, hookFile)))) {
        warnings.push(`${file.rel}: hooks file "${hookFile}" is outside, not read`);
        continue;
      }

      const text = await readFile(join(absFolder, hookFile), 'utf8').catch(() => null);

      if (text !== null) events.push(...(parseJson(HookEvents, text).data ?? []));
    }

    plugin.hooks = sorted(events);
  }

  const pluginFolderOf = (rel: string): DiscoveredPlugin | undefined => {
    let folder = posix.dirname(rel);

    while (folder !== '.' && folder !== '/') {
      const plugin = folders.get(folder) ?? skillHomes.get(folder);

      if (plugin) return plugin;
      folder = posix.dirname(folder);
    }

    return folders.get('.');
  };

  const skills = new Map<string, DiscoveredSkill>();

  for (const file of files) {
    const format = INSTRUCTIONS.find(({ file: pattern }) => pattern.test(file.rel))?.format;

    if (!format) continue;

    const data = SkillFrontmatter.parse(parseFrontmatter(file.text).data);

    // A skill is named by its folder; a command or a rule by its file.
    const name =
      data.name ??
      (format === 'skill' ? basename(dirname(file.abs)) : basename(file.abs, extname(file.abs)));

    const plugin = pluginFolderOf(file.rel);
    const repository = plugin ? undefined : repositoryOf(file.rel);

    // Cursor keeps rules apart from skills and commands, so a rule's name may repeat one.
    const own = `${format === 'cursor-rule' ? 'cursor-' : ''}${toId(name)}`;

    const id = plugin ? `${plugin.id}-${own}` : repository ? `${toId(repository)}-${own}` : own;

    if (skills.has(id)) {
      warnings.push(`${file.rel}: a second skill named "${name}", skipped`);
      continue;
    }

    skills.set(id, {
      id,
      name,
      format,
      repository,
      description: data.description,
      allowed_tools: data['allowed-tools'],
      plugin: plugin?.id,
      sources: [{ file: file.rel, line: 1, symbol: name }],
    });

    if (plugin) plugin.skills = sorted([...plugin.skills, id]);
  }

  for (const file of files.filter(({ rel }) => MARKETPLACE.test(rel))) {
    const market = parseJson(Marketplace, file.text);

    if (!market.success || !market.data.name) {
      warnings.push(`${file.rel}: not a marketplace, skipped`);
      continue;
    }

    const folder = posix.dirname(posix.dirname(file.rel));

    for (const entry of market.data.plugins) {
      if (!entry?.name) continue;

      const { source } = entry;

      // A relative source is a plugin in this repository; it keeps that entry.
      const local = source?.startsWith('.')
        ? folders.get(posix.normalize(posix.join(folder, source)))
        : undefined;

      const plugin = local ?? pluginNamed(entry.name);

      plugin.marketplace ??= market.data.name;
      plugin.description ??= entry.description;
      plugin.version ??= entry.version;

      if (!local && !plugin.path) plugin.source ??= source;

      plugin.sources.push({ file: file.rel, line: 1, symbol: entry.name });
    }
  }

  for (const file of files.filter(({ rel }) => SETTINGS.test(rel))) {
    const settings = parseJson(Settings, file.text);

    for (const [key, on] of Object.entries(settings.data?.enabledPlugins ?? {})) {
      if (!on) continue;

      const at = key.lastIndexOf('@');
      const name = at > 0 ? key.slice(0, at) : key;
      const candidates = defined.get(name) ?? [];

      // The repository's own plugin of that name, else the one repository that defines it.
      const plugin =
        candidates.find((p) => p.repository === repositoryOf(file.rel)) ??
        (candidates.length === 1 ? candidates[0]! : pluginNamed(name));

      if (at > 0) plugin.marketplace ??= key.slice(at + 1);
      plugin.enabled_in = sorted([...plugin.enabled_in, file.rel]);
      plugin.sources.push({ file: file.rel, line: 1, symbol: key });
    }
  }

  // The MCP servers a plugin ships, under the same ids MCP discovery gives them.
  if (folders.size > 0) {
    const mcp = await discoverMcpServers(root);

    for (const server of mcp.servers) {
      for (const { file } of server.sources) {
        const plugin = pluginFolderOf(file.split('\\').join('/'));

        if (plugin) plugin.servers = sorted([...plugin.servers, server.id]);
      }
    }
  }

  if (perRepository) {
    for (const plugin of plugins.values()) {
      plugin.used_by = sorted(plugin.enabled_in.flatMap((file) => repositoryOf(file) ?? []));
    }
  }

  return {
    skills: [...skills.values()],
    plugins: [...plugins.values()].sort((a, b) => a.id.localeCompare(b.id)),
    files: files.map(({ rel }) => rel),
    warnings,
  };
};

const List = z.array(z.string());

/**
 * A skill or plugin entry as `skills/` and `agent-plugins/` keep it: the fields
 * a scan writes, typed, and whatever a person added, passed through.
 */
export const SkillEntry = z
  .object({
    name: z.string().optional(),
    owner: z.string().optional(),
    format: z.string().optional(),
    repository: z.object({ id: z.string().optional() }).loose().optional(),
    used_by: List.optional(),
    description: z.string().optional(),
    allowed_tools: List.optional(),
    plugin: z.string().optional(),
    version: z.string().optional(),
    marketplace: z.string().optional(),
    source: z.string().optional(),
    path: z.string().optional(),
    skills: List.optional(),
    agents: List.optional(),
    commands: List.optional(),
    hooks: List.optional(),
    servers: List.optional(),
    enabled_in: List.optional(),
    discovery: z
      .object({
        confidence: z.string(),
        adapter: z.string(),
        sources: z.array(
          z.object({ file: z.string(), line: z.number(), symbol: z.string().optional() }),
        ),
        needs_review: List,
      })
      .partial()
      .optional(),
  })
  .loose();

export type SkillEntry = z.infer<typeof SkillEntry>;

/** A stored entry, or null when the file is not one. */
export const parseSkillEntry = (text: string): SkillEntry | null =>
  parseJson(SkillEntry, text).data ?? null;

export type SkillKind = 'skill' | 'agent-plugin';

type ScannedField =
  | 'name'
  | 'format'
  | 'repository'
  | 'used_by'
  | 'description'
  | 'allowed_tools'
  | 'plugin'
  | 'version'
  | 'marketplace'
  | 'source'
  | 'path'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'hooks'
  | 'servers'
  | 'enabled_in';

/** The fields a scan owns, so a rescan rewrites them and nothing a person decided. */
const SCANNED: Record<SkillKind, ScannedField[]> = {
  skill: ['name', 'format', 'description', 'allowed_tools', 'plugin', 'repository'],
  'agent-plugin': [
    'name',
    'description',
    'version',
    'marketplace',
    'source',
    'path',
    'skills',
    'agents',
    'commands',
    'hooks',
    'servers',
    'enabled_in',
    'used_by',
    'repository',
  ],
};

// Each grants something without anyone approving it: a tool the agent may use
// unasked, a command that runs on an event, a server it can call.
const GRANTS = new Set<ScannedField>(['allowed_tools', 'hooks', 'servers']);

const discovery = (sources: DiscoveredSource[]) => ({
  confidence: 'inferred',
  adapter: SKILLS_ADAPTER,
  sources,
  needs_review: ['owner'],
});

export const skillDraft = (skill: DiscoveredSkill): SkillEntry => ({
  name: skill.name,
  owner: 'review-needed',
  format: skill.format,
  repository: skill.repository ? { id: skill.repository } : undefined,
  description: skill.description,
  allowed_tools: skill.allowed_tools,
  plugin: skill.plugin,
  discovery: discovery(skill.sources),
});

export const pluginDraft = (plugin: DiscoveredPlugin): SkillEntry => ({
  name: plugin.name,
  owner: 'review-needed',
  description: plugin.description,
  version: plugin.version,
  marketplace: plugin.marketplace,
  source: plugin.source,
  path: plugin.path,
  skills: plugin.skills,
  agents: plugin.agents,
  commands: plugin.commands,
  hooks: plugin.hooks,
  servers: plugin.servers,
  enabled_in: plugin.enabled_in,
  used_by: plugin.used_by,
  repository: plugin.repository ? { id: plugin.repository } : undefined,
  discovery: discovery(plugin.sources),
});

/**
 * A stored entry brought up to date with a new scan: the scan's fields and
 * sources replace the old ones; owner, status and the review state stay.
 */
export const refreshSkillEntry = (
  kind: SkillKind,
  existing: SkillEntry,
  draft: SkillEntry,
): SkillEntry => {
  const scanned = new Set<string>(SCANNED[kind]);
  const kept = Object.entries(existing).filter(([key]) => !scanned.has(key));
  const fresh = Object.entries(draft).filter(([key]) => scanned.has(key));

  return SkillEntry.parse({
    ...Object.fromEntries(kept),
    ...Object.fromEntries(fresh),
    discovery: { ...draft.discovery, ...existing.discovery, sources: draft.discovery?.sources },
  });
};

/** One way a skill or plugin changed between what is committed and a new scan. */
export type SkillChange = {
  severity: 'review' | 'info';
  ref: string;
  message: string;
};

const listOf = (value: SkillEntry[ScannedField]): string[] => (Array.isArray(value) ? value : []);

/** What a rescan would change in one entry; `before` is absent for a new one, `after` for a gone one. */
export const skillChanges = (
  kind: SkillKind,
  id: string,
  before: SkillEntry | undefined,
  after: SkillEntry | undefined,
): SkillChange[] => {
  const ref = `${kind}/${id}`;

  if (!after) return [{ severity: 'info', ref, message: 'no longer found' }];

  if (!before) {
    const grants = SCANNED[kind].filter((key) => GRANTS.has(key) && listOf(after[key]).length > 0);

    return [
      {
        severity: grants.length > 0 ? 'review' : 'info',
        ref,
        message: grants.length > 0 ? `new, with ${grants.join(', ')}` : 'new',
      },
    ];
  }

  const changes: SkillChange[] = [];

  for (const key of SCANNED[kind]) {
    const [was, now] = [before[key], after[key]];

    if (Array.isArray(was) || Array.isArray(now)) {
      const gained = listOf(now).filter((item) => !listOf(was).includes(item));
      const lost = listOf(was).filter((item) => !listOf(now).includes(item));

      if (gained.length > 0) {
        changes.push({
          severity: GRANTS.has(key) ? 'review' : 'info',
          ref,
          message: `${key} gained ${gained.join(', ')}`,
        });
      }

      if (lost.length > 0) {
        changes.push({ severity: 'info', ref, message: `${key} lost ${lost.join(', ')}` });
      }
    } else if (JSON.stringify(was) !== JSON.stringify(now)) {
      changes.push({
        severity: 'info',
        ref,
        message: `${key}: ${JSON.stringify(was ?? null)} → ${JSON.stringify(now ?? null)}`,
      });
    }
  }

  return changes;
};
