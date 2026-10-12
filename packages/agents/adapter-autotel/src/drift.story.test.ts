import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';
import type { Catalog, Entity, EntityKind } from 'autocatalog-agents-core';
import { computeDrift } from './diff.js';
import { parseOtlpJson } from './parse.js';

const catalog: Catalog = {
  root: 'fixture',
  entities: new Map<EntityKind, Map<string, Entity>>([
    [
      'agent',
      new Map<string, Entity>([
        [
          'refund-agent',
          {
            id: 'refund-agent',
            kind: 'agent',
            name: 'Refund Agent',
            owner: 'support-ops',
            status: 'active',
            model: 'declared-model',
            tools: ['lookup-order'],
            policies: [],
            risk: 'medium',
          },
        ],
      ]),
    ],
    [
      'tool',
      new Map<string, Entity>([
        [
          'lookup-order',
          {
            id: 'lookup-order',
            kind: 'tool',
            name: 'Lookup Order',
            owner: 'support-ops',
            status: 'active',
            side_effects: 'read-only',
            risk: 'low',
          },
        ],
      ]),
    ],
    [
      'model',
      new Map<string, Entity>([
        [
          'declared-model',
          {
            id: 'declared-model',
            kind: 'model',
            name: 'Declared Model',
            owner: 'platform',
            status: 'active',
            provider: 'openai',
            model_id: 'declared-model',
          },
        ],
      ]),
    ],
    ['workflow', new Map()],
    ['domain', new Map()],
    ['eval', new Map()],
    ['policy', new Map()],
  ]),
  meta: new Map(),
  issues: [],
};

const otlp = JSON.stringify({
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'agent.id', value: { stringValue: 'refund-agent' } }] },
      scopeSpans: [
        {
          spans: [
            {
              name: 'gen_ai.chat.completion',
              attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'shadow-model' } }],
            },
            {
              name: 'tool.call',
              attributes: [{ key: 'tool.name', value: { stringValue: 'issue-refund' } }],
            },
          ],
        },
      ],
    },
    {
      resource: { attributes: [{ key: 'agent.id', value: { stringValue: 'mystery-agent' } }] },
      scopeSpans: [{ spans: [{ name: 'gen_ai.chat.completion' }] }],
    },
  ],
});

describe('Production agent drift', () => {
  it('detects undeclared agents, tools, and model changes from OTLP traces', ({ task }) => {
    story.init(task);
    story.given('a declared catalog and production traces from running agents');

    const observations = parseOtlpJson(otlp);

    story.when('autocatalog-agents compares observed behavior with declared behavior');

    const report = computeDrift(catalog, observations);

    story.then('runtime drift is reported as actionable AI-agent findings');

    expect(report.observedAgents).toBe(2);
    expect(report.observedSpans).toBe(3);
    expect(report.byKind).toMatchObject({
      'unknown-agent': 1,
      'undeclared-tool': 1,
      'unknown-tool': 1,
      'unused-declared-tool': 1,
      'model-mismatch': 1,
      'undeclared-model': 1,
    });
    expect(report.drifts.map((drift) => drift.kind)).toEqual(
      expect.arrayContaining([
        'unknown-agent',
        'undeclared-tool',
        'unknown-tool',
        'unused-declared-tool',
        'model-mismatch',
        'undeclared-model',
      ]),
    );
  });

  it('reconciles provider model ids and span-level agent ids from production traces', ({
    task,
  }) => {
    story.init(task);
    story.given('a catalog declares an internal model id with a provider-facing model id');

    const productionCatalog: Catalog = {
      ...catalog,
      entities: new Map(catalog.entities),
    };

    productionCatalog.entities.set(
      'agent',
      new Map<string, Entity>([
        [
          'refund-agent',
          {
            id: 'refund-agent',
            kind: 'agent',
            name: 'Refund Agent',
            owner: 'support-ops',
            status: 'active',
            model: 'declared-model',
            tools: ['lookup-order'],
            policies: [],
            risk: 'medium',
          },
        ],
      ]),
    );
    productionCatalog.entities.set(
      'model',
      new Map<string, Entity>([
        [
          'declared-model',
          {
            id: 'declared-model',
            kind: 'model',
            name: 'Declared Model',
            owner: 'platform',
            status: 'active',
            provider: 'openai',
            model_id: 'gpt-4.1-mini',
          },
        ],
      ]),
    );

    const spanLevelAgentOtlp = JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'agent-runtime' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  name: 'gen_ai.chat.completion',
                  attributes: [
                    { key: 'agent.id', value: { stringValue: 'refund-agent' } },
                    { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4.1-mini' } },
                  ],
                },
                {
                  name: 'tool.call',
                  attributes: [
                    { key: 'agent.id', value: { stringValue: 'refund-agent' } },
                    { key: 'tool.name', value: { stringValue: 'lookup-order' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    story.when('traces use OpenTelemetry span attributes and provider model names');

    const observations = parseOtlpJson(spanLevelAgentOtlp);
    const report = computeDrift(productionCatalog, observations);

    story.then('autocatalog-agents still treats production as matching the declaration');

    expect(report.observedAgents).toBe(1);
    expect(report.observedSpans).toBe(2);
    expect(report.driftCount).toBe(0);
    expect(report.drifts).toEqual([]);
  });
});
