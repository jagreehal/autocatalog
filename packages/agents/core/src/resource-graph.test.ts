import {
  AUTOCATALOG_GRAPH_SPEC,
  composeResourceGraphs,
  createRepositoryResource,
  relationshipKey,
  resourceKey,
} from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './loader.js';
import { createAgentsResourceGraph, AgentsResourceGraphError } from './resource-graph.js';
import {
  AgentSchema,
  DomainSchema,
  ENTITY_KINDS,
  EvalSchema,
  ModelSchema,
  PolicySchema,
  ToolSchema,
  WorkflowSchema,
  type Entity,
} from './schemas.js';

const entities: Entity[] = [
  DomainSchema.parse({ id: 'support', name: 'Support', owner: 'support' }),
  ModelSchema.parse({
    id: 'fast-model',
    name: 'Fast model',
    owner: 'platform',
    provider: 'openai',
    model_id: 'fast-model-api',
    version: '2026-08-01',
  }),
  ToolSchema.parse({
    id: 'lookup-order',
    name: 'Lookup order',
    owner: 'support',
    domain: 'support',
    discovery: {
      confidence: 'reviewed',
      adapter: 'ai-sdk',
      sources: [
        { file: 'src/z.ts', line: 2 },
        { file: 'src/a.ts', line: 8, symbol: 'lookupOrder' },
      ],
      needs_review: [],
    },
  }),
  PolicySchema.parse({ id: 'refund-policy', name: 'Refund policy', owner: 'risk' }),
  AgentSchema.parse({
    id: 'refund-agent',
    name: 'Refund agent',
    owner: 'support',
    model: 'fast-model',
    tools: ['lookup-order'],
    policies: ['refund-policy'],
    domain: 'support',
    version: '2',
    repository: { id: 'support-platform', url: 'https://github.com/acme/other-name.git' },
    discovery: {
      confidence: 'inferred',
      adapter: 'ai-sdk',
      sources: [{ file: 'src/agent.ts', line: 12, symbol: 'refundAgent' }],
      needs_review: ['tools'],
    },
  }),
  WorkflowSchema.parse({
    id: 'refund-flow',
    name: 'Refund flow',
    owner: 'support',
    agents: ['refund-agent'],
    flow: [{ from: 'refund-agent', to: 'refund-agent', on: 'retry' }],
    domain: 'support',
  }),
  EvalSchema.parse({
    id: 'refund-correctness',
    name: 'Refund correctness',
    owner: 'quality',
    target: 'refund-agent',
  }),
];

function catalogOf(input: Entity[] = entities): Catalog {
  const byKind = new Map(ENTITY_KINDS.map((kind) => [kind, new Map<string, Entity>()]));
  const meta = new Map<string, { body: string; path: string }>();

  for (const entity of input) {
    byKind.get(entity.kind)?.set(entity.id, entity);
    meta.set(`${entity.kind}/${entity.id}`, {
      body: '',
      path: `/repo/${entity.kind}s/${entity.id}/index.mdx`,
    });
  }

  return { root: '/repo', entities: byKind, meta, issues: [] };
}

describe('createAgentsResourceGraph', () => {
  it('projects every Agent-system kind and its typed relationships deterministically', () => {
    const graph = createAgentsResourceGraph(catalogOf());
    const reversed = createAgentsResourceGraph(catalogOf([...entities].reverse()));

    expect(reversed).toEqual(graph);
    expect(graph.spec).toBe('autocatalog/graph-v1');
    expect(graph.resources.map((resource) => resource.ref.kind)).toEqual([
      'agent',
      'domain',
      'eval',
      'model',
      'policy',
      'repository',
      'tool',
      'workflow',
    ]);
    expect(graph.relationships.map((relationship) => relationship.type)).toEqual([
      'belongsTo',
      'governedBy',
      'usesModel',
      'usesTool',
      'evaluates',
      'defines',
      'belongsTo',
      'belongsTo',
      'orchestrates',
    ]);

    const modelEdge = graph.relationships.find(({ type }) => type === 'usesModel');
    expect(modelEdge?.to).toEqual({ kind: 'model', id: 'fast-model', version: '2026-08-01' });
    expect(modelEdge?.from).toEqual({ kind: 'agent', id: 'refund-agent', version: '2' });
    expect(graph.relationships.find(({ type }) => type === 'usesTool')).toMatchObject({
      provenance: 'inferred',
      needsReview: true,
    });
    expect(graph.resources.find(({ ref }) => ref.kind === 'tool')?.source).toEqual({
      type: 'code',
      file: 'src/a.ts',
      line: 8,
      symbol: 'lookupOrder',
    });
    expect(graph.resources.find(({ ref }) => ref.kind === 'agent')?.attributes).not.toHaveProperty(
      'model',
    );
    expect(
      graph.resources.some(({ ref }) => resourceKey(ref) === 'repository:support-platform'),
    ).toBe(true);
    expect(new Set(graph.relationships.map(relationshipKey)).size).toBe(graph.relationships.length);
  });

  it('rejects load failures and dangling relationships instead of publishing a partial graph', () => {
    const broken = catalogOf(entities.filter((entity) => entity.kind !== 'model'));
    broken.issues.push({ kind: 'parse', path: '/repo/bad.json', message: 'invalid JSON' });

    expect(() => createAgentsResourceGraph(broken)).toThrow(AgentsResourceGraphError);

    try {
      createAgentsResourceGraph(broken);
    } catch (error) {
      if (!(error instanceof AgentsResourceGraphError)) throw error;
      expect(error.failures).toEqual(
        expect.arrayContaining([
          '/repo/bad.json: invalid JSON',
          'Agent "refund-agent" references unknown Model "fast-model"',
        ]),
      );
    }
  });

  it('composes through an explicitly shared repository identity', () => {
    const agents = createAgentsResourceGraph(catalogOf());
    const repository = createRepositoryResource('support-platform');

    const composed = composeResourceGraphs(agents, {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [repository],
      relationships: [],
    });

    expect(
      composed.resources.filter(({ ref }) => resourceKey(ref) === 'repository:support-platform'),
    ).toEqual([repository]);
  });

  it('omits standalone URLs when embedded in another shell', () => {
    const withoutRepository = entities.map((entity) =>
      entity.kind === 'agent' ? AgentSchema.parse({ ...entity, repository: undefined }) : entity,
    );

    const graph = createAgentsResourceGraph(catalogOf(withoutRepository), {
      urls: false,
      repository: 'support-platform',
    });

    expect(graph.resources.every((resource) => resource.url === undefined)).toBe(true);
    expect(
      graph.relationships.some(
        (relationship) =>
          relationship.type === 'defines' &&
          resourceKey(relationship.from) === 'repository:support-platform',
      ),
    ).toBe(true);
  });
});
