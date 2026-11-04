import type { AgentSystemResourceKind, CatalogResource, ResourceGraph } from 'autocatalog-core';
import { expect, it } from 'vitest';
import { catalogDiagram } from '../src/diagram';

const resource = (kind: 'command' | 'queue', id: string): CatalogResource => ({
  ref: { kind, namespace: 'inventory', id },
  title: id,
  tags: [],
  provenance: { default: 'declared', fields: {} },
  needsReview: false,
  attributes: {},
});

const agentResource = (
  kind: AgentSystemResourceKind,
  id: string,
  attributes = {},
): CatalogResource => ({
  ref: { kind, id },
  title: id,
  tags: [],
  provenance: { default: 'declared', fields: {} },
  needsReview: false,
  attributes,
});

it('draws the queue a command replies on', () => {
  const command = resource('command', 'ReserveStock');
  const queue = resource('queue', 'stock-replies');

  const graph: ResourceGraph = {
    spec: 'autocatalog/graph-v1',
    resources: [command, queue],
    relationships: [
      {
        type: 'repliesTo',
        from: command.ref,
        to: queue.ref,
        provenance: 'declared',
        needsReview: false,
      },
    ],
  };

  const diagram = catalogDiagram(graph);

  expect(diagram?.nodes.map((node) => [node.type, node.label])).toEqual([
    ['command', 'ReserveStock'],
    ['channel', 'stock-replies'],
  ]);
  expect(diagram?.edges).toEqual([expect.objectContaining({ type: 'sends', label: 'replies on' })]);
});

it('draws MCP servers, with a vendor outside the company', () => {
  const tool = agentResource('tool', 'create-issue');
  const agent = agentResource('agent', 'triage');
  const ours = agentResource('mcp-server', 'ours', { origin: 'built' });
  const vendor = agentResource('mcp-server', 'vendor', { origin: 'third-party' });

  const edge = (type: 'exposedBy' | 'usesServer', from: CatalogResource, to: CatalogResource) => ({
    type,
    from: from.ref,
    to: to.ref,
    provenance: 'declared' as const,
    needsReview: false,
  });

  const diagram = catalogDiagram({
    spec: 'autocatalog/graph-v1',
    resources: [tool, agent, ours, vendor],
    relationships: [edge('exposedBy', tool, vendor), edge('usesServer', agent, ours)],
  });

  expect(diagram?.nodes.map((node) => [node.type, node.label])).toEqual([
    ['agentTool', 'create-issue'],
    ['agent', 'triage'],
    ['service', 'ours'],
    ['external-system', 'vendor'],
  ]);
  expect(diagram?.edges.map(({ label }) => label)).toEqual(['exposedBy', 'usesServer']);
});
