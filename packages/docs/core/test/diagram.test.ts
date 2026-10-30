import type { CatalogResource, ResourceGraph } from 'autocatalog-core';
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
