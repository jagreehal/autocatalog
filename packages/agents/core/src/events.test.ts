import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCatalog as loadEventCatalog } from 'autocatalog-core';
import { describe, expect, it } from 'vitest';
import {
  eventParticipants,
  linkAgentsToEvents,
  linkEvents,
  resolveEventRef,
  withEventParticipants,
} from './events.js';
import { computeEventImpact, computeImpact } from './impact.js';
import type { Catalog } from './loader.js';
import { AgentsResourceGraphError, createAgentsResourceGraph } from './resource-graph.js';
import { AgentSchema, ENTITY_KINDS, ModelSchema, ToolSchema, type Entity } from './schemas.js';

const starter = path.resolve(import.meta.dirname, '../../../../starters/agent-default');

const events = [
  { domain: 'payments', id: 'refund.issued' },
  { domain: 'support', id: 'ticket.opened' },
  { domain: 'billing', id: 'invoice.paid' },
  { domain: 'payments', id: 'invoice.paid' },
];

function catalogOf(
  extra: Array<{ id: string; consumes?: Array<{ event: string; fields?: string[] }> }> = [],
): Catalog {
  const input: Entity[] = [
    ModelSchema.parse({ id: 'm', name: 'M', owner: 'platform', provider: 'x', model_id: 'm' }),
    ToolSchema.parse({
      id: 'issue-refund',
      name: 'Issue refund',
      owner: 'payments',
      produces: ['payments/refund.issued'],
    }),
    AgentSchema.parse({
      id: 'triage-agent',
      name: 'Triage',
      owner: 'support',
      model: 'm',
      consumes: [{ event: 'ticket.opened' }, { event: 'ticket.opened' }],
    }),
    AgentSchema.parse({
      id: 'refund-agent',
      name: 'Refund',
      owner: 'support',
      model: 'm',
      tools: ['issue-refund'],
    }),
    ...extra.map((e) => AgentSchema.parse({ name: 'Extra', owner: 'x', model: 'm', ...e })),
  ];

  const byKind = new Map(ENTITY_KINDS.map((kind) => [kind, new Map<string, Entity>()]));

  for (const entity of input) byKind.get(entity.kind)?.set(entity.id, entity);

  return { root: '/repo', entities: byKind, meta: new Map(), issues: [] };
}

describe('resolving an event reference', () => {
  it('takes domain/id exactly, and a bare id when one domain has it', () => {
    expect(resolveEventRef('payments/refund.issued', events)).toEqual({
      event: 'payments/refund.issued',
    });
    expect(resolveEventRef('ticket.opened', events)).toEqual({ event: 'support/ticket.opened' });
  });

  it('refuses to guess a bare id two domains define, and names both', () => {
    expect(resolveEventRef('invoice.paid', events)).toEqual({
      reason: 'ambiguous',
      matches: ['billing/invoice.paid', 'payments/invoice.paid'],
    });
  });

  it('suggests the near miss, and only a near one', () => {
    expect(resolveEventRef('support/ticket.open', events)).toEqual({
      reason: 'unknown',
      hint: 'support/ticket.opened',
    });
    expect(resolveEventRef('refund.isued', events)).toEqual({
      reason: 'unknown',
      hint: 'refund.issued',
    });
    expect(resolveEventRef('order.shipped', events)).toEqual({
      reason: 'unknown',
      hint: undefined,
    });
  });
});

describe('linking a catalog to its events', () => {
  it('resolves every declared reference, once each', () => {
    const { links, issues } = linkEvents(catalogOf(), events);

    expect(issues).toEqual([]);
    expect(links).toEqual([
      {
        from: { kind: 'agent', id: 'triage-agent' },
        direction: 'consumes',
        ref: 'ticket.opened',
        event: 'support/ticket.opened',
      },
      {
        from: { kind: 'tool', id: 'issue-refund' },
        direction: 'produces',
        ref: 'payments/refund.issued',
        event: 'payments/refund.issued',
      },
    ]);
  });

  it('says which entity is wrong, how, and what it probably meant', () => {
    const { issues } = linkEvents(
      catalogOf([
        {
          id: 'bad-agent',
          consumes: [{ event: 'support/ticket.open' }, { event: 'invoice.paid' }],
        },
      ]),
      events,
    );

    expect(issues.map((issue) => issue.message)).toEqual([
      'Agent "bad-agent" consumes "invoice.paid", which more than one domain defines (billing/invoice.paid, payments/invoice.paid) — write it as domain/id',
      'Agent "bad-agent" consumes unknown event "support/ticket.open" — did you mean "support/ticket.opened"?',
    ]);
  });

  it('folds agents into the producers and consumers an event already names', async () => {
    const loaded = await loadEventCatalog(path.join(starter, 'events'), { skipVersioned: true });
    const participants = eventParticipants(linkEvents(catalogOf(), events).links);

    const merged = withEventParticipants(loaded, participants);
    const byId = new Map(merged.map((event) => [event.frontmatter.id, event.frontmatter]));

    expect(byId.get('ticket.opened')?.consumers).toEqual(['agent/triage-agent']);
    expect(byId.get('refund.issued')?.producers).toEqual(['PaymentService', 'tool/issue-refund']);
    // The service consumer the event already named is kept, not replaced.
    expect(byId.get('refund.issued')?.consumers).toEqual(['LedgerService']);
    // Nobody said which fields they read, so no field usage is invented.
    expect(byId.get('ticket.opened')?.consumerFields).toBeUndefined();
  });

  it('carries the fields an agent says it reads, and leaves one without fields unspecified', () => {
    const cat = catalogOf([
      {
        id: 'refund-auditor',
        consumes: [{ event: 'payments/refund.issued', fields: ['amount', 'lines[].sku'] }],
      },
    ]);

    const participants = eventParticipants(linkEvents(cat, events).links);

    expect(participants.get('payments/refund.issued')?.consumerFields).toEqual({
      'agent/refund-auditor': ['amount', 'lines[].sku'],
    });
    expect(participants.get('support/ticket.opened')?.consumerFields).toBeUndefined();
    expect(computeImpact(cat, { kind: 'agent', id: 'refund-auditor' }).events?.consumes).toEqual([
      'payments/refund.issued',
    ]);
  });

  it('takes a consumed event only as { event }, never a bare string', () => {
    const agent = { id: 'a', name: 'A', owner: 'x', model: 'm' };

    expect(AgentSchema.safeParse({ ...agent, consumes: ['support/ticket.opened'] }).success).toBe(
      false,
    );
    expect(
      AgentSchema.safeParse({ ...agent, consumes: [{ event: 'support/ticket.opened' }] }).success,
    ).toBe(true);
  });
});

describe('impact across the two catalogs', () => {
  it("lists an agent's events alongside what it depends on", () => {
    expect(computeImpact(catalogOf(), { kind: 'agent', id: 'triage-agent' }).events).toEqual({
      produces: [],
      consumes: ['ticket.opened'],
    });
    // An agent that names no events has no events section at all.
    expect(computeImpact(catalogOf(), { kind: 'agent', id: 'refund-agent' })).not.toHaveProperty(
      'events',
    );
  });

  it('reaches the agents that only touch an event through a tool', () => {
    const cat = catalogOf();
    const report = computeEventImpact(cat, linkEvents(cat, events).links, 'payments/refund.issued');

    expect(report).toEqual({
      event: 'payments/refund.issued',
      producers: [{ kind: 'tool', id: 'issue-refund' }],
      consumers: [],
      viaTools: [
        {
          agent: { kind: 'agent', id: 'refund-agent' },
          tool: { kind: 'tool', id: 'issue-refund' },
          direction: 'produces',
        },
      ],
    });
  });
});

describe('event edges in the shared graph', () => {
  const graphEvent = (repository: string, domain: string, id: string) => ({
    ref: { kind: 'event', namespace: `${repository}/${domain}`, id, version: '1.0.0' },
    domain,
    id,
    repository,
  });

  it('draws produces and consumes to the exact Event resource', () => {
    const graph = createAgentsResourceGraph(catalogOf(), {
      repository: 'support-platform',
      events: [
        graphEvent('payments-service', 'payments', 'refund.issued'),
        graphEvent('support-platform', 'support', 'ticket.opened'),
      ],
    });

    const edge = (r: (typeof graph.relationships)[number]) =>
      `${r.from.kind}:${r.from.namespace ?? ''}/${r.from.id} -${r.type}-> ${r.to.kind}:${r.to.namespace ?? ''}/${r.to.id}`;

    // The direction the event catalog uses for services: producer → event → consumer.
    expect(
      graph.relationships.filter((r) => r.type === 'produces' || r.type === 'consumes').map(edge),
    ).toEqual([
      'event:support-platform/support/ticket.opened -consumes-> agent:/triage-agent',
      'tool:/issue-refund -produces-> event:payments-service/payments/refund.issued',
    ]);

    // Drawn as edges, so not repeated as attributes.
    const triage = graph.resources.find((r) => r.ref.id === 'triage-agent');
    expect(triage?.attributes).not.toHaveProperty('consumes');
  });

  it('prefers the copy in its own repository, and refuses to pick between two others', () => {
    const both = [
      graphEvent('support-platform', 'support', 'ticket.opened'),
      graphEvent('legacy-desk', 'support', 'ticket.opened'),
      graphEvent('payments-service', 'payments', 'refund.issued'),
    ];

    const local = createAgentsResourceGraph(catalogOf(), {
      repository: 'support-platform',
      events: both,
    });

    expect(local.relationships.find((r) => r.type === 'consumes')?.from.namespace).toBe(
      'support-platform/support',
    );

    expect(() =>
      createAgentsResourceGraph(catalogOf(), { repository: 'elsewhere', events: both }),
    ).toThrow(AgentsResourceGraphError);

    expect(() =>
      createAgentsResourceGraph(catalogOf(), { repository: 'elsewhere', events: both }),
    ).toThrow(
      'agent/triage-agent consumes "ticket.opened", which 2 repositories publish (legacy-desk, support-platform) — declare it in the repository that owns the event, or rename one',
    );
  });

  it('fails the graph on a reference no repository publishes', () => {
    expect(() =>
      createAgentsResourceGraph(catalogOf(), {
        events: [graphEvent('support-platform', 'support', 'ticket.opened')],
      }),
    ).toThrow(/Tool "issue-refund" produces unknown event "payments\/refund.issued"/);
  });

  it('keeps the references as attributes when no event catalog is composed in', () => {
    const graph = createAgentsResourceGraph(catalogOf());

    expect(graph.relationships.some((r) => r.type === 'produces' || r.type === 'consumes')).toBe(
      false,
    );
    expect(graph.resources.find((r) => r.ref.id === 'triage-agent')?.attributes).toMatchObject({
      consumes: [{ event: 'ticket.opened' }, { event: 'ticket.opened' }],
    });
  });
});

describe('linking catalogs on disk', () => {
  it('costs nothing for a repository with no agent catalog', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-agents-none-'));

    try {
      expect(await linkAgentsToEvents({ agentsRoot: empty, events })).toBeUndefined();
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('links the starter, whose agents and events sit side by side', async () => {
    const linked = await linkAgentsToEvents({
      agentsRoot: starter,
      eventsRoot: path.join(starter, 'events'),
    });

    expect(linked?.issues).toEqual([]);
    expect(Object.fromEntries(linked!.participants)).toEqual({
      'payments/refund.issued': { producers: ['tool/issue-refund'], consumers: [] },
      'support/ticket.opened': { producers: [], consumers: ['agent/triage-agent'] },
    });
  });
});

describe('agent declarations beside runtime evidence', () => {
  it('retains agent consumers as declarations without mutating the saved snapshot', async () => {
    const loaded = await loadEventCatalog(path.join(starter, 'events'));
    const ticket = loaded.find((event) => event.frontmatter.id === 'ticket.opened')!;
    ticket.frontmatter.observed = {
      count: 1,
      firstSeen: '',
      lastSeen: '',
      consumers: ['UnknownService'],
      producers: [],
      declaredConsumers: [],
      consumerEvidence: 'reported',
      snapshot: { spec: 'autotel-architecture/v0.1.0', generatedAt: '' },
    };

    const linked = withEventParticipants(
      [ticket],
      new Map([['support/ticket.opened', { producers: [], consumers: ['agent/triage-agent'] }]]),
    );

    expect(linked[0]?.frontmatter.observed?.declaredConsumers).toEqual(['agent/triage-agent']);
    expect(linked[0]?.frontmatter.observed?.consumers).toEqual(['UnknownService']);
    expect(ticket.frontmatter.observed.declaredConsumers).toEqual([]);
  });
});
