import { resourceKey } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import type { DocsManifest } from '../src/manifest';
import type { Doc } from '../src/read-docs';
import { createDocsResourceGraph, DocsResourceGraphError } from '../src/resource-graph';

const docs: Doc[] = [
  {
    id: 'payments-service/runbook',
    repo: 'payments-service',
    file: 'payments-service/docs/runbook.md',
    data: {
      title: 'Payments runbook',
      owner: 'Payments',
      summary: 'How to operate payments.',
      tags: ['runbook', 'payments'],
      related: ['acme-handbook/incident-policy'],
    },
    body: '# Payments runbook',
  },
  {
    id: 'acme-handbook/incident-policy',
    repo: 'acme-handbook',
    file: 'acme-handbook/docs/incident-policy.md',
    data: { title: 'Incident policy', owner: 'Reliability' },
    body: '# Incident policy',
  },
];

const manifest: DocsManifest = {
  'payments-service/runbook': {
    title: 'Payments runbook',
    owner: 'Payments',
    updated: '2026-08-04T10:00:00.000Z',
    source: null,
    edit: null,
    linkedFrom: [],
    kind: null,
    status: null,
    date: null,
  },
  'acme-handbook/incident-policy': {
    title: 'Incident policy',
    owner: 'Reliability',
    updated: null,
    source: null,
    edit: null,
    linkedFrom: ['payments-service/runbook'],
    kind: null,
    status: null,
    date: null,
  },
};

describe('documentation resource graph Adapter', () => {
  it('compiles deterministic Document and Repository resources from convention', () => {
    const graph = createDocsResourceGraph(docs, manifest);
    expect(graph).toEqual(createDocsResourceGraph([...docs].reverse(), manifest));
    expect(graph.resources.map((resource) => resourceKey(resource.ref))).toEqual([
      'document:acme-handbook/incident-policy',
      'document:payments-service/runbook',
      'repository:acme-handbook',
      'repository:payments-service',
    ]);
    expect(graph.relationships.map((relationship) => relationship.type)).toEqual([
      'relatesTo',
      'publishes',
      'publishes',
    ]);
  });

  it('retains declared ownership and related evidence while extracting path identity', () => {
    const graph = createDocsResourceGraph(docs, manifest);

    const runbook = graph.resources.find(
      (resource) => resourceKey(resource.ref) === 'document:payments-service/runbook',
    )!;

    expect(runbook.owner).toEqual({ team: 'Payments' });
    expect(runbook.tags).toEqual(['payments', 'runbook']);
    expect(runbook.provenance).toEqual({
      default: 'declared',
      fields: { id: 'extracted', repository: 'extracted', url: 'extracted' },
    });
    expect(graph.relationships.find((edge) => edge.type === 'relatesTo')?.provenance).toBe(
      'declared',
    );
    expect(graph.relationships.filter((edge) => edge.type === 'publishes')).toHaveLength(2);
  });

  it('refuses to compile documents that did not pass into the validated manifest', () => {
    expect(() => createDocsResourceGraph(docs, {})).toThrow(DocsResourceGraphError);
  });
});
