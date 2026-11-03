import { resourceKey, type CatalogResource, type ResourceGraph } from 'autocatalog-core';
import { z } from 'zod';

export interface McpToolRow {
  name: string;
  /** What the server claims about it; absent when it says nothing. */
  behaviour: 'read-only' | 'destructive' | 'changes data' | undefined;
}

export interface McpChangeRow {
  at: string;
  connection: string;
  tool: string;
  severity: 'breaking' | 'review' | 'info';
  summary: string;
}

/** One MCP server, with everything the catalog knows about it. */
export interface McpServerRow {
  id: string;
  title: string;
  href: string;
  summary?: string | undefined;
  owners: string[];
  origin: 'built' | 'third-party' | 'unknown';
  transport: string;
  /** Its address, package or program: how a person recognises it. */
  endpoint: string | undefined;
  versions: string[];
  /** Repositories that define it. */
  builtIn: string[];
  /** Repositories that configure it. */
  repositories: string[];
  agents: string[];
  tools: McpToolRow[];
  connections: string[];
  /** False until someone runs a snapshot, so no tools is not read as an empty server. */
  snapshotted: boolean;
  changes: McpChangeRow[];
  needsReview: boolean;
}

const attributes = z
  .object({
    origin: z.enum(['built', 'third-party', 'unknown']).catch('unknown'),
    transport: z.string().catch('stdio'),
    url: z.string().optional().catch(undefined),
    command: z.string().optional().catch(undefined),
    owners: z.array(z.string()).catch([]),
    versions: z.array(z.string()).catch([]),
    connections: z.array(z.string()).optional().catch(undefined),
    package: z
      .object({ registry: z.string(), name: z.string(), version: z.string().optional() })
      .optional()
      .catch(undefined),
    tools: z
      .array(
        z.object({
          name: z.string(),
          readOnly: z.boolean().optional(),
          destructive: z.boolean().optional(),
        }),
      )
      .catch([]),
    changes: z
      .array(
        z.object({
          at: z.string(),
          connection: z.string(),
          tool: z.string(),
          severity: z.enum(['breaking', 'review', 'info']),
          kind: z.string(),
        }),
      )
      .catch([]),
  })
  .partial({
    origin: true,
    transport: true,
    owners: true,
    versions: true,
    tools: true,
    changes: true,
  });

const behaviourOf = (tool: {
  readOnly?: boolean | undefined;
  destructive?: boolean | undefined;
}): McpToolRow['behaviour'] => {
  if (tool.readOnly) return 'read-only';

  if (tool.destructive) return 'destructive';

  return tool.destructive === false ? 'changes data' : undefined;
};

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** A discovered entry's owner until a person names one. */
const UNREVIEWED_OWNER = 'review-needed';

/** Only an id that stays inside mcp-servers/ gets a page. */
export const mcpServerPath = (id: string): boolean => /^[\w.-]+$/.test(id) && !/^\.+$/.test(id);

/** Every MCP server on the graph, with who runs it, who uses it and what it offers. */
export function buildMcpServers(graph: ResourceGraph, base: string): McpServerRow[] {
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));
  const isServer = (resource: CatalogResource) => resource.ref.kind === 'mcp-server';

  const edges = (type: string, to: CatalogResource) =>
    graph.relationships.flatMap((edge) =>
      edge.type === type && resourceKey(edge.to) === resourceKey(to.ref) ? [edge.from] : [],
    );

  return graph.resources.filter(isServer).map((resource) => {
    const facts = attributes.parse(resource.attributes);
    const users = edges('usesServer', resource);
    const exposed = edges('exposedBy', resource);

    const toolIds = new Set(exposed.map(resourceKey));

    const throughTools = graph.relationships.flatMap((edge) =>
      edge.type === 'usesTool' && toolIds.has(resourceKey(edge.to)) ? [edge.from.id] : [],
    );

    const named = new Set((facts.tools ?? []).map(({ name }) => name));

    const declared = exposed.flatMap((ref) => {
      const title = byKey.get(resourceKey(ref))?.title ?? ref.id;

      return named.has(title) ? [] : [{ name: title, behaviour: undefined }];
    });

    const version = facts.package?.version;

    return {
      id: resource.ref.id,
      title: resource.title,
      href: `${base}mcp-servers/${resource.ref.id}/`,
      summary: resource.summary,
      owners: sorted([
        ...(resource.owner ? [resource.owner.team] : []),
        ...(facts.owners ?? []),
      ]).filter((owner) => owner !== UNREVIEWED_OWNER),
      origin: facts.origin ?? 'unknown',
      transport: facts.transport ?? 'stdio',
      endpoint: facts.url ?? facts.package?.name ?? facts.command,
      versions: sorted([...(facts.versions ?? []), ...(version ? [version] : [])]),
      builtIn: sorted(edges('defines', resource).map(({ id }) => id)),
      repositories: sorted(users.filter(({ kind }) => kind === 'repository').map(({ id }) => id)),
      agents: sorted([
        ...users.filter(({ kind }) => kind === 'agent').map(({ id }) => id),
        ...throughTools,
      ]),
      tools: [
        ...(facts.tools ?? []).map((tool) => ({ name: tool.name, behaviour: behaviourOf(tool) })),
        ...declared,
      ],
      connections: facts.connections ?? [],
      snapshotted: facts.connections !== undefined,
      changes: (facts.changes ?? []).map(({ kind, ...change }) => ({
        ...change,
        summary: kind.replaceAll('_', ' '),
      })),
      needsReview: resource.needsReview,
    };
  });
}
