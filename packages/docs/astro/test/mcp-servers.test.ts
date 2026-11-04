import {
  AUTOCATALOG_GRAPH_SPEC,
  type AgentSystemResourceKind,
  type CatalogRelationship,
  type CatalogResource,
  type JsonObject,
  type ResourceRef,
} from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import { buildMcpServers, mcpServerPath } from '../src/mcp-servers';

const resource = (
  ref: ResourceRef<AgentSystemResourceKind>,
  attributes: JsonObject = {},
): CatalogResource => ({
  ref,
  title: ref.id,
  owner: { team: 'platform' },
  tags: [],
  provenance: { default: 'inferred', fields: {} },
  needsReview: true,
  attributes,
});

const edge = (
  type: CatalogRelationship['type'],
  from: ResourceRef,
  to: ResourceRef,
): CatalogRelationship => ({ type, from, to, provenance: 'declared', needsReview: false });

const server = { kind: 'mcp-server', id: 'vendor' } as const;

const tool = { kind: 'tool', id: 'vendor.search' } as const;

describe('buildMcpServers', () => {
  it('gathers who runs a server, who uses it and what it offers', () => {
    const [row] = buildMcpServers(
      {
        spec: AUTOCATALOG_GRAPH_SPEC,
        resources: [
          resource(server, {
            origin: 'third-party',
            transport: 'http',
            url: 'https://mcp.vendor.com/mcp',
            owners: ['support'],
            versions: ['1.0.0', '2.0.0'],
            connections: ['default'],
            tools: [
              { name: 'search', readOnly: true },
              { name: 'wipe', destructive: true },
              { name: 'export' },
            ],
            changes: [
              {
                at: '2026-11-03T10:00:00.000Z',
                connection: 'default',
                tool: 'wipe',
                severity: 'review',
                kind: 'tool_added',
              },
            ],
          }),
          resource(tool),
        ],
        relationships: [
          edge('usesServer', { kind: 'repository', id: 'payments' }, server),
          edge('usesServer', { kind: 'agent', id: 'broad' }, server),
          edge('exposedBy', tool, server),
          edge('usesTool', { kind: 'agent', id: 'triage' }, tool),
        ],
      },
      '/',
    );

    expect(row).toMatchObject({
      href: '/mcp-servers/vendor/',
      origin: 'third-party',
      endpoint: 'https://mcp.vendor.com/mcp',
      owners: ['platform', 'support'],
      versions: ['1.0.0', '2.0.0'],
      repositories: ['payments'],
      agents: ['broad', 'triage'],
      snapshotted: true,
      needsReview: true,
    });
    expect(row?.tools.slice(0, 3)).toEqual([
      { name: 'search', behaviour: 'read-only' },
      { name: 'wipe', behaviour: 'destructive' },
      { name: 'export', behaviour: undefined },
    ]);
    expect(row?.changes[0]).toMatchObject({ summary: 'tool added', severity: 'review' });
  });

  it('tells a server nobody has asked from one with no tools', () => {
    const rows = buildMcpServers(
      {
        spec: AUTOCATALOG_GRAPH_SPEC,
        resources: [resource(server, { transport: 'stdio', command: 'node' })],
        relationships: [],
      },
      '/docs/',
    );

    expect(rows[0]).toMatchObject({
      href: '/docs/mcp-servers/vendor/',
      endpoint: 'node',
      snapshotted: false,
      tools: [],
    });
  });

  it('keeps a page inside its folder', () => {
    expect(mcpServerPath('acme.dev')).toBe(true);
    expect(mcpServerPath('..')).toBe(false);
    expect(mcpServerPath('a/b')).toBe(false);
  });
});
