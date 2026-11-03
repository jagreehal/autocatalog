import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeDelivery,
  AUTOCATALOG_GRAPH_SPEC,
  deliveryConsumersFromGraph,
  deliveryEventsFromGraph,
  driftDelivery,
  named,
  UNSAFE_CONSUMER,
  rabbitMqGraph,
  readConsumerDeclarations,
  scanArchitecture,
  topicMatches,
  type ConsumerDeclaration,
  deliveryEvents,
  type DeliveryEvent,
} from '../src';
import { loadRepositoryEvents } from '../src/repository-events';
import type { JsonObject } from '../src/json';

const here = path.dirname(fileURLToPath(import.meta.url));

const repo = path.resolve(here, '../../../../fixtures/delivery-rabbitmq');

const DEFINITIONS = 'infrastructure/rabbitmq/definitions.json';

let events: DeliveryEvent[];

let consumers: ConsumerDeclaration[];

let definitions: JsonObject;

beforeAll(async () => {
  events = deliveryEvents(await loadRepositoryEvents(repo));
  consumers = await readConsumerDeclarations(repo);
  definitions = JSON.parse(await fs.readFile(path.join(repo, DEFINITIONS), 'utf8'));
});

/** The fixture's definitions with one change, analysed as `ac drift` analyses either side. */
function analyse(change: (defs: any) => void = () => {}) {
  const defs = structuredClone(definitions);
  change(defs);

  return analyzeDelivery({
    graph: rabbitMqGraph(defs, { file: DEFINITIONS, environment: 'staging' }),
    events,
    consumers,
  });
}

const binding = (defs: any) => defs.bindings.find((b: any) => b.destination === 'ledger.payments');

describe('delivery discovery', () => {
  it('reads the definitions into the resource scan, each fact with its file and line', async () => {
    const { graph, errors } = await scanArchitecture({ root: repo, publish: false });

    expect(errors).toEqual([]);

    const route = graph.relationships.find(
      (edge) => edge.type === 'routesTo' && edge.to.id === 'ledger.payments',
    );

    expect(route?.from).toEqual({ kind: 'queue', namespace: 'rabbitmq-exchange', id: 'payments' });
    expect(route?.to).toEqual({ kind: 'queue', namespace: 'rabbitmq', id: 'ledger.payments' });
    expect(route?.source).toMatchObject({ file: DEFINITIONS, line: expect.any(Number) });
    expect(route?.attributes).toMatchObject({
      environment: 'staging',
      bindings: [{ routingKey: '', arguments: { 'x-match': 'all', currency: 'GBP' } }],
    });

    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'deadLettersTo',
        from: { kind: 'queue', namespace: 'rabbitmq', id: 'ledger.payments' },
        to: { kind: 'queue', namespace: 'rabbitmq-exchange', id: 'ledger.dead-letter' },
      }),
    );
  });

  it('routes each committed example: GBP reaches the ledger, EUR is filtered out', () => {
    const report = analyse();
    const [route] = report.routes;

    expect(report.complete).toBe(true);
    expect(route).toMatchObject({
      event: 'payments/payment.completed',
      producers: ['PaymentService'],
      consumer: 'LedgerService',
      queue: 'ledger.payments',
      deadLetter: { exchange: 'ledger.dead-letter', queues: ['ledger.dead-letter'] },
    });

    expect(route?.examples.map((e) => [e.name, e.reaches])).toEqual([
      ['example-1', true],
      ['example-2', false],
    ]);

    expect(route?.examples[0]?.path.map((hop) => [hop.ref.id, hop.rule])).toEqual([
      ['payments', undefined],
      ['ledger.payments', 'currency = GBP'],
    ]);

    expect(report.findings).toEqual([
      expect.objectContaining({
        confidence: 'possible',
        code: 'example_filtered',
        consumer: 'LedgerService',
      }),
    ]);
  });
});

describe('delivery mutations', () => {
  it('a removed binding drops the route, and drift names the consumer it breaks', () => {
    const current = analyse((defs) => {
      defs.bindings = defs.bindings.filter((b: any) => b.destination !== 'ledger.payments');
    });

    expect(current.findings).toContainEqual(
      expect.objectContaining({
        confidence: 'confirmed',
        code: 'no_route',
        consumer: 'LedgerService',
      }),
    );

    const drift = driftDelivery(analyse(), current);

    expect(drift).toContainEqual(
      expect.objectContaining({
        severity: 'breaking',
        kind: 'delivery_route_lost',
        consumers: ['LedgerService'],
      }),
    );
  });

  it('a filter that now rejects the committed example says what changed and who loses it', () => {
    const drift = driftDelivery(
      analyse(),
      analyse((defs) => {
        binding(defs).arguments.currency = 'EUR';
      }),
    );

    const lost = drift.filter((finding) => finding.kind === 'delivery_route_lost');

    expect(lost).toHaveLength(1);
    expect(lost[0]?.message).toBe(
      'delivery to `ledger.payments` in `staging` changed: previously `currency = GBP`, proposed `currency = EUR`. The committed example `example-1` (`currency = GBP`) would no longer reach `LedgerService`',
    );
    expect(lost[0]?.advice).toMatch(/agree the change with the owner of `LedgerService`/);
  });

  it('a filter change still breaks when the committed example is renamed in the same change', () => {
    const current = analyse((defs) => {
      binding(defs).arguments.currency = 'EUR';
    });

    for (const route of current.routes)
      route.examples = route.examples.map((example) => ({
        ...example,
        name: `${example.name}-v2`,
      }));

    expect(driftDelivery(analyse(), current)).toContainEqual(
      expect.objectContaining({
        severity: 'breaking',
        kind: 'delivery_route_lost',
        consumers: ['LedgerService'],
      }),
    );
  });

  it('a route that arrived and can no longer be evaluated is suspicious, not a pass', () => {
    const current = analyse((defs) => {
      binding(defs).arguments.currency = 'EUR';
    });

    for (const route of current.routes)
      route.examples = route.examples.map((example) => ({ ...example, reaches: undefined }));

    expect(driftDelivery(analyse(), current)).toContainEqual(
      expect.objectContaining({
        severity: 'suspicious',
        kind: 'delivery_unknown',
        consumers: ['LedgerService'],
      }),
    );
  });

  it('a dead-letter exchange that does not exist is a confirmed problem', () => {
    const report = analyse((defs) => {
      defs.queues[0].arguments['x-dead-letter-exchange'] = 'ledger.gone';
    });

    expect(report.findings).toContainEqual(
      expect.objectContaining({ confidence: 'confirmed', code: 'dead_letter_missing' }),
    );

    expect(driftDelivery(analyse(), report)).toContainEqual(
      expect.objectContaining({ severity: 'breaking', kind: 'delivery_misconfigured' }),
    );
  });

  it("a dead-letter route that misses the consumer's declared queue breaks its declared need", () => {
    const report = analyse((defs) => {
      defs.queues.push({ name: 'ledger.parking', vhost: '/', arguments: {} });
      defs.bindings[1].destination = 'ledger.parking';
    });

    expect(report.findings).toContainEqual(
      expect.objectContaining({ confidence: 'policy', code: 'dead_letter_mismatch' }),
    );
  });

  it('an exchange type it cannot evaluate leaves the result incomplete instead of passing', () => {
    const report = analyse((defs) => {
      defs.exchanges[0].type = 'x-consistent-hash';
    });

    expect(report.complete).toBe(false);
    expect(report.routes[0]?.examples.map((e) => e.reaches)).toEqual([undefined, undefined]);
    expect(driftDelivery(analyse(), report)).toContainEqual(
      expect.objectContaining({ severity: 'info', kind: 'delivery_unknown' }),
    );
  });

  it('a policy with a pattern it can run applies, and one it cannot is reported as not evaluated', () => {
    const safe = analyse((defs) => {
      defs.policies = [
        {
          name: 'ttl',
          vhost: '/',
          pattern: '^ledger\\.',
          'apply-to': 'queues',
          definition: { 'message-ttl': 60000 },
        },
      ];
    });

    expect(safe.complete).toBe(true);
    expect(safe.routes[0]?.facts).toContain('keeps unread messages for 1 minute');

    const unsafe = analyse((defs) => {
      defs.policies = [
        {
          name: 'dlx',
          vhost: '/',
          pattern: '^(ledger)+$',
          'apply-to': 'queues',
          definition: { 'dead-letter-exchange': 'x' },
        },
      ];
    });

    expect(unsafe.complete).toBe(false);
    expect(unsafe.findings).toContainEqual(
      expect.objectContaining({
        confidence: 'unknown',
        message: expect.stringMatching(/policy `dlx`/),
      }),
    );
  });

  it('an event published to an exchange nobody declares is confirmed', () => {
    const report = analyse((defs) => {
      defs.exchanges = defs.exchanges.filter((e: any) => e.name !== 'payments');
    });

    expect(report.findings).toContainEqual(
      expect.objectContaining({ confidence: 'confirmed', code: 'destination_missing' }),
    );
  });
});

describe('topic routing', () => {
  it.each([
    ['payment.*', 'payment.completed', true],
    ['payment.*', 'payment.completed.gbp', false],
    ['payment.#', 'payment.completed.gbp', true],
    ['#', '', true],
    ['*.completed', 'payment.completed', true],
    ['payment.completed', 'payment.failed', false],
  ])('%s against %s is %s', (pattern, key, expected) => {
    expect(topicMatches(pattern, key)).toBe(expected);
  });
});

describe('consumers read from a company index', () => {
  it('counts a consumer whose name is not safe to print under a placeholder', () => {
    const edge = (service: string) => ({
      type: 'consumes' as const,
      from: { kind: 'event', namespace: 'payments/payments', id: 'payment.completed' },
      to: { kind: 'service', id: service },
      provenance: 'declared' as const,
      needsReview: false,
      attributes: { delivery: { queue: 'ledger.payments' } },
    });

    const consumers = deliveryConsumersFromGraph({
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [],
      relationships: [edge('LedgerService'), edge('x](https://evil.example) @org/sec\n# hi')],
    });

    expect(consumers.map((consumer) => consumer.service)).toEqual([
      'LedgerService',
      UNSAFE_CONSUMER,
    ]);
  });
});

describe('named', () => {
  it('shows a name as a code span it cannot break out of', () => {
    expect(named('ledger.payments')).toBe('`ledger.payments`');
    expect(named('x](https://evil.example) @org/security')).toBe(
      '`x](https://evil.example) @org/security`',
    );
    expect(named('a`b')).toBe('``a`b``');
    expect(named('`edge`')).toBe('`` `edge` ``');
    expect(named('two\nlines')).toBe('`two lines`');
  });
});

describe('events read from a company index', () => {
  it('leaves out an event whose name is not safe to print', () => {
    const resource = (event: string) => ({
      ref: { kind: 'event' as const, namespace: 'payments/payments', id: event },
      title: event,
      tags: [],
      provenance: { default: 'declared' as const, fields: {} },
      needsReview: false,
      attributes: {
        domain: 'payments',
        status: 'active' as const,
        schema: './schema.json',
        examples: 0,
        delivery: { ...events[0]!, event },
      },
    });

    const read = deliveryEventsFromGraph({
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        resource('payments/payment.completed'),
        resource('payments/x](https://evil.example)'),
      ],
      relationships: [],
    });

    expect(read.map((event) => event.event)).toEqual(['payments/payment.completed']);
  });
});
