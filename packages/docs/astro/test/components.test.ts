import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { diagramProps } from '../src/page-models';
import { CatalogExplorer } from '../src/ui/components/CatalogExplorer';
import { explorerModel } from '../src/ui/components/catalog-explorer-model';
import { DocLinks } from '../src/ui/components/DocLinks';
import { DocList } from '../src/ui/components/DocList';
import { EventCatalogDiagram } from '../src/ui/components/EventCatalogDiagram';
import { Evidence } from '../src/ui/components/Evidence';
import { runtimeEvidenceView } from '../src/runtime-evidence-view';
import { RuntimeEvidence } from '../src/ui/components/RuntimeEvidence';
import { SchemaTree } from '../src/ui/components/SchemaTree';
import { schemaTree } from '../src/ui/lib/schema-tree';
import { SourceLinks } from '../src/ui/components/SourceLinks';
import { TransportFacts } from '../src/ui/components/TransportFacts';
import { DeliveryFacts } from '../src/ui/components/DeliveryFacts';
import { deliveryView, exampleViews } from '../src/page-models';
import { Examples } from '../src/ui/components/Examples';
import {
  eventFrontmatter,
  eventRuntimeEvidence,
  AUTOCATALOG_GRAPH_SPEC,
  type JsonObject,
  type ResourceGraph,
} from 'autocatalog-core';
import type { DocListItem } from '../src/view';

// Level 3: the variation matrix of each component, one render per state.
// Journeys across pages belong to the demo-site Playwright stories, not here.
// Only the components this plugin adds are covered — pages, navigation and
// search are Starlight's and are tested there.
// The React components render to static markup, with no islands to wait for.
const render = <P extends object>(Component: ComponentType<P>, props: P) =>
  renderToStaticMarkup(createElement(Component, props));

const item = (overrides: Partial<DocListItem> = {}): DocListItem => ({
  id: 'payments-service/runbook',
  repo: 'payments-service',
  title: 'Payments service runbook',
  owner: 'Payments',
  updated: '2026-03-04T09:00:00Z',
  tags: [],
  ...overrides,
});

describe('DocList states', () => {
  it('links a document by id and shows owner, date and tags', async () => {
    const html = render(DocList, { items: [item({ tags: ['ops', 'incident'] })] });

    expect(html).toContain('href="/payments-service/runbook"');
    expect(html).toContain('Payments service runbook');
    expect(html).toContain('Payments');
    expect(html).toContain('4 Mar 2026');
    expect(html).toContain('ops');
  });

  it('omits the date when git could not say', async () => {
    const html = render(DocList, { items: [item({ updated: null })] });

    expect(html).not.toContain('updated');
  });

  it('names the repository only where a list mixes several', async () => {
    const props = { items: [item()] };
    expect(render(DocList, props)).not.toContain('payments-service ·');
    expect(render(DocList, { ...props, showRepo: true })).toContain('payments-service');
  });

  it('renders an empty list without crashing', async () => {
    const html = render(DocList, { items: [] });
    expect(html).toContain('<ul');
  });
});

describe('DocLinks states', () => {
  const link = (id: string, title: string, resolved = true) => ({
    id,
    title,
    repo: id.split('/')[0]!,
    resolved,
  });

  it('separates declared edges from derived backlinks', async () => {
    const html = render(DocLinks, {
      related: [link('acme-handbook/incident-policy', 'Incident policy')],
      linkedFrom: [link('reporter/daily', 'Daily reconciliation')],
    });

    expect(html).toContain('Related');
    expect(html).toContain('Linked from');
    expect(html).toContain('href="/acme-handbook/incident-policy"');
    expect(html).toContain('Daily reconciliation');
  });

  it('shows an unpublished target as unlinked rather than hiding it', async () => {
    const html = render(DocLinks, {
      related: [link('elsewhere/thing', 'elsewhere/thing', false)],
      linkedFrom: [],
    });

    expect(html).toContain('elsewhere/thing');
    expect(html).not.toContain('href="/elsewhere/thing"');
  });

  it('renders nothing at all when a document has no edges', async () => {
    const html = render(DocLinks, { related: [], linkedFrom: [] });

    expect(html).not.toContain('<aside');
  });
});

describe('CatalogExplorer states', () => {
  it('renders heterogeneous resources, evidence, and navigable relationships', async () => {
    const graph: ResourceGraph = {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        {
          ref: { kind: 'agent', id: 'refund-agent' },
          title: 'Refund agent',
          owner: { team: 'Payments' },
          tags: [],
          provenance: { default: 'declared', fields: {} },
          needsReview: false,
          source: { file: 'agents/refund-agent/autocatalog.json' },
          attributes: {},
        },
        {
          ref: { kind: 'model', id: 'fast-model' },
          title: 'Fast model',
          tags: [],
          provenance: { default: 'extracted', fields: {} },
          needsReview: false,
          attributes: {},
        },
      ],
      relationships: [
        {
          type: 'usesModel',
          from: { kind: 'agent', id: 'refund-agent' },
          to: { kind: 'model', id: 'fast-model' },
          provenance: 'declared',
          needsReview: false,
        },
      ],
    };

    const html = render(CatalogExplorer, { model: explorerModel(graph) });

    expect(html).toContain('Refund agent');
    expect(html).toContain('Fast model');
    expect(html).toContain('usesModel');
    expect(html).toContain('agents/refund-agent/autocatalog.json');
    expect(html).toContain('href="#resource-model%3Afast-model"');
  });

  it('names the commit a repository was read at', async () => {
    const commit = '0123456789abcdef0123456789abcdef01234567';

    const graph: ResourceGraph = {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        {
          ref: { kind: 'repository', id: 'payments-service' },
          title: 'payments-service',
          tags: [],
          provenance: { default: 'inferred', fields: {} },
          needsReview: false,
          source: { repo: 'payments-service', ref: commit },
          attributes: {},
        },
      ],
      relationships: [],
    };

    const html = render(CatalogExplorer, { model: explorerModel(graph) });

    expect(html).toContain(`title="${commit}"`);
    expect(html).toContain('>0123456789ab</code>');
  });
});

describe('SourceLinks states', () => {
  it('links the source and its editor', async () => {
    const html = render(SourceLinks, {
      source: 'https://github.com/acme/payments/blob/HEAD/docs/runbook.md',
      edit: 'https://github.com/acme/payments/edit/HEAD/docs/runbook.md',
    });

    expect(html).toContain('href="https://github.com/acme/payments/blob/HEAD/docs/runbook.md"');
    expect(html).toContain('href="https://github.com/acme/payments/edit/HEAD/docs/runbook.md"');
  });

  it('renders nothing when the checkout has no web origin', async () => {
    const html = render(SourceLinks, { source: null, edit: null });

    expect(html).not.toContain('<a');
  });
});

describe('TransportFacts states', () => {
  it('names the address, protocols and delivery mode', async () => {
    const html = render(TransportFacts, {
      transport: [{ address: 'orders.placed', protocols: ['kafka'], deliveryMode: 'push' }],
    });

    expect(html).toMatch(/<dt[^>]*>Travels on<\/dt>/);
    expect(html).toContain('<code>orders.placed</code>');
    expect(html).toContain('kafka, push delivery');
  });

  it('renders nothing when no spec said where the event travels', async () => {
    const html = render(TransportFacts, {});

    expect(html).not.toContain('Travels on');
  });
});

describe('DeliveryFacts states', () => {
  it('says what a consumer can rely on about arrival, one promise a line', () => {
    const html = render(DeliveryFacts, {
      delivery: deliveryView({
        guarantee: 'at-least-once',
        orderingKey: 'orderId',
        idempotencyKey: 'eventId',
        maxLateness: 'PT1H30M',
      }),
    });

    expect(html).toMatch(/<dt[^>]*>Delivery<\/dt>/);
    expect(html).toContain('At least once, so expect duplicates');
    expect(html).toContain('In order by <code>orderId</code>');
    expect(html).toContain('Repeats share <code>eventId</code>');
    expect(html).toContain('Up to 1 hour 30 minutes late');
  });

  it('names each guarantee by what it means for the consumer', () => {
    const said = (guarantee: 'at-least-once' | 'at-most-once' | 'exactly-once') =>
      render(DeliveryFacts, { delivery: deliveryView({ guarantee }) });

    expect(said('at-most-once')).toContain('At most once, so an event can be lost');
    expect(said('exactly-once')).toContain('Exactly once');
  });

  it('keeps a promise of no lateness at all', () => {
    expect(render(DeliveryFacts, { delivery: deliveryView({ maxLateness: 'PT0S' }) })).toContain(
      'Up to 0 seconds late',
    );
  });

  it('names the field a journey is traced by, declared or found', () => {
    expect(render(DeliveryFacts, { delivery: deliveryView(undefined, 'meta.traceId') })).toContain(
      'Traced by <code>meta.traceId</code>',
    );
  });

  it('renders nothing when the event makes no promise', () => {
    expect(render(DeliveryFacts, {})).toBe('');
    expect(render(DeliveryFacts, { delivery: deliveryView({}) })).toBe('');
  });
});

describe('Examples states', () => {
  const views = exampleViews([
    { name: 'redelivered', path: '/x', data: { a: 1 }, case: 'duplicate' },
    {
      name: 'no-id',
      path: '/x',
      data: {},
      case: 'invalid',
      summary: 'Missing the id the schema requires',
    },
    { name: 'placed', path: '/x', data: { a: 1 }, title: 'A domestic order' },
  ]);

  it('leads with the happy path, then each case in a fixed order', () => {
    expect(views.map((view) => [view.name, view.case])).toEqual([
      ['placed', undefined],
      ['redelivered', 'duplicate'],
      ['no-id', 'invalid'],
    ]);
  });

  it('says what each case shows, and lets a written title and summary speak first', () => {
    const html = render(Examples, { examples: views });

    expect(html).toContain('A domestic order');
    expect(html).toMatch(/<span[^>]*data-slot="badge"[^>]*>Duplicate<\/span>/);
    expect(html).toContain('A repeat consumers must recognise');
    expect(html).toContain('Missing the id the schema requires');
    expect(html).not.toContain('A message consumers must reject');
  });
});

describe('deliveryView', () => {
  it('writes maximum lateness in words, largest unit first', () => {
    const late = (maxLateness: string) => deliveryView({ maxLateness })?.maxLateness;

    expect(['PT0S', 'PT30S', 'PT1M', 'PT90M', 'P1DT2H', 'PT0.5S'].map(late)).toEqual([
      '0 seconds',
      '30 seconds',
      '1 minute',
      '1 hour 30 minutes',
      '1 day 2 hours',
      '0.5 seconds',
    ]);
  });
});

describe('SchemaTree states', () => {
  const renderTree = (schema: JsonObject) =>
    Promise.resolve(render(SchemaTree, { nodes: schemaTree(schema) }));

  it('marks required fields and shows the constraints a consumer has to honour', async () => {
    const html = await renderTree({
      type: 'object',
      required: ['amount'],
      properties: {
        amount: { type: 'number', exclusiveMinimum: 0, description: 'Minor units.' },
        currency: { type: 'string', enum: ['GBP', 'EUR'] },
        at: { type: 'string', format: 'date-time' },
      },
    });

    expect(html).toMatch(/amount<\/code>.*number.*required/s);
    expect(html).toContain('&gt; 0');
    expect(html).toContain('Minor units.');
    expect(html).toContain('&quot;GBP&quot; | &quot;EUR&quot;');
    expect(html).toContain('date-time');
    expect(html).not.toMatch(/currency<\/code>[^<]*<span[^>]*>enum<\/span>\s*<span[^>]*>required/);
  });

  it('hides the safe-integer range Zod writes onto every int', async () => {
    const html = await renderTree({
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          minimum: -Number.MAX_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    });

    expect(html).not.toContain('9007199254740991');
  });

  it('opens arrays of objects to their item fields', async () => {
    const html = await renderTree({
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } },
        },
      },
    });

    expect(html).toContain('object[]');
    expect(html).toMatch(/sku<\/code>.*required/s);
  });

  it('opens each discriminated-union variant with the shared fields merged in', async () => {
    const html = await renderTree({
      type: 'object',
      required: ['orderId'],
      properties: { orderId: { type: 'string' } },
      oneOf: [
        {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { const: 'physical' },
            shippingAddress: { type: 'object', properties: { country: { type: 'string' } } },
          },
        },
        {
          type: 'object',
          properties: { kind: { const: 'digital' }, downloadUrl: { type: 'string' } },
        },
      ],
    });

    expect(html).toContain('kind = &quot;physical&quot;');
    expect(html).toContain('kind = &quot;digital&quot;');
    expect(html).toContain('country');
    expect(html).toContain('downloadUrl');
    // The parent's field, and its requiredness, show up in both variants.
    expect(html.match(/orderId<\/code>[^]*?required/g)).toHaveLength(2);
  });

  it('renders boolean and empty schemas without failing', async () => {
    await expect(renderTree({ type: 'object', properties: { anything: true } })).resolves.toContain(
      'anything',
    );
    await expect(renderTree({})).resolves.toContain('data-schema');
  });
});

describe('EventCatalogDiagram states', () => {
  it('waits for the theme before loading, and links to the hosted EventCatalog for readers without JavaScript', () => {
    const html = render(EventCatalogDiagram, {
      embed: true,
      iframeSrc: '/eventcatalog/visualiser/graph/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fvisualiser%2Fgraph%2F',
      title: 'Architecture graph',
    });

    expect(html).toMatch(/<iframe[^>]*\shidden=""/);
    expect(html).not.toMatch(/<iframe[^>]*\ssrc=/);
    expect(html).toContain('href="/architecture/?at=eventcatalog%2Fvisualiser%2Fgraph%2F"');
  });

  it('only links to the diagram where EventCatalog cannot be embedded', () => {
    const html = render(EventCatalogDiagram, {
      embed: false,
      iframeSrc: '/eventcatalog/visualiser/graph/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fvisualiser%2Fgraph%2F',
      title: 'Architecture graph',
    });

    expect(html).not.toContain('<iframe');
    expect(html).toContain('Open the diagram in EventCatalog');
  });

  it('is described by the page model from the embeds the site was built with', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-embeds-')), 'embeds.json');
    fs.writeFileSync(file, JSON.stringify({ embed: true, graph: 'g/', events: {}, services: {} }));
    process.env.AUTOCATALOG_EVENTCATALOG = file;

    expect(diagramProps('/', 'eventcatalog/visualiser/graph/', 'Architecture graph')).toEqual({
      embed: true,
      iframeSrc: '/eventcatalog/visualiser/graph/?embed=true',
      openHref: '/architecture/?at=eventcatalog%2Fvisualiser%2Fgraph%2F',
      title: 'Architecture graph',
    });
    expect(diagramProps('/', undefined, 'Architecture graph')).toBeUndefined();
  });
});

describe('RuntimeEvidence states', () => {
  const event = eventFrontmatter.parse({
    id: 'payment.completed',
    domain: 'payments',
    version: '1.0.0',
    name: 'Payment completed',
    summary: 'Payment succeeded',
    consumers: ['LedgerService'],
  });

  const renderEvidence = (frontmatter: typeof event) =>
    render(RuntimeEvidence, {
      evidence: runtimeEvidenceView(
        eventRuntimeEvidence(frontmatter),
        `${frontmatter.domain}/${frontmatter.id}`,
      ),
    });

  it('shows missing evidence without claiming zero traffic', async () => {
    const html = renderEvidence(event);
    expect(html).toContain('No evidence attached');
    expect(html).toContain('does not mean the event has no traffic');
    expect(html).not.toContain('0 recorded observations');
  });

  it('renders reported attribution, snapshot timestamps and escaped trace references', async () => {
    const observed = {
      count: 8,
      firstSeen: '2026-10-10T11:00:00Z',
      lastSeen: '2026-10-10T11:59:00Z',
      consumers: ['FraudService'],
      producers: ['PaymentService'],
      declaredConsumers: ['LedgerService'],
      consumerEvidence: 'reported' as const,
      snapshot: { spec: 'autotel-architecture/v0.1.0', generatedAt: '2026-10-10T12:00:00Z' },
      sampleTraceIds: ['<script>alert(1)</script>'],
    };

    const html = renderEvidence({ ...event, observed });

    expect(html).toContain('Reported in snapshot');
    expect(html).not.toContain('Observed receiving');
    expect(html).toContain('2026-10-10T12:00:00Z');
    expect(html).toContain('Declared, absent from snapshot');
    expect(html).toContain('LedgerService');
    expect(html).toContain('FraudService');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('Evidence states', () => {
  const evidence = {
    location: 'src/events/payment.ts:12',
    symbol: 'paymentCompleted',
    confidence: 0.25,
    needsReview: true,
  };

  it('dashes the rule of an inference, and says how sure it is', async () => {
    const html = render(Evidence, { ...evidence, method: 'inferred' });

    expect(html).toMatch(/class="[^"]*border-dashed border-inferred[^"]*"/);
    expect(html).toContain('Inferred</span>, 25% confident.');
    expect(html).toContain('A person should confirm it.');
    expect(html).toContain('<code class="font-mono break-all">src/events/payment.ts:12</code>');
  });

  it('draws a solid rule for what was read out of code', async () => {
    const html = render(Evidence, { ...evidence, method: 'extracted', needsReview: false });

    expect(html).toContain('border-extracted');
    expect(html).not.toContain('border-dashed');
    expect(html).not.toContain('should confirm');
  });

  it('names what it was learned from when there is no file', async () => {
    const html = render(Evidence, {
      method: 'inferred',
      location: null,
      symbol: null,
      confidence: null,
      needsReview: false,
      basis: 'from the events that name it',
    });

    expect(html).not.toContain('Read from');
    expect(html).toContain('Inferred</span> from the events that name it.');
  });
});
