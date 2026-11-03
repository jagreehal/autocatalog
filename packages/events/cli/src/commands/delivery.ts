import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import kleur from 'kleur';
import type { Command } from 'commander';
import { z } from 'zod';
import {
  analyzeDelivery,
  deliveryEvents,
  edgeBindings,
  nodeOf,
  type BrokerNode,
  jsonValueSchema,
  loadRepositoryEvents,
  rabbitMqGraph,
  readConsumerDeclarations,
  resourceKey,
  scanArchitecture,
  type CatalogRelationship,
  type ConsumerDelivery,
  type DeliveryFinding,
  type DeliveryHop,
  type DeliveryReport,
  type JsonValue,
  type ResourceGraph,
} from 'autocatalog-core';

const execFileAsync = promisify(execFile);

/** The delivery report for a source tree: its broker configuration, events and consumer declarations. */
export async function deliveryReport(
  root: string,
  graph?: ResourceGraph,
): Promise<{ report: DeliveryReport; graph: ResourceGraph }> {
  let resources = graph;

  if (!resources) {
    const scanned = await scanArchitecture({ root, publish: false });

    if (scanned.errors.length) throw new Error(scanned.errors.join('; '));
    resources = scanned.graph;
  }

  const [events, consumers] = await Promise.all([
    loadRepositoryEvents(root),
    readConsumerDeclarations(root),
  ]);

  return {
    report: analyzeDelivery({ graph: resources, events: deliveryEvents(events), consumers }),
    graph: resources,
  };
}

const at = (hop: DeliveryHop): string =>
  hop.source?.file
    ? kleur.dim(`  ${hop.source.file}${hop.source.line ? `:${hop.source.line}` : ''}`)
    : '';

const confidenceColor = {
  confirmed: kleur.red,
  policy: kleur.red,
  possible: kleur.yellow,
  unknown: kleur.magenta,
} as const;

/** One consumer's route as an indented path, the way a reader would sketch it. */
export function renderRoute(route: ConsumerDelivery, environment?: string): string {
  const lines = [
    `${kleur.bold(route.event)}${environment ? kleur.dim(` (${environment})`) : ''} → ${route.consumer}`,
  ];

  const reaching = route.examples.find((example) => example.reaches)?.path;
  const producers = route.producers.length ? route.producers.join(', ') : '(no producer declared)';

  lines.push(`  ${producers}`);

  const reachingPath = reaching ?? [];
  const first = reachingPath[0];

  lines.push(
    `    → ${route.exchange || '(default exchange)'}${kleur.dim(` ${first?.entity ?? 'destination'}`)}`,
  );

  if (reaching) {
    let depth = 3;

    for (const hop of reaching.slice(1)) {
      lines.push(
        `${'  '.repeat(depth)}→ ${hop.ref.id}${kleur.dim(` ${hop.entity ?? ''}`)}${hop.rule ? ` [${hop.rule}]` : ''}${at(hop)}`,
      );
      depth++;
    }

    lines.push(`${'  '.repeat(depth)}→ ${route.consumer}`);

    if (route.deadLetter)
      lines.push(
        `${'  '.repeat(depth)}→ rejected: ${route.deadLetter.exchange} → ${route.deadLetter.queues.join(', ') || kleur.red('nowhere')}`,
      );
  } else {
    lines.push(`      ${kleur.red(`✗ no committed example reaches ${route.queue}`)}`);
  }

  if (route.facts.length) lines.push(`  ${kleur.dim(route.facts.join(' · '))}`);

  for (const example of route.examples) {
    const headers = Object.entries(example.headers)
      .map(([key, value]) => `${key} = ${String(value)}`)
      .join(', ');

    const outcome =
      example.reaches === undefined
        ? kleur.magenta('not evaluated')
        : example.reaches
          ? kleur.green('reaches')
          : kleur.yellow('excluded');

    lines.push(
      `  ${kleur.dim('example')} ${example.name}${headers ? ` (${headers})` : ''}: ${outcome}`,
    );
  }

  return lines.join('\n');
}

export function renderFinding(finding: DeliveryFinding): string {
  const where = finding.source?.file
    ? kleur.dim(`  ${finding.source.file}${finding.source.line ? `:${finding.source.line}` : ''}`)
    : '';

  return `${confidenceColor[finding.confidence](finding.confidence.padEnd(10))} ${finding.message}${where}`;
}

export async function runDelivery(opts: {
  root: string;
  format: 'text' | 'json';
}): Promise<number> {
  const { report } = await deliveryReport(path.resolve(opts.root));

  if (opts.format === 'json') console.log(JSON.stringify(report, null, 2));
  else {
    if (report.routes.length === 0 && report.findings.length === 0)
      console.log(
        'No delivery routes: no broker definitions, AMQP event transport or consumer queue was found.',
      );

    for (const route of report.routes) console.log(`${renderRoute(route, report.environment)}\n`);

    for (const finding of report.findings) console.log(renderFinding(finding));

    console.log(
      report.complete
        ? kleur.dim('\nEvery route was evaluated.')
        : kleur.magenta(
            '\nIncomplete: parts of a route were not evaluated, so this is not a clean result.',
          ),
    );
  }

  return report.findings.some((f) => f.confidence === 'confirmed' || f.confidence === 'policy')
    ? 1
    : 0;
}

// ---------------------------------------------------------------------------
// Verification against a running broker

export type VerificationStatus = 'PASS' | 'FAIL' | 'NOT TESTED' | 'UNKNOWN';

export interface VerificationResult {
  status: VerificationStatus;
  check: string;
  event?: string;
  consumer?: string;
  example?: string;
  correlationId?: string;
  /** Where the evidence was seen and how long it took; never the message body. */
  evidence?: { queue: string; receivedAfterMs?: number; observedForMs?: number };
  source?: string;
}

export interface Verification {
  spec: 'autocatalog/delivery-verification-v1';
  at: string;
  environment?: string;
  revision?: string;
  adapter: { provider: 'rabbitmq'; version?: string; broker: string };
  results: VerificationResult[];
}

interface ManagementApi {
  get(pathname: string): Promise<JsonValue>;
  post(pathname: string, body: JsonValue): Promise<JsonValue>;
}

/** The RabbitMQ management HTTP API. Credentials come from the URL and are never printed. */
export function managementApi(url: string): ManagementApi & { broker: string } {
  const parsed = new URL(url);

  const auth = `Basic ${Buffer.from(
    `${decodeURIComponent(parsed.username || 'guest')}:${decodeURIComponent(parsed.password || 'guest')}`,
  ).toString('base64')}`;

  parsed.username = '';
  parsed.password = '';
  const base = parsed.toString().replace(/\/$/, '');

  const call = async (method: string, pathname: string, body?: JsonValue): Promise<JsonValue> => {
    const request = () =>
      fetch(`${base}${pathname}`, {
        method,
        headers: { authorization: auth, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });

    // A GET is retried once when the broker dropped an idle connection. A POST
    // is not: repeating a publish or a /get could duplicate or lose a message.
    const response = method === 'GET' ? await request().catch(request) : await request();

    if (!response.ok)
      throw new Error(`${method} ${pathname}: ${response.status} ${response.statusText}`);

    const text = await response.text();

    return jsonValueSchema.parse(text ? JSON.parse(text) : null);
  };

  return {
    broker: `${parsed.protocol}//${parsed.host}`,
    get: (pathname) => call('GET', pathname),
    post: (pathname, body) => call('POST', pathname, body),
  };
}

/** A message `/api/queues/…/get` returns, as far as the run reads it: never the body. */
const takenMessages = z
  .array(
    z.object({
      properties: z.object({ correlation_id: z.string().optional() }).default({}),
      redelivered: z.boolean().default(false),
    }),
  )
  .catch([]);

const overviewResponse = z.object({ rabbitmq_version: z.string().optional() }).catch({});

const comparable = (edge: CatalogRelationship) =>
  JSON.stringify(
    edgeBindings(edge)
      .map((b) => JSON.stringify([b.routingKey, Object.entries(b.arguments).sort()]))
      .sort(),
  );

const isRabbitMq = (namespace: string | undefined) => namespace?.startsWith('rabbitmq') === true;

const located = (source: { file?: string; line?: number } | undefined) =>
  source?.file ? `${source.file}${source.line ? `:${source.line}` : ''}` : undefined;

/** What a queue or exchange promises, as the deployment comparison checks it. */
const PROMISES: Array<[label: string, read: (node: BrokerNode) => string | number | undefined]> = [
  ['exchange type', (node) => node.type],
  ['delivery limit', (node) => node.maxAttempts],
  ['dead-letter exchange', (node) => node.deadLetter?.target],
  ['dead-letter routing key', (node) => node.deadLetter?.routingKey],
  ['message TTL (seconds)', (node) => node.retentionSeconds],
  ['idle expiry (seconds)', (node) => node.idleExpirySeconds],
  ['length limit', (node) => node.maxLength],
  ['alternate exchange', (node) => node.alternate],
];

/**
 * Level two: does the RabbitMQ deployment hold what the repository declares,
 * with the same bindings and the same promises (delivery limit, dead-letter
 * exchange, TTL)? Other brokers' routes are not compared here.
 */
export function compareDeployment(
  declared: ResourceGraph,
  deployed: ResourceGraph,
): VerificationResult[] {
  const results: VerificationResult[] = [];

  const brokerOnly = (graph: ResourceGraph) =>
    graph.resources.filter((r) => isRabbitMq(r.ref.namespace));

  const live = new Map(brokerOnly(deployed).map((r) => [resourceKey(r.ref), r]));

  const liveEdges = new Map(
    deployed.relationships
      .filter((e) => e.type === 'routesTo')
      .map((e) => [`${resourceKey(e.from)}>${resourceKey(e.to)}`, e]),
  );

  for (const resource of brokerOnly(declared)) {
    const source = located(resource.source);
    const node = nodeOf(resource);
    const entity = node?.entity ?? 'resource';
    const deployedResource = live.get(resourceKey(resource.ref));

    if (!deployedResource) {
      results.push({
        status: 'FAIL',
        check: `declared ${entity} ${resource.ref.id} is missing from the deployment`,
        source,
      });
      continue;
    }

    const deployedNode = nodeOf(deployedResource);

    if (!node || !deployedNode) continue;

    for (const [label, read] of PROMISES) {
      const want = read(node);
      const have = read(deployedNode);

      if (want !== have)
        results.push({
          status: 'FAIL',
          check: `${entity} ${resource.ref.id} has ${label} ${have ?? 'unset'} deployed, ${want ?? 'unset'} declared`,
          source,
        });
    }
  }

  for (const edge of declared.relationships.filter(
    (e) => e.type === 'routesTo' && isRabbitMq(e.from.namespace),
  )) {
    const key = `${resourceKey(edge.from)}>${resourceKey(edge.to)}`;
    const deployedEdge = liveEdges.get(key);
    const source = located(edge.source);
    const name = `${edge.from.id} → ${edge.to.id}`;

    if (!deployedEdge)
      results.push({
        status: 'FAIL',
        check: `declared route ${name} is missing from the deployment`,
        source,
      });
    else if (comparable(edge) !== comparable(deployedEdge))
      results.push({
        status: 'FAIL',
        check: `declared route ${name} has different bindings in the deployment`,
        source,
      });
    else results.push({ status: 'PASS', check: `declared route ${name} exists`, source });
  }

  return results;
}

interface Received {
  correlationId: string;
  at: number;
  /** Whether the broker had delivered it before: a retry. */
  redelivered: boolean;
}

type Ackmode = 'ack_requeue_false' | 'reject_requeue_false' | 'reject_requeue_true';

/** Messages taken off queues during the run, by queue. */
export class Mailbox {
  readonly seen = new Map<string, Received[]>();

  constructor(
    private readonly api: ManagementApi,
    private readonly started: number,
  ) {}

  /**
   * Take what the queue holds, batch by batch, until it is empty or the
   * deadline passes. Bounded: a dead-letter cycle can hand a rejected message
   * straight back, so the queue may never empty.
   */
  async take(vhost: string, queue: string, ackmode: Ackmode, deadline: number) {
    while (Date.now() < deadline) {
      const batch = takenMessages.parse(
        await this.api.post(
          `/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(queue)}/get`,
          { count: 50, ackmode, encoding: 'auto', truncate: 1 },
        ),
      );

      if (batch.length === 0) return;

      for (const message of batch) {
        const id = message.properties.correlation_id;

        if (id)
          this.seen.set(queue, [
            ...(this.seen.get(queue) ?? []),
            { correlationId: id, at: Date.now() - this.started, redelivered: message.redelivered },
          ]);
      }
    }
  }

  has(queue: string, correlationId: string): Received | undefined {
    return this.seen.get(queue)?.find((m) => m.correlationId === correlationId);
  }

  /** Every time a message was taken off a queue, oldest first. */
  all(queue: string, correlationId: string): Received[] {
    return this.seen.get(queue)?.filter((m) => m.correlationId === correlationId) ?? [];
  }

  /** Take one batch only, so a requeued message is not taken again in the same call. */
  async once(vhost: string, queue: string, ackmode: Ackmode) {
    const batch = takenMessages.parse(
      await this.api.post(
        `/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(queue)}/get`,
        { count: 1, ackmode, encoding: 'auto', truncate: 1 },
      ),
    );

    for (const message of batch) {
      const id = message.properties.correlation_id;

      if (id)
        this.seen.set(queue, [
          ...(this.seen.get(queue) ?? []),
          { correlationId: id, at: Date.now() - this.started, redelivered: message.redelivered },
        ]);
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `done` or the deadline passes. */
async function until(
  deadline: number,
  poll: (deadline: number) => Promise<void>,
  done: () => boolean,
) {
  for (;;) {
    await poll(deadline);

    if (done() || Date.now() >= deadline) return;
    await sleep(100);
  }
}

/**
 * Level three: publish each committed example with a unique correlation id and
 * record what arrives where. Messages are taken off, and some rejected, on the
 * consumer queues: a disposable broker only.
 */
export async function verifyDelivery(opts: {
  root: string;
  url: string;
  deadlineMs?: number;
  windowMs?: number;
}): Promise<Verification> {
  const root = path.resolve(opts.root);
  const api = managementApi(opts.url);
  const deadlineMs = opts.deadlineMs ?? 5000;
  const windowMs = opts.windowMs ?? 1500;
  const { report, graph } = await deliveryReport(root);
  const overview = overviewResponse.parse(await api.get('/api/overview'));
  const deployed = rabbitMqGraph(await api.get('/api/definitions'), { file: 'deployed' });
  const results = compareDeployment(graph, deployed);
  const events = await loadRepositoryEvents(root);
  const started = Date.now();
  const mailbox = new Mailbox(api, started);

  const payloadOf = (event: string, example: string): JsonValue | undefined =>
    events
      .find((e) => `${e.frontmatter.domain}/${e.frontmatter.id}` === event && !e.folder.isVersioned)
      ?.examples.find((e) => e.name === example)?.data;

  const publish = async (
    route: ConsumerDelivery,
    example: string,
    headers: Record<string, string | number | boolean>,
  ) => {
    const correlationId = randomUUID();
    const vhost = route.vhost ?? '/';
    const exchange = route.exchange === '' ? 'amq.default' : route.exchange;

    await api.post(
      `/api/exchanges/${encodeURIComponent(vhost)}/${encodeURIComponent(exchange)}/publish`,
      {
        properties: {
          correlation_id: correlationId,
          message_id: correlationId,
          headers,
          content_type: 'application/json',
        },
        routing_key: route.routingKey,
        payload: JSON.stringify(payloadOf(route.event, example) ?? {}),
        payload_encoding: 'string',
      },
    );

    return { correlationId };
  };

  type Route = (typeof report.routes)[number];

  type Example = Route['examples'][number];

  const vhostFor = (route: Route) => route.vhost ?? '/';

  /** The consumer fails once, the message is requeued, and the retry is processed. */
  const recovery = async (route: Route, example: Example): Promise<VerificationResult> => {
    const vhost = vhostFor(route);
    const { correlationId } = await publish(route, example.name, example.headers);

    const base = {
      event: route.event,
      consumer: route.consumer,
      example: example.name,
      correlationId,
    };

    await until(
      Date.now() + deadlineMs,
      () => mailbox.once(vhost, route.queue, 'reject_requeue_true'),
      () => Boolean(mailbox.has(route.queue, correlationId)),
    );

    if (!mailbox.has(route.queue, correlationId))
      return {
        ...base,
        status: 'NOT TESTED',
        check: `recovery: no message reached ${route.queue} to fail`,
      };

    await until(
      Date.now() + deadlineMs,
      () => mailbox.once(vhost, route.queue, 'ack_requeue_false'),
      () => mailbox.all(route.queue, correlationId).length > 1,
    );

    const retry = mailbox.all(route.queue, correlationId)[1];

    return {
      ...base,
      status: retry?.redelivered ? 'PASS' : 'FAIL',
      check: retry?.redelivered
        ? `consumer recovers: a message ${route.consumer} failed once is redelivered and processed`
        : `a message ${route.consumer} failed once was not redelivered within ${deadlineMs}ms`,
      evidence: { queue: route.queue, ...(retry && { receivedAfterMs: retry.at }) },
    };
  };

  /** The consumer keeps failing: after the queue's attempt limit the message is dead-lettered. */
  const attemptLimit = async (
    route: Route,
    example: Example,
    limit: number,
  ): Promise<VerificationResult> => {
    const base = { event: route.event, consumer: route.consumer, example: example.name };

    if (limit > 10)
      return {
        ...base,
        status: 'NOT TESTED',
        check: `the attempt limit of ${limit} on ${route.queue}: too many deliveries for a short test`,
      };

    const vhost = vhostFor(route);
    const dlq = route.deadLetter!.queues[0]!;
    const { correlationId } = await publish(route, example.name, example.headers);

    // Fail every delivery, requeueing it, until the broker stops offering it.
    await until(
      Date.now() + deadlineMs * 2,
      () => mailbox.once(vhost, route.queue, 'reject_requeue_true'),
      () => mailbox.all(route.queue, correlationId).length > limit,
    );

    await until(
      Date.now() + deadlineMs,
      (by) => mailbox.take(vhost, dlq, 'ack_requeue_false', by),
      () => Boolean(mailbox.has(dlq, correlationId)),
    );

    const deliveries = mailbox.all(route.queue, correlationId).length;
    const got = mailbox.has(dlq, correlationId);
    // RabbitMQ dead-letters a message once it has failed more than the limit.
    const expected = limit + 1;
    const pass = Boolean(got) && deliveries === expected;

    return {
      ...base,
      correlationId,
      status: pass ? 'PASS' : 'FAIL',
      check: pass
        ? `a message that keeps failing reaches ${dlq} after ${deliveries} deliveries (delivery limit ${limit})`
        : got
          ? `a message reached ${dlq} after ${deliveries} deliveries, where a delivery limit of ${limit} gives up after ${expected}`
          : `a message failed ${deliveries} times did not reach ${dlq} within ${deadlineMs}ms`,
      evidence: { queue: dlq, ...(got && { receivedAfterMs: got.at }) },
    };
  };

  for (const route of report.routes.filter((r) => r.system !== 'rabbitmq'))
    results.push({
      event: route.event,
      consumer: route.consumer,
      status: 'NOT TESTED',
      check: `delivery to ${route.queue} on ${route.system}: live verification runs against RabbitMQ`,
    });

  for (const route of report.routes.filter((r) => r.system === 'rabbitmq')) {
    const vhost = vhostFor(route);
    const base = { event: route.event, consumer: route.consumer };
    const matching = route.examples.filter((e) => e.reaches === true);
    const rejected = route.examples.filter((e) => e.reaches === false);
    const sent = new Map<string, string>();

    for (const example of [...matching, ...rejected]) {
      const { correlationId } = await publish(route, example.name, example.headers);
      sent.set(example.name, correlationId);
    }

    const take = (by: number) => mailbox.take(vhost, route.queue, 'ack_requeue_false', by);

    await until(Date.now() + deadlineMs, take, () =>
      matching.every((e) => mailbox.has(route.queue, sent.get(e.name)!)),
    );

    let control = false;

    for (const example of matching) {
      const id = sent.get(example.name)!;
      const got = mailbox.has(route.queue, id);

      control ||= Boolean(got);
      results.push({
        ...base,
        status: got ? 'PASS' : 'FAIL',
        check: got
          ? `matching example ${example.name} reaches ${route.consumer}`
          : `matching example ${example.name} did not reach ${route.consumer} within ${deadlineMs}ms`,
        example: example.name,
        correlationId: id,
        evidence: { queue: route.queue, ...(got && { receivedAfterMs: got.at }) },
      });
    }

    // Absence means something only next to a message that did arrive.
    if (rejected.length && control) {
      const watchUntil = Date.now() + windowMs;

      await until(watchUntil, take, () => false);

      for (const example of rejected) {
        const id = sent.get(example.name)!;
        const got = mailbox.has(route.queue, id);

        results.push({
          ...base,
          status: got ? 'FAIL' : 'PASS',
          check: got
            ? `rejected example ${example.name} reached ${route.consumer}`
            : `rejected example ${example.name} is excluded`,
          example: example.name,
          correlationId: id,
          evidence: { queue: route.queue, observedForMs: windowMs },
        });
      }
    } else if (rejected.length) {
      for (const example of rejected)
        results.push({
          ...base,
          status: 'NOT TESTED',
          check: `rejected example ${example.name} is excluded: no matching example arrived to compare against`,
          example: example.name,
        });
    }

    const [first] = matching;

    if (route.deadLetter?.queues.length && first) {
      const { correlationId } = await publish(route, first.name, first.headers);

      // The consumer fails: it rejects the message without requeueing it.
      await until(
        Date.now() + deadlineMs,
        (by) => mailbox.take(vhost, route.queue, 'reject_requeue_false', by),
        () => Boolean(mailbox.has(route.queue, correlationId)),
      );

      const dlq = route.deadLetter.queues[0]!;

      // Nothing arrived to reject: the failure path was never exercised.
      if (!mailbox.has(route.queue, correlationId)) {
        results.push({
          ...base,
          status: 'NOT TESTED',
          check: `failure handling: no message reached ${route.queue} to reject`,
          example: first.name,
          correlationId,
        });
      } else {
        await until(
          Date.now() + deadlineMs,
          (by) => mailbox.take(vhost, dlq, 'ack_requeue_false', by),
          () => Boolean(mailbox.has(dlq, correlationId)),
        );

        const got = mailbox.has(dlq, correlationId);

        results.push({
          ...base,
          status: got ? 'PASS' : 'FAIL',
          check: got
            ? `failed processing reaches ${dlq}`
            : `a message ${route.consumer} rejected did not reach ${dlq} within ${deadlineMs}ms`,
          example: first.name,
          correlationId,
          evidence: { queue: dlq, ...(got && { receivedAfterMs: got.at }) },
        });
      }
    } else if (!route.deadLetter) {
      results.push({
        ...base,
        status: 'NOT TESTED',
        check: `failure handling: ${route.queue} has no dead-letter exchange`,
      });
    }

    if (first) results.push(await recovery(route, first));

    if (first && route.deadLetter?.queues.length && route.maxAttempts !== undefined)
      results.push(await attemptLimit(route, first, route.maxAttempts));

    results.push({
      ...base,
      status: 'UNKNOWN',
      check: `whether ${route.producers.join(', ') || 'the producer'}'s own identity can publish: tested as the management user`,
    });
  }

  for (const finding of report.findings.filter((f) => f.confidence === 'unknown'))
    results.push({
      status: 'UNKNOWN',
      check: finding.message,
      event: finding.event,
      ...(finding.consumer && { consumer: finding.consumer }),
    });

  results.push(
    { status: 'NOT TESTED', check: 'retention expiry over time' },
    { status: 'NOT TESTED', check: 'redelivery delays between attempts' },
    { status: 'NOT TESTED', check: 'throughput and outage recovery' },
  );

  const git = (args: string[]) =>
    execFileAsync('git', args, { cwd: root })
      .then((r) => r.stdout.trim())
      .catch(() => undefined);

  const head = await git(['rev-parse', 'HEAD']);
  // The configuration verified may not be the one committed.
  const dirty = head && (await git(['status', '--porcelain', '--', '.']));
  const revision = head && `${head}${dirty ? ' (with uncommitted changes)' : ''}`;

  return {
    spec: 'autocatalog/delivery-verification-v1',
    at: new Date(started).toISOString(),
    ...(report.environment && { environment: report.environment }),
    ...(revision && { revision }),
    adapter: {
      provider: 'rabbitmq',
      ...(overview.rabbitmq_version && { version: overview.rabbitmq_version }),
      broker: api.broker,
    },
    results,
  };
}

const ORDER: VerificationStatus[] = ['FAIL', 'PASS', 'NOT TESTED', 'UNKNOWN'];

export function renderVerificationMarkdown(verification: Verification): string {
  const lines = [
    `# Delivery verification${verification.environment ? `: ${verification.environment}` : ''}`,
    '',
    `- Configuration revision: ${verification.revision ?? 'unknown'}`,
    `- Adapter: RabbitMQ ${verification.adapter.version ?? ''} at ${verification.adapter.broker}`,
    `- Run at: ${verification.at}`,
    '',
    'A pass means these scenarios worked against this configuration at this time, nothing more.',
    '',
    '| Result | Check | Evidence |',
    '| --- | --- | --- |',
  ];

  const sorted = [...verification.results].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );

  for (const result of sorted) {
    const evidence = [
      result.correlationId && `correlation ${result.correlationId}`,
      result.evidence?.queue && `queue ${result.evidence.queue}`,
      result.evidence?.receivedAfterMs !== undefined &&
        `after ${result.evidence.receivedAfterMs}ms`,
      result.evidence?.observedForMs !== undefined && `watched ${result.evidence.observedForMs}ms`,
      result.source,
    ]
      .filter(Boolean)
      .join(', ');

    lines.push(`| ${result.status} | ${result.check.replaceAll('|', '\\|')} | ${evidence} |`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runDeliveryVerify(opts: {
  root: string;
  url: string;
  disposable: boolean;
  out?: string;
  deadline: string;
  window: string;
}): Promise<number> {
  if (!opts.disposable) {
    console.error(
      'ac delivery verify takes messages off, and rejects messages on, the consumer queues. Run it against a disposable broker and pass --disposable to say so.',
    );

    return 2;
  }

  const verification = await verifyDelivery({
    root: opts.root,
    url: opts.url,
    deadlineMs: Number(opts.deadline),
    windowMs: Number(opts.window),
  });

  const colors = {
    PASS: kleur.green,
    FAIL: kleur.red,
    'NOT TESTED': kleur.dim,
    UNKNOWN: kleur.magenta,
  };

  for (const result of verification.results)
    console.log(`${colors[result.status](result.status.padEnd(11))} ${result.check}`);

  if (opts.out) {
    await fs.mkdir(opts.out, { recursive: true });
    await fs.writeFile(
      path.join(opts.out, 'delivery-verification.json'),
      `${JSON.stringify(verification, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(opts.out, 'delivery-verification.md'),
      renderVerificationMarkdown(verification),
    );
    console.log(kleur.dim(`\nwrote ${path.join(opts.out, 'delivery-verification.{json,md}')}`));
  }

  return verification.results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

export function registerDeliveryCommands(program: Command): void {
  const delivery = program
    .command('delivery')
    .description(
      'Show how each event reaches its consumers, and what in the broker configuration breaks it',
    )
    .argument('[root]', 'repository to read', process.cwd())
    .option('--format <fmt>', 'text or json', 'text')
    .action(async (root: string, opts: { format: 'text' | 'json' }) => {
      process.exitCode = await runDelivery({ root, format: opts.format });
    });

  delivery
    .command('verify [root]')
    .description(
      'Check a disposable RabbitMQ against the declared routes by delivering each committed example',
    )
    .requiredOption('--url <url>', 'management API, such as http://guest:guest@localhost:15672')
    .option(
      '--disposable',
      'confirm the broker is disposable: messages are consumed and rejected',
      false,
    )
    .option('--out <dir>', 'write delivery-verification.json and .md here')
    .option('--deadline <ms>', 'how long a matching message has to arrive', '5000')
    .option('--window <ms>', 'how long a rejected message is watched for', '1500')
    .action(
      async (
        root: string | undefined,
        opts: { url: string; disposable: boolean; out?: string; deadline: string; window: string },
      ) => {
        process.exitCode = await runDeliveryVerify({ ...opts, root: root ?? process.cwd() });
      },
    );
}
