import { join } from 'node:path';
import {
  assessEventChange,
  compatibilityViolations,
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from 'autocatalog-core';
import { z } from 'zod';
import { toId, type DiscoveredSource } from './discovery.js';
import { entitiesOf, type Catalog } from './loader.js';
import { DIR_BY_KIND, type McpServer, type SideEffect, type Risk } from './schemas.js';

export const MCP_SNAPSHOT_SPEC = 'autocatalog/mcp-snapshot-v1';

export const MCP_SNAPSHOT_ADAPTER = 'mcp-snapshot';

const ToolAnnotations = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

/** What a tool promises. Every other field a server sends is dropped here. */
export const McpToolSnapshotSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonObjectSchema.optional(),
  outputSchema: jsonObjectSchema.optional(),
  annotations: ToolAnnotations.optional(),
});

export const McpSnapshotSchema = z.object({
  spec: z.literal(MCP_SNAPSHOT_SPEC),
  server: z.string().min(1),
  /** The identity it was taken as: two accounts can see different tools. */
  connection: z.string().min(1),
  source: z.enum(['live', 'executor']),
  protocol: z.string().optional(),
  server_version: z.string().optional(),
  /** `private` means another caller may be served a different list. */
  scope: z.enum(['public', 'private']).optional(),
  tools: z.array(McpToolSnapshotSchema),
});

export type McpToolSnapshot = z.infer<typeof McpToolSnapshotSchema>;

export type McpSnapshot = z.infer<typeof McpSnapshotSchema>;

export const MCP_SNAPSHOT_DIR = 'snapshots';

export const DEFAULT_CONNECTION = 'default';

/** One change, as a dated fact. Holds no text the server wrote, so it is safe to publish. */
export const McpChangeRecordSchema = z.object({
  at: z.string().min(1),
  connection: z.string().min(1),
  tool: z.string().min(1),
  severity: z.enum(['breaking', 'review', 'info']),
  kind: z.string().min(1),
});

export const McpChangeLogSchema = z.array(McpChangeRecordSchema);

export type McpChangeRecord = z.infer<typeof McpChangeRecordSchema>;

export const MCP_CHANGES_FILE = 'changes.json';

/** How many changes a server keeps; `git log` holds the rest. */
const MAX_CHANGES = 200;

export const mcpChangesPath = (root: string, server: string): string =>
  join(root, DIR_BY_KIND['mcp-server'], server, MCP_CHANGES_FILE);

/** A tool name fit to publish, since the server chose it. */
const publishedToolName = (name: string): string =>
  /^[\w.-]{1,128}$/.test(name) ? name : '(unusual name)';

/** New changes ahead of the old, newest first, without the `info` noise. */
export const appendMcpChanges = (
  log: McpChangeRecord[],
  changes: McpChange[],
  at: string,
): McpChangeRecord[] =>
  [
    ...changes.flatMap(({ severity, kind, connection, tool }) =>
      severity === 'info'
        ? []
        : [{ at, connection, tool: publishedToolName(tool), severity, kind }],
    ),
    ...log,
  ].slice(0, MAX_CHANGES);

/** What the catalog publishes about a server's tools. Descriptions stay in the snapshot. */
export const mcpServerFacts = (cat: Catalog, server: string): JsonObject => {
  const snapshots = cat.snapshots.get(server) ?? [];
  const tools = new Map<string, JsonObject>();

  for (const tool of snapshots.flatMap((snapshot) => snapshot.tools)) {
    const name = publishedToolName(tool.name);
    const entry: JsonObject = { name };

    if (tool.annotations?.readOnlyHint !== undefined) {
      entry.readOnly = tool.annotations.readOnlyHint;
    }

    if (tool.annotations?.destructiveHint !== undefined) {
      entry.destructive = tool.annotations.destructiveHint;
    }

    tools.set(name, entry);
  }

  const facts: JsonObject = {};

  if (snapshots.length > 0) {
    facts.tools = [...tools.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    facts.connections = snapshots.map(({ connection }) => connection).sort();
  }

  const changes = cat.changes.get(server);

  if (changes?.length) facts.changes = changes;

  return facts;
};

/**
 * A connection as a file name. Two identities must never share a baseline, so
 * this is reversible, and lowercase so a case-insensitive disk cannot merge them.
 */
const connectionFile = (connection: string): string =>
  encodeURIComponent(connection).replace(/%[0-9A-F]{2}|[^a-z0-9-]/g, (match) =>
    match.length === 3 ? match : `%${match.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const mcpSnapshotPath = (root: string, server: string, connection: string): string =>
  join(
    root,
    DIR_BY_KIND['mcp-server'],
    server,
    MCP_SNAPSHOT_DIR,
    `${connectionFile(connection)}.json`,
  );

/** A snapshot from what a server returned: known fields only, tools by name. */
export const createMcpSnapshot = (input: Omit<McpSnapshot, 'spec'>): McpSnapshot => {
  const snapshot = McpSnapshotSchema.parse({ spec: MCP_SNAPSHOT_SPEC, ...input });

  return {
    ...snapshot,
    tools: [...snapshot.tools].sort((a, b) => a.name.localeCompare(b.name)),
  };
};

const sortKeys = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(sortKeys);

  const record = jsonObjectSchema.safeParse(value);

  if (!record.success) return value;

  return Object.fromEntries(
    Object.entries(record.data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortKeys(item)]),
  );
};

/** JSON with object keys sorted, so a server reordering a schema is not a change. */
export const serialiseMcpSnapshot = (snapshot: McpSnapshot): string =>
  `${JSON.stringify(sortKeys(jsonValueSchema.parse(JSON.parse(JSON.stringify(snapshot)))), null, 2)}\n`;

export type McpChangeSeverity = 'breaking' | 'review' | 'info';

export type McpChange = {
  server: string;
  connection: string;
  tool: string;
  severity: McpChangeSeverity;
  kind: string;
  message: string;
  /** Agents the change reaches. */
  agents: string[];
};

/**
 * Text a server wrote, made safe to print: a description can hold terminal
 * escapes or read like an instruction, so it is shown short and on one line.
 */
export const cleanServerText = (text: string, limit = 160): string => {
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

  return line.length > limit ? `${line.slice(0, limit)}…` : line;
};

type Direction = 'input' | 'output';

/**
 * `input` runs the opposite way to an event: the agent writes and the server
 * reads, so what breaks it is a change a new reader cannot accept from old
 * data. `output` runs the way an event does, and event severity already says
 * what breaks a reader.
 */
const schemaChanges = (
  direction: Direction,
  server: string,
  tool: string,
  previous: McpToolSnapshot,
  current: McpToolSnapshot,
): Array<Pick<McpChange, 'severity' | 'kind' | 'message'>> => {
  const key = direction === 'input' ? 'inputSchema' : 'outputSchema';

  return assessEventChange({
    domain: server,
    eventId: tool,
    consumers: [],
    previous: previous[key] ?? {},
    proposed: current[key] ?? {},
  }).map((finding) => {
    const breaks =
      direction === 'input'
        ? compatibilityViolations(finding).includes('backward')
        : finding.severity === 'breaking';

    const notable =
      finding.kind === 'description_changed' ||
      finding.severity === 'breaking' ||
      finding.severity === 'suspicious';

    return {
      severity: breaks ? 'breaking' : notable ? 'review' : 'info',
      kind: `${direction}_${finding.kind}`,
      message: `${direction}: ${cleanServerText(finding.message)}`,
    };
  });
};

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

/**
 * Compare two snapshots of one server. A new tool is `review`, never `info`:
 * it is authority an agent gained without anyone granting it. So is a changed
 * description, which is an instruction to the model.
 */
export const diffMcpSnapshots = (
  previous: McpSnapshot,
  current: McpSnapshot,
  reach: (tool: string) => string[] = () => [],
): McpChange[] => {
  const before = new Map(previous.tools.map((tool) => [tool.name, tool]));
  const after = new Map(current.tools.map((tool) => [tool.name, tool]));
  const changes: McpChange[] = [];
  const comparesHints = previous.source === current.source;

  const add = (tool: string, change: Pick<McpChange, 'severity' | 'kind' | 'message'>) =>
    changes.push({
      server: current.server,
      connection: current.connection,
      tool,
      agents: change.severity === 'info' ? [] : reach(tool),
      ...change,
    });

  for (const [name] of before) {
    if (!after.has(name)) {
      add(name, { severity: 'breaking', kind: 'tool_removed', message: 'tool removed' });
    }
  }

  for (const [name, tool] of after) {
    const was = before.get(name);

    if (!was) {
      add(name, { severity: 'review', kind: 'tool_added', message: 'new tool' });
      continue;
    }

    if (was.description !== tool.description) {
      add(name, {
        severity: 'review',
        kind: 'description_changed',
        message: `description changed: "${cleanServerText(was.description ?? '')}" → "${cleanServerText(tool.description ?? '')}"`,
      });
    }

    for (const direction of ['input', 'output'] as const) {
      for (const change of schemaChanges(direction, current.server, name, was, tool)) {
        add(name, change);
      }
    }

    for (const hint of comparesHints ? HINTS : []) {
      const [from, to] = [was.annotations?.[hint], tool.annotations?.[hint]];

      if (from !== to) {
        add(name, {
          severity: 'review',
          kind: 'annotation_changed',
          message: `${hint} changed from ${String(from)} to ${String(to)}`,
        });
      }
    }
  }

  return changes;
};

/** The agents a tool on a server reaches: by the tool, or by declaring the whole server. */
export const agentsUsingMcpTool = (cat: Catalog, server: string, tool: string): string[] => {
  const entities = entitiesOf(cat, 'tool').filter(
    (entity) => entity.server === server && (entity.mcp_name ?? entity.id) === tool,
  );

  return entitiesOf(cat, 'agent')
    .flatMap((agent) =>
      agent.servers.includes(server) || entities.some(({ id }) => agent.tools.includes(id))
        ? [agent.id]
        : [],
    )
    .sort();
};

const MARKS: Record<McpChangeSeverity, string> = {
  breaking: 'breaking',
  review: 'review  ',
  info: 'info    ',
};

const reachOf = ({ agents }: McpChange): string =>
  agents.length > 0 ? ` → reaches ${agents.join(', ')}` : '';

export const renderMcpChange = (change: McpChange): string =>
  `${MARKS[change.severity]} ${change.server}/${cleanServerText(change.tool, 80)}: ${change.message}${reachOf(change)}`;

const escapeData = (text: string): string =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const escapeProperty = (text: string): string =>
  escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** One GitHub Actions annotation per change, for a scheduled job's run page. */
export const renderMcpChangesGitHub = (changes: McpChange[]): string =>
  changes
    .flatMap((change) => {
      if (change.severity === 'info') return [];

      const level = change.severity === 'breaking' ? 'error' : 'warning';
      const title = escapeProperty(`${change.server}/${cleanServerText(change.tool, 80)}`);

      return [`::${level} title=${title}::${escapeData(`${change.message}${reachOf(change)}`)}`];
    })
    .join('\n');

const sideEffectsOf = (tool: McpToolSnapshot): SideEffect => {
  const { readOnlyHint, destructiveHint } = tool.annotations ?? {};

  if (readOnlyHint === true) return 'read-only';

  if (destructiveHint === true) return 'destructive';

  return destructiveHint === false ? 'mutating' : 'unknown';
};

const RISK_BY_EFFECT: Record<SideEffect, Risk> = {
  unknown: 'medium',
  'read-only': 'low',
  mutating: 'medium',
  'external-write': 'high',
  destructive: 'high',
};

export const mcpToolId = (server: string, tool: string): string => `${server}.${toId(tool)}`;

/**
 * A Tool entry from a snapshot. Annotations are the server's own claim, so side
 * effects stay marked for review. The description stays in the snapshot: an
 * entry is served to agents, and this text was written by the server.
 */
export const mcpToolDraft = (
  server: McpServer,
  tool: McpToolSnapshot,
  source: DiscoveredSource,
) => {
  const side_effects = sideEffectsOf(tool);

  return {
    name: cleanServerText(tool.title ?? tool.name, 80),
    owner: server.owner,
    server: server.id,
    mcp_name: tool.name,
    protocol: 'mcp',
    side_effects,
    risk: RISK_BY_EFFECT[side_effects],
    discovery: {
      confidence: 'inferred',
      adapter: MCP_SNAPSHOT_ADAPTER,
      sources: [source],
      needs_review: ['side_effects', 'risk', 'domain'],
    },
  };
};
