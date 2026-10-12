import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import graphContract from 'autocatalog-core/contracts/graph-v1.schema.json' with { type: 'json' };
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aboutDocument, documentsAbout } from '../src/about';
import { buildDocsCatalog, eventParticipants, resourcesDefinedByRepository } from '../src/catalog';
import {
  writeResourceGraph,
  architectureResource,
  architectureService,
  emptyResourceGraph,
  datastoreOwnership,
  discoverTraceResources,
  type ResourceGraph,
} from 'autocatalog-core';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-graph-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

async function writeEvent(
  repository = 'payments-service',
  summary = 'A payment was captured.',
): Promise<void> {
  const folder = `${repository}/events/payments/PaymentCaptured`;
  await write(
    `${folder}/autocatalog.json`,
    JSON.stringify({
      spec: 'autocatalog/v2',
      id: 'payment.captured',
      version: '1.0.0',
      name: 'Payment captured',
      summary,
      domain: 'payments',
      producers: ['PaymentService'],
      consumers: [],
      tags: [],
      status: 'active',
      schema: 'schema.json',
      examples: [],
      provenance: { default: 'extracted', fields: {} },
      confidence: 1,
      needsReview: false,
    }),
  );
  await write(`${folder}/schema.json`, JSON.stringify({ type: 'object' }));
}

async function writeAgent(): Promise<void> {
  await write(
    'payments-service/models/fast-model.yaml',
    [
      'id: fast-model',
      'name: Fast model',
      'owner: Platform',
      'provider: openai',
      'model_id: fast-model-api',
    ].join('\n'),
  );
  await write(
    'payments-service/agents/refund-agent/autocatalog.json',
    JSON.stringify({
      name: 'Refund agent',
      owner: 'Payments',
      model: 'fast-model',
      tools: [],
      policies: [],
    }),
  );
}

describe('documentation catalog projection', () => {
  it('enrolls a trace-only repository and publishes its datastore ownership map', async () => {
    const repository = path.join(root, 'billing');
    await fs.mkdir(repository);
    const graph = emptyResourceGraph();
    const ref = { kind: 'collection', namespace: 'acme/finance', id: 'statements' } as const;
    graph.resources.push(architectureResource(ref), architectureService('billing'));
    graph.relationships.push({
      type: 'writes',
      from: { kind: 'service', id: 'billing' },
      to: ref,
      provenance: 'observed',
      needsReview: true,
    });
    await writeResourceGraph(repository, graph);
    const catalog = await buildDocsCatalog(root, { includeDates: false });
    expect(catalog.failures).toEqual([]);
    expect(datastoreOwnership(catalog.graph)[0]).toMatchObject({ writers: ['billing'] });
    expect(new Ajv2020({ strict: false }).compile(graphContract)(catalog.graph)).toBe(true);
  });
  it('joins conventional Docs, Events, and Agents through one Repository resource', async () => {
    await write(
      'payments-service/docs/runbook.md',
      '---\ntitle: Payments runbook\nowner: Payments\n---\n\nOperate it.\n',
    );
    await writeEvent();
    await writeAgent();

    const catalog = await buildDocsCatalog(root, { includeDates: false });
    expect(catalog.summary.resourcesByKind).toEqual({
      agent: 1,
      document: 1,
      event: 1,
      model: 1,
      repository: 1,
      service: 1,
    });
    expect(catalog.summary.relationshipsByType).toEqual({
      defines: 2,
      produces: 1,
      publishes: 1,
      usesModel: 1,
    });
    expect(resourcesDefinedByRepository(catalog, 'payments-service')).toEqual([
      expect.objectContaining({ ref: expect.objectContaining({ kind: 'agent' }), url: undefined }),
      expect.objectContaining({ ref: expect.objectContaining({ kind: 'event' }), url: undefined }),
    ]);
  });

  it('quarantines a repository whose Event catalog is invalid, and says so', async () => {
    // One team's broken catalog must not take down the index every other team
    // reads. Nothing from that repository is published — but the gap is stated,
    // because a graph that quietly looks complete is the failure this project
    // exists to refuse. Failing the merge is the owning repository's own job.
    await write(
      'good-repo/docs/handbook.md',
      '---\ntitle: Handbook\nowner: Reliability\n---\n\nRead it.\n',
    );
    await write(
      'payments-service/docs/runbook.md',
      '---\ntitle: Payments runbook\nowner: Payments\n---\n\nOperate it.\n',
    );
    await write(
      'payments-service/events/payments/Broken/autocatalog.json',
      JSON.stringify({ spec: 'autocatalog/v2', id: 'broken' }),
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalog = await buildDocsCatalog(root, { includeDates: false });
    const printed = warn.mock.calls.length;
    warn.mockRestore();

    expect(catalog.failures).toEqual([
      {
        repository: 'payments-service',
        source: 'events',
        message: expect.stringContaining('Broken'),
      },
    ]);
    // Said once per build, by whoever builds the site: the catalog is compiled
    // more than once per build, so compiling it prints nothing.
    expect(printed).toBe(0);
    expect(catalog.warnings).toEqual([
      expect.stringMatching(/^payments-service: its events\/ catalog did not compile/),
    ]);
    // The documents still publish; only the catalog that would not compile is missing.
    expect(catalog.summary.resourcesByKind).toEqual({ document: 2, repository: 2 });
    expect(catalog.graph.resources.some((resource) => resource.ref.kind === 'event')).toBe(false);
    // …and no event pages: a page for an event the graph refused would contradict it.
    expect(catalog.events).toEqual([]);
  });

  it('warns about a malformed .autotel/snapshot.json and still publishes the events', async () => {
    await writeEvent();
    await write('payments-service/.autotel/snapshot.json', '{ not json');

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(catalog.events.map(({ event }) => event.frontmatter.id)).toEqual(['payment.captured']);
    expect(catalog.warnings).toEqual([
      expect.stringMatching(/^payments-service: \.autotel\/snapshot\.json was not applied/),
    ]);
  });

  it('discovers the events a repository publishes contracts for but has no catalog of', async () => {
    await write(
      'payments-service/docs/runbook.md',
      '---\ntitle: Payments runbook\nowner: Payments\n---\n\nOperate it.\n',
    );
    await write(
      'payments-service/contracts/events/payment.completed.json',
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(
      catalog.events.map(({ repository, event }) => [repository, event.frontmatter.id]),
    ).toEqual([['payments-service', 'payment.completed']]);
    expect(catalog.summary.resourcesByKind.event).toBe(1);
  });

  it('keeps each current event, with the repository that published it, for its page', async () => {
    await writeEvent();
    const versioned = 'payments-service/events/payments/PaymentCaptured/versioned/0.9.0';
    await write(
      `${versioned}/autocatalog.json`,
      JSON.stringify({
        spec: 'autocatalog/v2',
        id: 'payment.captured',
        version: '0.9.0',
        name: 'Payment captured',
        summary: 'An older shape.',
        domain: 'payments',
        schema: 'schema.json',
      }),
    );
    await write(`${versioned}/schema.json`, JSON.stringify({ type: 'object' }));

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(
      catalog.events.map(({ repository, event }) => [repository, event.frontmatter.version]),
    ).toEqual([['payments-service', '1.0.0']]);
    // The earlier version is kept apart, for its own history page.
    expect(
      catalog.history.map(({ repository, event }) => [repository, event.frontmatter.version]),
    ).toEqual([['payments-service', '0.9.0']]);
  });

  it('quarantines a repository whose version could climb out of its page directory', async () => {
    await writeEvent();
    const versioned = 'payments-service/events/payments/PaymentCaptured/versioned/0.9.0';
    await write(
      `${versioned}/autocatalog.json`,
      JSON.stringify({
        spec: 'autocatalog/v2',
        id: 'payment.captured',
        version: '../../../escape',
        name: 'Payment captured',
        summary: 'An older shape.',
        domain: 'payments',
        schema: 'schema.json',
      }),
    );
    await write(`${versioned}/schema.json`, JSON.stringify({ type: 'object' }));

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'payments-service',
        source: 'events',
        message: expect.stringContaining('cannot be a path segment'),
      },
    ]);
    expect(catalog.events).toEqual([]);
    expect(catalog.history).toEqual([]);
  });

  it('quarantines a repository naming a service that could climb out of its page directory', async () => {
    await writeEvent();
    const manifest = 'payments-service/events/payments/PaymentCaptured/autocatalog.json';
    const event = JSON.parse(await fs.readFile(path.join(root, manifest), 'utf8'));
    await write(manifest, JSON.stringify({ ...event, consumers: ['../../escape'] }));

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      expect.objectContaining({
        repository: 'payments-service',
        message: expect.stringContaining('service "../../escape" cannot be a path segment'),
      }),
    ]);
    expect(catalog.events).toEqual([]);
  });

  it('keeps the same event from two repositories apart, whether or not they agree', async () => {
    await writeEvent('payments-service', 'A card payment was captured.');
    await writeEvent('legacy-billing', 'An invoice payment was captured.');
    await writeEvent('mirror-service', 'A card payment was captured.');

    const catalog = await buildDocsCatalog(root);

    expect(catalog.failures).toEqual([]);
    const events = catalog.graph.resources.filter((resource) => resource.ref.kind === 'event');
    expect(events.map((resource) => resource.ref.namespace)).toEqual([
      'legacy-billing/payments',
      'mirror-service/payments',
      'payments-service/payments',
    ]);
    expect(resourcesDefinedByRepository(catalog, 'mirror-service')).toHaveLength(1);
  });

  it('treats a repository that publishes only events as one repository', async () => {
    // `ac site .` inside a repository with events/ and no docs/ yet.
    await writeEvent();
    const repo = path.join(root, 'payments-service');

    const catalog = await buildDocsCatalog(repo, { includeDates: false });

    expect(catalog.events.map(({ event }) => event.frontmatter.id)).toEqual(['payment.captured']);
    expect(catalog.events[0]?.repository).toBe('payments-service');
  });

  it('treats a package that publishes only approved message contracts as one repository', async () => {
    // `ac site .` in a service whose only contract is the one its tests approved.
    await write('payments-service/package.json', '{"name":"payments-service"}');
    await write('payments-service/CODEOWNERS', '* @payments\n');
    await write(
      'payments-service/src/__contracts__/PaymentCaptured.approved.txt',
      JSON.stringify({ paymentId: 'p-1' }),
    );
    const repo = path.join(root, 'payments-service');

    const catalog = await buildDocsCatalog(repo, { includeDates: false });

    expect(
      catalog.events.map(({ event, repository }) => [event.frontmatter.id, repository]),
    ).toEqual([['payment.captured', 'payments-service']]);
    expect(catalog.events[0]?.event.frontmatter.owner?.team).toBe('payments');
  });

  it('publishes a graph the committed graph-v1 contract accepts', async () => {
    // Against the contract file the package ships, not a restatement of it: an
    // adapter in another language is held to exactly this.
    await write(
      'payments-service/docs/runbook.md',
      '---\ntitle: Payments runbook\nowner: Payments\nrelated:\n  - payments-service/other\n---\n\nOperate it.\n',
    );
    await write(
      'payments-service/docs/other.md',
      '---\ntitle: Other\nowner: Payments\n---\n\nOther.\n',
    );
    await writeEvent();
    await writeAgent();

    const { graph } = await buildDocsCatalog(root, { includeDates: false });
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(graphContract);

    expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
  });

  it('quarantines the later repository when two contradict each other, not the whole site', async () => {
    // Two repositories declaring the same model differently is one bad fact,
    // and it belongs to whichever composed second.
    for (const [repository, name] of [
      ['a-agents', 'Fast model'],
      ['b-agents', 'A different model'],
    ] as const) {
      await write(
        `${repository}/models/fast-model.yaml`,
        [
          'id: fast-model',
          `name: ${name}`,
          'owner: Platform',
          'provider: openai',
          'model_id: m',
        ].join('\n'),
      );
      await write(
        `${repository}/agents/${repository}-agent/autocatalog.json`,
        JSON.stringify({ name: 'Agent', owner: 'Ops', model: 'fast-model' }),
      );
    }

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'b-agents',
        source: 'agents',
        message: expect.stringContaining("conflicting resource 'model:fast-model'"),
      },
    ]);
    expect(catalog.graph.resources.map((resource) => resource.ref.id)).toContain('a-agents-agent');
    expect(catalog.graph.resources.map((resource) => resource.ref.id)).not.toContain(
      'b-agents-agent',
    );
  });

  it('records the commit each repository was read at, within the graph-v1 contract', async () => {
    await writeEvent();
    const repo = path.join(root, 'payments-service');

    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

    git('init', '-q');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'events');

    const { graph } = await buildDocsCatalog(root);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(graphContract);

    expect(graph.resources.find((resource) => resource.ref.kind === 'repository')?.source).toEqual({
      repo: 'payments-service',
      ref: git('rev-parse', 'HEAD'),
    });
    expect(validate(graph), JSON.stringify(validate.errors)).toBe(true);
  });

  it('names the repository, not the id namespace, when the two differ', async () => {
    // A site served from /autocatalog/ shortens its id namespace to `docs`;
    // the graph still has to join Events and Agents on the real repository.
    await write('docs/quick-start.md', '---\ntitle: Quick start\nowner: Maintainers\n---\n\nGo.\n');

    const catalog = await buildDocsCatalog(root, {
      repo: 'docs',
      repository: 'autocatalog',
      includeDates: false,
    });

    expect(catalog.graph.resources.map((resource) => resource.ref)).toContainEqual({
      kind: 'repository',
      id: 'autocatalog',
    });
    expect(catalog.graph.resources.find((resource) => resource.ref.kind === 'document')?.url).toBe(
      '/docs/quick-start',
    );
  });

  it('enforces the contract a handbook repository publishes, naming the document that breaks it', async () => {
    await write(
      'handbook/contracts/docs-frontmatter.json',
      JSON.stringify({ type: 'object', required: ['title', 'owner', 'tier'] }),
    );
    await write('payments-service/docs/runbook.md', '---\ntitle: Runbook\nowner: Payments\n---\n');

    await expect(buildDocsCatalog(root, { includeDates: false })).rejects.toThrow(
      /payments-service\/docs\/runbook\.md.*tier/,
    );
  });
});

describe('agents linked to events across repositories', () => {
  async function writeConsumingAgent(consumes: string[]): Promise<void> {
    await write(
      'ledger-agents/models/fast-model.yaml',
      [
        'id: fast-model',
        'name: Fast model',
        'owner: Platform',
        'provider: openai',
        'model_id: m',
      ].join('\n'),
    );
    await write(
      'ledger-agents/agents/reconcile-agent/autocatalog.json',
      JSON.stringify({
        name: 'Reconcile agent',
        owner: 'Ledger',
        model: 'fast-model',
        consumes: consumes.map((event) => ({ event })),
      }),
    );
  }

  it("draws the agent's edge to the event another repository publishes, and shows it on that event", async () => {
    await writeEvent();
    await writeConsumingAgent(['payments/payment.captured']);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(
      catalog.graph.relationships
        .filter((r) => r.type === 'consumes' && r.to.kind === 'agent')
        .map((r) => [r.from.namespace, r.from.id, r.to.id]),
    ).toEqual([['payments-service/payments', 'payment.captured', 'reconcile-agent']]);

    expect(catalog.events).toHaveLength(1);
    const { repository, event } = catalog.events[0]!;

    // The event's own producer is a service, already on the page; only the agent
    // is added, linked to its Catalog entry as a document page links it.
    expect(eventParticipants(catalog, repository, event)).toEqual({
      producers: [],
      consumers: [
        {
          label: 'agent/reconcile-agent',
          kind: 'agent',
          href: '/catalog#resource-agent%3Areconcile-agent',
        },
      ],
    });
  });

  it('quarantines an agent catalog naming an event nobody publishes, and says which', async () => {
    await writeEvent();
    await writeConsumingAgent(['payments/payment.capture']);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'ledger-agents',
        source: 'agents',
        message: expect.stringContaining(
          'Agent "reconcile-agent" consumes unknown event "payments/payment.capture" — did you mean "payments/payment.captured"?',
        ),
      },
    ]);
    // The event itself still publishes; only the broken agent catalog is missing.
    expect(catalog.events).toHaveLength(1);
  });
});

describe('services consuming events across repositories', () => {
  const declare = (consumes: Array<{ service: string; event: string; fields?: string[] }>) =>
    write('ledger/autocatalog.consumes.json', JSON.stringify({ consumes }));

  it('draws the edge from the event another repository publishes, with the fields it reads', async () => {
    await writeEvent();
    // The consumer repository publishes nothing else.
    await declare([
      { service: 'LedgerService', event: 'payments/payment.captured', fields: ['amount'] },
    ]);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(
      catalog.graph.relationships
        .filter((r) => r.type === 'consumes' && r.to.id === 'LedgerService')
        .map((r) => [r.from.namespace, r.from.id, r.attributes]),
    ).toEqual([['payments-service/payments', 'payment.captured', { fields: ['amount'] }]]);

    // The event's page lists it, linked to its entry since it has no page of its own.
    const [entry] = catalog.events;

    if (!entry) throw new Error('the event did not publish');
    const { repository, event } = entry;

    expect(eventParticipants(catalog, repository, event).consumers).toEqual([
      {
        label: 'LedgerService',
        kind: 'service',
        href: '/catalog#resource-service%3ALedgerService',
      },
    ]);
  });

  it('joins a service the producer already lists, without failing either repository', async () => {
    await writeEvent();
    // The producer's manifest names LedgerService too, so the service and the
    // edge already exist when the consumer's declaration arrives.
    const manifest = `${root}/payments-service/events/payments/PaymentCaptured/autocatalog.json`;
    const json = JSON.parse(await fs.readFile(manifest, 'utf8'));
    await fs.writeFile(manifest, JSON.stringify({ ...json, consumers: ['LedgerService'] }));
    await declare([
      { service: 'LedgerService', event: 'payments/payment.captured', fields: ['amount'] },
      { service: 'FraudService', event: 'payments/payment.captured' },
    ]);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(
      catalog.graph.relationships
        .filter((r) => r.type === 'consumes' && r.from.id === 'payment.captured')
        .map((r) => [r.to.id, r.attributes ?? {}]),
    ).toEqual([
      ['FraudService', {}],
      // The producer lists LedgerService; its word on what Ledger reads stands.
      ['LedgerService', {}],
    ]);

    // LedgerService is on the page already, from the manifest; only FraudService is added.
    const [entry] = catalog.events;

    if (!entry) throw new Error('the event did not publish');
    const { repository, event } = entry;

    expect(eventParticipants(catalog, repository, event).consumers.map((c) => c.label)).toEqual([
      'FraudService',
    ]);
  });

  it('quarantines a declaration naming an event nobody publishes, and says which', async () => {
    await writeEvent();
    await declare([{ service: 'LedgerService', event: 'payments/payment.capture' }]);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'ledger',
        source: 'consumers',
        message: expect.stringContaining('payments/payment.capture, which no repository publishes'),
      },
    ]);
    expect(catalog.events).toHaveLength(1);
  });
});

describe('documents about a resource', () => {
  it('draws describes from a runbook to the event it names, linked both ways', async () => {
    await writeEvent();
    await write(
      'acme-handbook/docs/capture-runbook.md',
      '---\ntitle: Capture runbook\nowner: Reliability\nabout:\n  - event/payments/payment.captured\n  - service/PaymentService\n---\n\nReplay it.\n',
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });
    const event = { kind: 'event', namespace: 'payments-service/payments', id: 'payment.captured' };

    expect(catalog.summary.relationshipsByType).toMatchObject({ describes: 2 });
    expect(documentsAbout(catalog.graph, event)).toEqual([
      { href: '/acme-handbook/capture-runbook', title: 'Capture runbook', label: 'acme-handbook' },
    ]);
    expect(
      aboutDocument(catalog.graph, 'acme-handbook/capture-runbook').map((l) => l.label),
    ).toEqual(['event/payments/payment.captured', 'service/PaymentService']);
  });

  it('leaves out a target that does not resolve, and says so during the build', async () => {
    await writeEvent();
    await write(
      'acme-handbook/docs/capture-runbook.md',
      '---\ntitle: Capture runbook\nowner: Reliability\nabout:\n  - event/payments/payment.capture\n---\n\nReplay it.\n',
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.summary.relationshipsByType).not.toHaveProperty('describes');
    expect(catalog.warnings.join('\n')).toContain(
      "did you mean 'event/payments/payment.captured'?",
    );
  });
});

describe('resource graphs from several repositories', () => {
  const statements = { kind: 'collection', namespace: 'main/finance', id: 'statements' } as const;

  function spans(service: string, operation: string) {
    return {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'shared-trace',
                  spanId: 'shared-span',
                  attributes: [
                    { key: 'db.system.name', value: { stringValue: 'mongodb' } },
                    { key: 'db.namespace', value: { stringValue: 'finance' } },
                    { key: 'db.collection.name', value: { stringValue: 'statements' } },
                    { key: 'db.operation.name', value: { stringValue: operation } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  /** A repository holding only `.autocatalog/resources.json`. */
  async function enrol(repository: string, graph: ResourceGraph): Promise<void> {
    await fs.mkdir(path.join(root, repository), { recursive: true });
    await writeResourceGraph(path.join(root, repository), graph);
  }

  function declaredBy(service: string, owner?: string): ResourceGraph {
    const graph = emptyResourceGraph();
    const collection = architectureResource(statements);
    collection.provenance = { default: 'extracted', fields: {} };

    if (owner) collection.owner = { team: owner };
    graph.resources.push(collection, architectureService(service));
    graph.relationships.push({
      type: 'writes',
      from: { kind: 'service', id: service },
      to: statements,
      provenance: 'extracted',
      needsReview: false,
    });

    return graph;
  }

  it('cannot stand in for a service another repository declares by naming it as a consumer', async () => {
    await writeEvent();
    await enrol('billing', declaredBy('billing'));
    // A repository that sorts first claims billing as a consumer of an event.
    await write(
      'aaa-hostile/autocatalog.consumes.json',
      JSON.stringify({ consumes: [{ service: 'billing', event: 'payments/payment.captured' }] }),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    // billing's own declaration stands, and the consumer edge joins it.
    expect(
      catalog.graph.relationships
        .filter((r) => r.from.id === 'billing' || r.to.id === 'billing')
        .map((r) => r.type)
        .sort(),
    ).toEqual(['consumes', 'writes']);
  });

  it('quarantines a repository claiming a datastore another repository declares', async () => {
    await enrol('billing', declaredBy('billing'));
    await enrol('reporting', declaredBy('reporting', 'reporting-team'));

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'reporting',
        source: 'resources',
        message:
          '.autocatalog/resources.json redefines collection:main%2Ffinance/statements, which billing declares',
      },
    ]);
    expect(datastoreOwnership(catalog.graph)).toEqual([
      { ref: statements, owner: null, writers: ['billing'], readers: [], evidence: undefined },
    ]);
  });

  it("keeps a declared owner when another repository's graph names a different one", async () => {
    await enrol('billing', declaredBy('billing', 'ledger'));
    const intruder = declaredBy('reporting', 'reporting-team');
    intruder.resources[0]!.provenance = { default: 'declared', fields: {} };
    await enrol('reporting', intruder);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures.map((failure) => failure.repository)).toEqual(['reporting']);
    expect(catalog.warnings).toContain(
      'reporting: its .autocatalog/resources.json did not compile and is missing from the graph — .autocatalog/resources.json redefines collection:main%2Ffinance/statements, which billing declares',
    );
    expect(datastoreOwnership(catalog.graph)).toEqual([
      expect.objectContaining({ owner: 'ledger', writers: ['billing'] }),
    ]);
  });

  it("adds another repository's observations to a declared datastore", async () => {
    await enrol('billing', declaredBy('billing', 'ledger'));
    await enrol(
      'reporting',
      discoverTraceResources(spans('reporting', 'find'), { datastore: 'main' }),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(datastoreOwnership(catalog.graph)).toEqual([
      expect.objectContaining({ owner: 'ledger', writers: ['billing'], readers: ['reporting'] }),
    ]);
  });

  it('counts a span two repositories imported once', async () => {
    const imported = discoverTraceResources(spans('billing', 'insert'), { datastore: 'main' });
    await enrol('billing', imported);
    await enrol('ledger', imported);

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([]);
    expect(
      catalog.graph.relationships.find((relationship) => relationship.type === 'writes')?.evidence
        ?.count,
    ).toBe(1);
  });

  it('quarantines an unreadable resources.json by name, and builds the rest', async () => {
    await enrol('billing', declaredBy('billing'));
    await write('broken/.autocatalog/resources.json', '{');
    await write(
      'invalid/.autocatalog/resources.json',
      JSON.stringify({ spec: 'autocatalog/graph-v1' }),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.failures).toEqual([
      {
        repository: 'broken',
        source: 'resources',
        message: '.autocatalog/resources.json: not valid JSON',
      },
      {
        repository: 'invalid',
        source: 'resources',
        message:
          ".autocatalog/resources.json: does not match the resource graph contract (must have required property 'resources')",
      },
    ]);
    expect(catalog.warnings).toContain(
      'broken: its .autocatalog/resources.json did not compile and is missing from the graph — .autocatalog/resources.json: not valid JSON',
    );
    expect(datastoreOwnership(catalog.graph)).toHaveLength(1);
  });
});
