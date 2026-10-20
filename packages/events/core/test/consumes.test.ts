import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOCATALOG_GRAPH_SPEC,
  CONSUMES_FILE,
  UNSAFE_CONSUMER,
  checkConsumerDeclarations,
  consumersFromGraph,
  createConsumerResourceGraph,
  mergeConsumerGraph,
  readConsumerDeclarations,
  type EventCatalogResource,
  type ResourceGraph,
} from '../src';

// A consumer says what it consumes from its own repository, so a producer in
// another repository learns who it would break.

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-consumes-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const declare = (body: { consumes: Array<Record<string, string | string[]>> }) =>
  fs.writeFile(path.join(root, CONSUMES_FILE), JSON.stringify(body));

const event = (repository: string, domain: string, id: string) => ({
  ref: { kind: 'event' as const, namespace: `${repository}/${domain}`, id, version: '1.0.0' },
  domain,
  id,
  repository,
});

describe('readConsumerDeclarations', () => {
  it('is empty for a repository that consumes nothing', async () => {
    expect(await readConsumerDeclarations(root)).toEqual([]);
  });

  it('reads each service, the event it consumes, and the fields it reads', async () => {
    await declare({
      consumes: [
        {
          service: 'LedgerService',
          event: 'payments/payment.completed',
          fields: ['amount', 'currency'],
        },
        { service: 'LedgerService', event: 'payments/payment.refunded' },
      ],
    });

    expect(await readConsumerDeclarations(root)).toEqual([
      {
        service: 'LedgerService',
        event: 'payments/payment.completed',
        fields: ['amount', 'currency'],
      },
      { service: 'LedgerService', event: 'payments/payment.refunded' },
    ]);
  });

  it.each([
    [
      'a service name that could inject into a report',
      { service: '[x](https://evil)', event: 'p/e' },
    ],
    ['a service that mentions a team', { service: '@acme/everyone', event: 'p/e' }],
    [
      'a field with a newline in it',
      { service: 'Ledger', event: 'p/e', fields: ['a\n::error::x'] },
    ],
    ['an event that is not domain/id', { service: 'Ledger', event: 'payment.completed' }],
    ['an event name that could inject into a log', { service: 'Ledger', event: 'p/::error::x' }],
    ['a key it does not know', { service: 'Ledger', event: 'p/e', field: ['a'] }],
    ['no service', { event: 'p/e' }],
  ])('refuses %s, naming the file', async (_, entry) => {
    await declare({ consumes: [entry] });

    await expect(readConsumerDeclarations(root)).rejects.toThrow(CONSUMES_FILE);
  });
});

describe('createConsumerResourceGraph', () => {
  it('draws an edge from the event to the service, carrying the fields it reads', () => {
    const graph = createConsumerResourceGraph(
      [{ service: 'LedgerService', event: 'payments/payment.completed', fields: ['amount'] }],
      { repository: 'ledger', events: [event('payments', 'payments', 'payment.completed')] },
    );

    expect(graph.relationships).toEqual([
      expect.objectContaining({
        type: 'consumes',
        from: event('payments', 'payments', 'payment.completed').ref,
        to: { kind: 'service', id: 'LedgerService' },
        provenance: 'declared',
        attributes: { fields: ['amount'] },
      }),
    ]);
    expect(graph.resources.map((r) => r.ref)).toEqual([{ kind: 'service', id: 'LedgerService' }]);
  });

  it('keeps every field when one service declares the same event twice', () => {
    const declared = (fields?: string[]) => ({
      service: 'Ledger',
      event: 'payments/paid',
      ...(fields && { fields }),
    });

    const graph = (...declarations: Array<ReturnType<typeof declared>>) =>
      createConsumerResourceGraph(declarations, {
        repository: 'ledger',
        events: [event('payments', 'payments', 'paid')],
      }).relationships.map((edge) => edge.attributes);

    expect(graph(declared(['amount']), declared(['currency']))).toEqual([
      { fields: ['amount', 'currency'] },
    ]);
    // One declaration that names no fields says it may read any of them.
    expect(graph(declared(['amount']), declared())).toEqual([undefined]);
  });

  it('names an event no repository publishes', () => {
    expect(() =>
      createConsumerResourceGraph([{ service: 'Ledger', event: 'payments/gone' }], {
        repository: 'ledger',
        events: [],
      }),
    ).toThrow(/payments\/gone/);
  });

  it('refuses to guess between two repositories publishing the same event', () => {
    expect(() =>
      createConsumerResourceGraph([{ service: 'Ledger', event: 'payments/paid' }], {
        repository: 'ledger',
        events: [event('a', 'payments', 'paid'), event('b', 'payments', 'paid')],
      }),
    ).toThrow(/a, b/);
  });

  it('takes its own repository when it publishes the event too', () => {
    const graph = createConsumerResourceGraph([{ service: 'Ledger', event: 'payments/paid' }], {
      repository: 'b',
      events: [event('a', 'payments', 'paid'), event('b', 'payments', 'paid')],
    });

    expect(graph.relationships[0]?.from).toEqual(event('b', 'payments', 'paid').ref);
  });
});

describe('mergeConsumerGraph', () => {
  it('joins a service and an edge the producer already drew', () => {
    const consumer = createConsumerResourceGraph(
      [
        { service: 'LedgerService', event: 'payments/paid', fields: ['amount'] },
        { service: 'FraudService', event: 'payments/paid' },
      ],
      { repository: 'ledger', events: [event('payments', 'payments', 'paid')] },
    );

    const existing: ResourceGraph = {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        {
          ref: { kind: 'service', id: 'LedgerService' },
          title: 'LedgerService',
          summary: 'From the producer.',
          tags: [],
          provenance: { default: 'inferred', fields: {} },
          needsReview: false,
          attributes: { domains: ['payments'] },
        },
      ],
      relationships: [
        {
          type: 'consumes',
          from: event('payments', 'payments', 'paid').ref,
          to: { kind: 'service', id: 'LedgerService' },
          provenance: 'declared',
          needsReview: false,
        },
      ],
    };

    const merged = mergeConsumerGraph(existing, consumer);

    // The producer's service stands; the consumer's new one joins it.
    expect(merged.resources.map((r) => [r.ref.id, r.summary])).toEqual([
      ['FraudService', undefined],
      ['LedgerService', 'From the producer.'],
    ]);
    // The producer lists LedgerService, so its edge stands as the producer drew it,
    // with LedgerService's own list beside it for retirements, never for drift.
    expect(merged.relationships.map((r) => [r.to.id, r.attributes])).toEqual([
      ['FraudService', undefined],
      ['LedgerService', { consumerFields: ['amount'] }],
    ]);
  });
});

describe('mergeConsumerGraph across consumer repositories', () => {
  it('keeps "may read anything" when another declaration of the consumer names no fields', () => {
    const declared = (fields?: string[]) =>
      createConsumerResourceGraph(
        [{ service: 'Fraud', event: 'payments/paid', ...(fields && { fields }) }],
        { repository: 'fraud', events: [event('payments', 'payments', 'paid')] },
      );

    const merged = mergeConsumerGraph(declared(), declared(['amount']));

    expect(merged.relationships.map((edge) => edge.attributes)).toEqual([undefined]);
  });
});

describe('mergeConsumerGraph, declaration after declaration', () => {
  const producerEdge = (): ResourceGraph => ({
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [],
    relationships: [
      {
        type: 'consumes',
        from: event('payments', 'payments', 'paid').ref,
        to: { kind: 'service', id: 'Ledger' },
        provenance: 'declared',
        needsReview: false,
        source: { type: 'code', file: 'events/payments/Paid/autocatalog.json' },
      },
    ],
  });

  const declared = (fields?: string[]) =>
    createConsumerResourceGraph(
      [{ service: 'Ledger', event: 'payments/paid', ...(fields && { fields }) }],
      { repository: 'ledger', events: [event('payments', 'payments', 'paid')] },
    );

  const fieldsOf = (graph: ResourceGraph) =>
    consumersFromGraph({
      ...graph,
      resources: [
        ...graph.resources,
        {
          ref: event('payments', 'payments', 'paid').ref,
          title: 'Paid',
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
        },
      ],
    }).consumers.get('payments/paid')?.fields;

  it('never narrows a consumer the producer lists, however many declarations arrive', () => {
    // Any repository can name any service; only the producer's own manifest
    // says what a consumer it lists reads.
    const merged = [declared(['amount']), declared(['currency'])].reduce(
      mergeConsumerGraph,
      producerEdge(),
    );

    expect(fieldsOf(merged)).toEqual({});
  });

  it('combines the fields of declarations of a consumer the producer does not list', () => {
    const merged = [declared(['currency'])].reduce(mergeConsumerGraph, declared(['amount']));

    expect(fieldsOf(merged)).toEqual({ Ledger: ['amount', 'currency'] });
  });

  it('lets a later declaration with no fields say it may read anything', () => {
    const merged = [declared()].reduce(mergeConsumerGraph, declared(['amount']));

    expect(fieldsOf(merged)).toEqual({});
  });
});

describe('consumersFromGraph', () => {
  const published = (...repositories: string[]): ResourceGraph => ({
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: repositories.map((repository): EventCatalogResource => ({
      ref: event(repository, 'payments', 'paid').ref,
      title: 'Paid',
      tags: [],
      provenance: { default: 'declared', fields: {} },
      needsReview: false,
      attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
    })),
    relationships: repositories.flatMap(
      (repository) =>
        createConsumerResourceGraph(
          [{ service: `${repository}-reader`, event: 'payments/paid', fields: ['amount'] }],
          { repository, events: [event(repository, 'payments', 'paid')] },
        ).relationships,
    ),
  });

  it('lists the consumers of each event, and the fields each reads', () => {
    const { consumers, ambiguous } = consumersFromGraph(published('payments'));

    expect(consumers.get('payments/paid')).toEqual({
      consumers: ['payments-reader'],
      fields: { 'payments-reader': ['amount'] },
      own: {},
    });
    expect(ambiguous).toEqual([]);
  });

  it('reports a consumer named like a built-in property', () => {
    const graph = published('payments');

    graph.relationships = graph.relationships.map((edge) => ({
      ...edge,
      to: { ...edge.to, id: 'constructor' },
    }));

    expect(consumersFromGraph(graph).consumers.get('payments/paid')).toEqual({
      consumers: ['constructor'],
      fields: { constructor: ['amount'] },
      own: {},
    });
  });

  it('keeps "reads anything" when a later edge for the consumer names fields', () => {
    const graph = published('payments');
    const [edge] = graph.relationships;

    if (!edge) throw new Error('no edge');
    // An index can carry the same consumer twice: first with no fields.
    graph.relationships = [{ ...edge, attributes: {} }, edge];

    expect(consumersFromGraph(graph).consumers.get('payments/paid')?.fields).toEqual({});
  });

  it('treats a field it cannot trust as reading anything, not as reading nothing', () => {
    const graph = published('payments');

    graph.relationships = graph.relationships.map((edge) => ({
      ...edge,
      attributes: { fields: ['amount\n'] },
    }));

    expect(consumersFromGraph(graph).consumers.get('payments/paid')).toEqual({
      consumers: ['payments-reader'],
      fields: {},
      own: {},
    });
  });

  it('keeps to its own repository when two publish the same event', () => {
    const { consumers } = consumersFromGraph(published('a', 'b'), { repository: 'b' });

    expect(consumers.get('payments/paid')?.consumers).toEqual(['b-reader']);
  });

  it('counts a consumer whose name could inject into a report under a safe label', () => {
    const graph = published('payments');

    graph.relationships = graph.relationships.map((edge) => ({
      ...edge,
      to: { ...edge.to, id: 'x\n::error::pwned' },
    }));

    const { consumers, rejected } = consumersFromGraph(graph);

    // Still counted, so the gate does not pass because a name was hostile.
    expect(consumers.get('payments/paid')?.consumers).toEqual([UNSAFE_CONSUMER]);
    expect(rejected).toEqual(['x\\n::error::pwned']);
  });

  it('counts the consumers of every copy when it cannot tell which is its own', () => {
    // Another repository publishing the same event must not switch the check off.
    const { consumers, ambiguous } = consumersFromGraph(published('a', 'b'));

    expect(consumers.get('payments/paid')?.consumers).toEqual(['a-reader', 'b-reader']);
    expect(ambiguous).toEqual(['payments/paid']);
  });

  it('ignores an event whose domain or id has a slash, so keys cannot collide', () => {
    const graph = published('payments');
    const [edge] = graph.relationships;

    if (!edge) throw new Error('no edge');
    const slashed = { ...event('payments', 'payments', 'paid').ref, id: 'paid/extra' };

    const resource: EventCatalogResource = {
      ref: slashed,
      title: 'Paid',
      tags: [],
      provenance: { default: 'declared', fields: {} },
      needsReview: false,
      attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
    };

    graph.resources = [...graph.resources, resource];
    graph.relationships = [...graph.relationships, { ...edge, from: slashed }];

    expect([...consumersFromGraph(graph).consumers.keys()]).toEqual(['payments/paid']);
  });
});

describe('checkConsumerDeclarations', () => {
  const graph = (...repositories: string[]): ResourceGraph => ({
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: (repositories.length ? repositories : ['payments-service']).map(
      (repository): EventCatalogResource => ({
        ref: event(repository, 'payments', 'paid').ref,
        title: 'Paid',
        tags: [],
        provenance: { default: 'declared', fields: {} },
        needsReview: false,
        attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
      }),
    ),
    relationships: [],
  });

  const schema = {
    type: 'object',
    properties: {
      amount: { type: 'number' },
      items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
    },
  };

  const asked: string[] = [];

  const load = async (published: { repository: string; domain: string; id: string }) => {
    asked.push(`${published.repository}/${published.domain}/${published.id}`);

    return schema;
  };

  it('passes fields the producer publishes, from its own repository', async () => {
    asked.length = 0;

    expect(
      await checkConsumerDeclarations(
        [{ service: 'Ledger', event: 'payments/paid', fields: ['amount', 'items[].sku'] }],
        graph(),
        load,
      ),
    ).toEqual([]);
    expect(asked).toEqual(['payments-service/payments/paid']);
  });

  it('names a field the producer does not publish', async () => {
    expect(
      await checkConsumerDeclarations(
        [{ service: 'Ledger', event: 'payments/paid', fields: ['amout'] }],
        graph(),
        load,
      ),
    ).toEqual(['Ledger reads `amout` of payments/paid, which payments-service does not publish']);
  });

  it('names an event no repository publishes', async () => {
    expect(
      await checkConsumerDeclarations(
        [{ service: 'Ledger', event: 'payments/gone' }],
        graph(),
        load,
      ),
    ).toEqual(['Ledger consumes payments/gone, which no repository publishes']);
  });

  it('refuses to guess which of two repositories publishing the event it means', async () => {
    const two = graph('payments-service', 'payments-legacy');

    expect(
      await checkConsumerDeclarations(
        [{ service: 'Ledger', event: 'payments/paid', fields: ['amount'] }],
        two,
        load,
      ),
    ).toEqual([
      'Ledger consumes payments/paid, which 2 repositories publish (payments-legacy, payments-service)',
    ]);
  });

  it('says when the schema cannot be read, rather than passing it', async () => {
    expect(
      await checkConsumerDeclarations(
        [{ service: 'Ledger', event: 'payments/paid', fields: ['amount'] }],
        graph(),
        async () => {
          throw new Error('404');
        },
      ),
    ).toEqual(['Ledger consumes payments/paid: its schema could not be read (404)']);
  });

  it("escapes what the producer's site says when its schema cannot be read", async () => {
    const [problem] = await checkConsumerDeclarations(
      [{ service: 'Ledger', event: 'payments/paid', fields: ['amount'] }],
      graph(),
      async () => {
        throw new Error('Not Found\n::error::injected');
      },
    );

    expect(problem).not.toContain('\n');
    expect(problem).toContain('Not Found\\n::error::injected');
  });
});
