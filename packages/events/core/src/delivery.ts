import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import type { SourceLocation } from './adapter-event';
import { emptyResourceGraph, mergeArchitectureGraphs } from './architecture';
import { deliveryNeedsOf, isSafeName, UNSAFE_CONSUMER, type ConsumerDeclaration } from './consumes';
import { cloudFormationGraph, parseCloudFormation } from './delivery-aws';
import { parseStrimzi, strimziGraph } from './delivery-kafka';
import {
  contentMatches,
  headerValue,
  rabbitPatternMatches,
  sqlFilterMatches,
  topicMatches,
  type HeaderValue,
} from './delivery-match';
import {
  deliveryEvent,
  deliveryEventOf,
  durationWords,
  named,
  nodeOf,
  PROTOCOL_SYSTEMS,
  routeOf,
  type BrokerNode,
  type DeliveryBinding,
  type DeliveryEvent,
  type DeliveryTransport,
  type RouteAttributes,
} from './delivery-model';
import { looksLikeRabbitMqDefinitions, rabbitMqGraph } from './delivery-rabbitmq';
import { parseArmServiceBus, serviceBusGraph } from './delivery-servicebus';
import type { DriftFinding } from './drift';
import { isJsonObject, jsonValueSchema, type JsonObject, type JsonValue } from './json';
import type { LoadedEvent } from './load';
import type { ResourceDiscoveryResult } from './model-resources';
import {
  ResourceReadError,
  readResourceSource,
  resourceFiles,
  type ResourceScanOptions,
} from './resource-files';
import {
  AUTOCATALOG_GRAPH_SPEC,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';
import { durationSeconds } from './schema';

/**
 * Delivery: how an event gets from its producer to each consumer, read from
 * the broker's own configuration. RabbitMQ definitions, CloudFormation (SNS,
 * SQS, EventBridge, IAM), Strimzi (Kafka) and ARM (Azure Service Bus) are read
 * into one model of routers, stores and the routes between them
 * (delivery-model.ts). Every committed example is routed through it, and what
 * the configuration gets wrong is reported with how sure the catalog is.
 */
export { RABBITMQ, rabbitMqGraph, rabbitNamespace } from './delivery-rabbitmq';

export { topicMatches } from './delivery-match';

export { named } from './delivery-model';

export {
  deliveryEventOf,
  edgeBindings,
  nodeOf,
  type BrokerNode,
  type DeliveryBinding,
  type DeliveryEvent,
  type DeliveryTransport,
} from './delivery-model';

// ---------------------------------------------------------------------------
// Discovery

/** Files a broker's configuration can live in. Most are skipped on a quick look at the text. */
const CONFIG_FILE = /\.(json|ya?ml|template)$/;

const RABBITMQ_FILE = /(^|\.)definitions\.json$/;

/** Folders of test data: broker configuration there is not what the broker runs. */
const TEST_FOLDERS = ['test', 'tests', '__tests__', 'fixtures', '__fixtures__'];

export async function scanDeliveryResources(
  options: ResourceScanOptions & { environment?: string },
): Promise<ResourceDiscoveryResult> {
  const errors: string[] = [];
  const skipped: string[] = [];
  const fragments: ResourceGraph[] = [];
  const strimzi: Array<{ value: JsonValue; file: string }> = [];
  const environment = options.environment;

  const files = await resourceFiles(
    { ...options, exclude: [...(options.exclude ?? []), ...TEST_FOLDERS] },
    { include: (file) => CONFIG_FILE.test(path.basename(file)), skipped },
  );

  for (const file of files.sort()) {
    const relative = path.relative(options.root, file).split(path.sep).join('/');
    const named = RABBITMQ_FILE.test(path.basename(file));
    let text: string;

    try {
      text = await readResourceSource(file, options);
    } catch (error) {
      // Only a file named as broker configuration is missed out loud.
      if (named) errors.push(error instanceof Error ? error.message : String(error));

      continue;
    }

    try {
      if (named) {
        let value: JsonValue;

        try {
          value = jsonValueSchema.parse(JSON.parse(text));
        } catch {
          throw new ResourceReadError('not-json', `${relative}: not valid JSON`);
        }

        if (looksLikeRabbitMqDefinitions(value))
          fragments.push(rabbitMqGraph(value, { file: relative, text, environment }));

        continue;
      }

      const serviceBus = relative.endsWith('.json') ? parseArmServiceBus(text) : undefined;

      if (serviceBus) {
        fragments.push(serviceBusGraph(serviceBus, { file: relative, environment }));
        continue;
      }

      const cloudFormation = parseCloudFormation(text, relative);

      if (cloudFormation) {
        fragments.push(cloudFormationGraph(cloudFormation, { file: relative, text, environment }));
        continue;
      }

      const kafka = relative.endsWith('.json') ? undefined : parseStrimzi(text);

      if (kafka) strimzi.push(...kafka.map((value) => ({ value, file: relative })));
    } catch (error) {
      errors.push(
        error instanceof ResourceReadError
          ? error.message
          : `${relative}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (strimzi.length) fragments.push(strimziGraph(strimzi, { environment }));

  return {
    graph: errors.length ? emptyResourceGraph() : mergeArchitectureGraphs(...fragments),
    errors,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// The broker as a graph to route through

interface Node {
  resource: CatalogResource;
  node: BrokerNode;
  key: string;
}

class Broker {
  readonly nodes = new Map<string, Node>();
  readonly out = new Map<string, CatalogRelationship[]>();

  constructor(readonly graph: ResourceGraph) {
    for (const resource of graph.resources) {
      const node = nodeOf(resource);

      if (node)
        this.nodes.set(resourceKey(resource.ref), {
          resource,
          node,
          key: resourceKey(resource.ref),
        });
    }

    for (const edge of graph.relationships) {
      if (edge.type !== 'routesTo') continue;

      const key = resourceKey(edge.from);

      this.out.set(key, [...(this.out.get(key) ?? []), edge]);
    }
  }

  get(ref: ResourceRef): Node | undefined {
    return this.nodes.get(resourceKey(ref));
  }

  find(
    name: string,
    filter: { systems?: string[]; role?: 'router' | 'store'; vhost?: string } = {},
  ): Node[] {
    return [...this.nodes.values()].filter(
      ({ resource, node }) =>
        resource.ref.id === name &&
        (!filter.systems || filter.systems.includes(node.system)) &&
        (!filter.role || node.role === filter.role) &&
        (!filter.vhost || (node.vhost ?? '/') === filter.vhost),
    );
  }

  has(systems: string[]): boolean {
    return [...this.nodes.values()].some(({ node }) => systems.includes(node.system));
  }

  get environment(): string | undefined {
    for (const { node } of this.nodes.values()) if (node.environment) return node.environment;

    return undefined;
  }
}

/** A message as the broker sees it. */
export interface DeliveryMessage {
  address: string;
  routingKey: string;
  headers: Record<string, HeaderValue>;
  body: JsonValue | undefined;
  source?: string | undefined;
  detailType?: string | undefined;
}

export interface DeliveryHop {
  ref: ResourceRef;
  /** What the node is to its broker: exchange, topic, bus, rule, queue, subscription. */
  entity?: string;
  /** How the message got here from the hop before. */
  via?: 'route' | 'alternate' | 'dead-letter';
  /** The rule that took it, as `currency = GBP`. */
  rule?: string;
  source?: SourceLocation;
}

const any = (results: Array<boolean | undefined>): boolean | undefined =>
  results.includes(true) ? true : results.includes(undefined) ? undefined : false;

const optionalString = z.string().optional().catch(undefined);

/** Whether one RabbitMQ binding takes the message, or undefined when it cannot be told. */
function bindingMatches(
  type: string,
  binding: DeliveryBinding,
  message: DeliveryMessage,
): boolean | undefined {
  if (type === 'fanout') return true;

  if (type === 'direct') return binding.routingKey === message.routingKey;

  if (type === 'topic') return topicMatches(binding.routingKey, message.routingKey);

  if (type !== 'headers') return undefined;

  const mode = optionalString.parse(binding.arguments['x-match']) ?? 'all';
  const withX = mode.endsWith('-with-x');

  const wanted = Object.entries(binding.arguments).filter(
    ([key]) => key !== 'x-match' && (withX || !key.startsWith('x-')),
  );

  if (wanted.some(([, value]) => !headerValue.safeParse(value).success)) return undefined;

  const hit = ([key, value]: [string, JsonValue]) =>
    key in message.headers && (value === '' || message.headers[key] === value);

  return mode.startsWith('any') ? wanted.some(hit) : wanted.every(hit);
}

/** A binding as a reader would write it: `currency = GBP`, `payment.*`, or `all messages`. */
export function describeBinding(type: string | undefined, binding: DeliveryBinding): string {
  if (type === 'headers') {
    const mode = optionalString.parse(binding.arguments['x-match']) ?? 'all';

    const parts = Object.entries(binding.arguments)
      .filter(([key]) => key !== 'x-match')
      .map(([key, value]) => `${key} = ${String(value)}`);

    return parts.length === 0
      ? 'all messages'
      : parts.join(mode.startsWith('any') ? ' or ' : ' and ');
  }

  if (type === 'fanout') return 'all messages';

  return `routing key ${binding.routingKey === '' ? '(empty)' : binding.routingKey}`;
}

/** One filter condition as words: `= GBP`, `> 0`, `starts with G`, `not EUR`, `present`. */
function describeCondition(condition: JsonValue): string {
  if (!isJsonObject(condition)) return `= ${String(condition)}`;

  const [operator] = Object.keys(condition);
  const operand = operator === undefined ? undefined : condition[operator];

  switch (operator) {
    case 'numeric':
      // [">", 0, "<=", 5] reads as "> 0 and <= 5".
      return Array.isArray(operand)
        ? operand
            .flatMap((part, i) =>
              i % 2 === 0 ? [`${String(part)} ${String(operand[i + 1])}`] : [],
            )
            .join(' and ')
        : JSON.stringify(condition);
    case 'prefix':
      return `starts with ${String(operand)}`;
    case 'suffix':
      return `ends with ${String(operand)}`;
    case 'anything-but':
      return `not ${Array.isArray(operand) ? operand.map(String).join(', ') : String(operand)}`;
    case 'exists':
      return operand === false ? 'absent' : 'present';
    case 'equals-ignore-case':
      return `= ${String(operand)} (any case)`;
    default:
      return JSON.stringify(condition);
  }
}

/** An SNS filter or EventBridge pattern in one line, as `currency = GBP and amount > 0`. */
function describePattern(pattern: JsonObject, prefix = ''): string {
  return Object.entries(pattern)
    .map(([key, rule]) => {
      if (key === '$or' && Array.isArray(rule))
        return `(${rule.map((alt) => (isJsonObject(alt) ? describePattern(alt, prefix) : '')).join(' or ')})`;

      const name = prefix ? `${prefix}.${key}` : key;

      if (isJsonObject(rule)) return describePattern(rule, name);

      if (!Array.isArray(rule)) return `${name} ${JSON.stringify(rule)}`;

      const plain = rule.every((value) => !isJsonObject(value));

      return plain && rule.length > 1
        ? `${name} in ${rule.map(String).join(', ')}`
        : `${name} ${rule.map(describeCondition).join(' or ')}`;
    })
    .join(' and ');
}

function correlationMatches(filter: JsonObject, message: DeliveryMessage): boolean | undefined {
  const results: Array<boolean | undefined> = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === 'properties') {
      for (const [name, wanted] of Object.entries(isJsonObject(value) ? value : {}))
        results.push(message.headers[name] === wanted);
    } else if (key === 'label' || key === 'subject') {
      results.push(message.routingKey === value);
    } else if (value !== null && value !== '') {
      // correlationId, messageId, to and the rest are set per message, not by the producer's transport.
      results.push(undefined);
    }
  }

  return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
}

/** Whether a route takes a message: undefined when it cannot be told. */
interface Acceptance {
  result: boolean | undefined;
  /** The rule that decided it, as a reader would write it. */
  rule?: string;
}

/** Whether a route takes the message, and the rule that decided it. */
function accepts(from: Node, route: RouteAttributes, message: DeliveryMessage): Acceptance {
  if (route.bindings) {
    const results = route.bindings.map((binding) => ({
      hit: bindingMatches(from.node.type ?? '', binding, message),
      binding,
    }));

    const shown = results.find((entry) => entry.hit === true) ?? results[0];

    return {
      result: any(results.map((entry) => entry.hit)),
      ...(shown && { rule: describeBinding(from.node.type, shown.binding) }),
    };
  }

  if (route.filter) {
    const target: JsonValue | undefined =
      route.filter.scope === 'attributes'
        ? message.headers
        : route.filter.scope === 'body'
          ? message.body
          : {
              ...(message.source !== undefined && { source: message.source }),
              ...(message.detailType !== undefined && { 'detail-type': message.detailType }),
              ...(message.body !== undefined && { detail: message.body }),
            };

    return {
      result: contentMatches(route.filter.pattern, target),
      rule: describePattern(route.filter.pattern),
    };
  }

  if (route.rules) {
    const properties = {
      ...message.headers,
      'sys.Label': message.routingKey,
      'sys.Subject': message.routingKey,
    };

    const results = route.rules.map((rule) => ({
      rule,
      hit: rule.correlation
        ? correlationMatches(rule.correlation, message)
        : sqlFilterMatches(rule.sql ?? '1=1', properties),
    }));

    const hit = results.find((entry) => entry.hit === true) ?? results[0];

    const shown = hit?.rule.correlation
      ? describePattern(hit.rule.correlation)
      : hit?.rule.sql === '1=1'
        ? 'all messages'
        : hit?.rule.sql;

    return { result: any(results.map((entry) => entry.hit)), ...(shown && { rule: shown }) };
  }

  return { result: true };
}

interface Blocked {
  from: ResourceRef;
  to: ResourceRef;
  access: 'denied' | 'missing';
  source?: SourceLocation;
}

interface Routed {
  stores: Map<string, DeliveryHop[]>;
  unknown: string[];
  /** Destinations a route names that the configuration does not declare. */
  missing: string[];
  /** Routes the message matched but the destination does not let through. */
  blocked: Blocked[];
  /** Routes taken, for their own failure handling. */
  taken: CatalogRelationship[];
}

function route(broker: Broker, message: DeliveryMessage, start: Node): Routed {
  const result: Routed = { stores: new Map(), unknown: [], missing: [], blocked: [], taken: [] };

  const visit = (current: Node, trail: DeliveryHop[], seen: Set<string>) => {
    if (seen.has(current.key)) return;

    seen.add(current.key);
    result.unknown.push(
      ...current.node.unevaluated.map((note) => `${named(current.resource.ref.id)}: ${note}`),
    );

    if (current.node.role === 'store') {
      if (!result.stores.has(current.key)) result.stores.set(current.key, trail);

      return;
    }

    let matched = false;

    for (const edge of broker.out.get(current.key) ?? []) {
      const attributes = routeOf(edge);

      if (attributes.alternate || attributes.disabled) continue;

      result.unknown.push(
        ...attributes.unevaluated.map(
          (note) => `${named(current.resource.ref.id)} → ${named(edge.to.id)}: ${note}`,
        ),
      );

      const { result: hit, rule } = accepts(current, attributes, message);

      if (hit === undefined) {
        result.unknown.push(
          `${named(current.resource.ref.id)} → ${named(edge.to.id)}: ${rule ? named(rule) : 'the rule'} is not evaluated`,
        );
        continue;
      }

      if (!hit) continue;

      matched = true;

      if (attributes.access === 'unknown') {
        result.unknown.push(
          `${named(current.resource.ref.id)} → ${named(edge.to.id)}: an access policy uses a condition or element that is not evaluated`,
        );
        continue;
      }

      if (attributes.access === 'denied' || attributes.access === 'missing') {
        result.blocked.push({
          from: edge.from,
          to: edge.to,
          access: attributes.access,
          ...(edge.source && { source: edge.source }),
        });
        continue;
      }

      const next = broker.get(edge.to);

      if (!next) continue;

      result.taken.push(edge);

      const line = attributes.bindings?.find((binding) => binding.line)?.line;

      visit(
        next,
        [
          ...trail,
          {
            ref: edge.to,
            entity: next.node.entity,
            via: 'route',
            ...(rule && { rule }),
            ...(edge.source && { source: line ? { ...edge.source, line } : edge.source }),
          },
        ],
        seen,
      );
    }

    // A RabbitMQ message no binding takes goes to the alternate exchange, if there is one.
    if (!matched && current.node.alternate) {
      const [alternate] = broker.find(current.node.alternate, {
        systems: [current.node.system],
        role: 'router',
        vhost: current.node.vhost ?? '/',
      });

      if (alternate)
        visit(
          alternate,
          [
            ...trail,
            { ref: alternate.resource.ref, entity: alternate.node.entity, via: 'alternate' },
          ],
          seen,
        );
      else result.missing.push(current.node.alternate);
    }
  };

  visit(start, [{ ref: start.resource.ref, entity: start.node.entity }], new Set());

  return result;
}

/** Whether any chain of routes joins two nodes at all, whatever the rules accept. */
function connected(broker: Broker, from: Node, to: Node): boolean {
  const stack = [from.key];
  const seen = new Set<string>();

  while (stack.length) {
    const key = stack.pop()!;

    if (key === to.key) return true;

    if (seen.has(key)) continue;

    seen.add(key);

    for (const edge of broker.out.get(key) ?? []) stack.push(resourceKey(edge.to));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Analysis

/**
 * How sure a finding is. `confirmed`: the configuration is wrong on its own
 * terms. `policy`: it misses something a consumer declared it needs.
 * `possible`: it may matter, and the catalog cannot say. `unknown`: part of the
 * route was not evaluated, so a clean result would mean nothing.
 */
export type DeliveryConfidence = 'confirmed' | 'policy' | 'possible' | 'unknown';

export interface DeliveryFinding {
  confidence: DeliveryConfidence;
  code:
    | 'destination_missing'
    | 'queue_missing'
    | 'no_route'
    | 'example_filtered'
    | 'delivery_blocked'
    | 'dead_letter_missing'
    | 'dead_letter_dropped'
    | 'dead_letter_mismatch'
    | 'shared_group'
    | 'no_group'
    | 'retention_short'
    | 'attempts_mismatch'
    | 'retries_exceed_window'
    | 'publish_denied'
    | 'consume_denied'
    | 'group_denied'
    | 'no_examples'
    | 'not_evaluated';
  /** `domain/id`. */
  event: string;
  consumer?: string;
  message: string;
  source?: SourceLocation;
}

export interface ExampleDelivery {
  name: string;
  /** The headers it carries, as the producer sets them from the payload. */
  headers: DeliveryMessage['headers'];
  /** Whether it reaches the consumer's store; undefined when that could not be evaluated. */
  reaches: boolean | undefined;
  /** Producer's destination → … → the consumer's store, when it reaches it. */
  path: DeliveryHop[];
}

export interface ConsumerDelivery {
  /** `domain/id`. */
  event: string;
  producers: string[];
  system: string;
  /** Where the producer publishes. */
  exchange: string;
  routingKey: string;
  consumer: string;
  /** The store the consumer reads. */
  queue: string;
  group?: string;
  examples: ExampleDelivery[];
  /** Where a message the consumer gives up on ends up. */
  deadLetter?: { exchange: string; queues: string[]; path: DeliveryHop[] };
  /** What the store promises, in words: retention, attempts, group. */
  facts: string[];
  /** The store's attempt limit, for verification. */
  maxAttempts?: number;
  /** The RabbitMQ vhost the route lives in, for verification. */
  vhost?: string;
}

export interface DeliveryReport {
  environment?: string;
  routes: ConsumerDelivery[];
  findings: DeliveryFinding[];
  /** False when anything on a route was not evaluated: no clean result is claimed. */
  complete: boolean;
}

function valueAt(data: JsonValue | undefined, dotted: string): JsonValue | undefined {
  let current: JsonValue | undefined = data;

  for (const part of dotted.split('.')) {
    if (!isJsonObject(current)) return undefined;

    current = current[part];
  }

  return current;
}

/** The headers a producer sets from one payload, from the fields its transport names. */
function headersOf(data: JsonValue | undefined, fields: string[] = []): DeliveryMessage['headers'] {
  const headers: DeliveryMessage['headers'] = {};

  for (const field of fields) {
    const value = headerValue.safeParse(valueAt(data, field));

    if (value.success) headers[field] = value.data;
  }

  return headers;
}

const systemsOf = (transport: DeliveryTransport): string[] => [
  ...new Set(transport.protocols.flatMap((protocol) => PROTOCOL_SYSTEMS.get(protocol) ?? [])),
];

export const shownHeaders = (headers: DeliveryMessage['headers']) =>
  Object.entries(headers)
    .map(([key, value]) => `${key} = ${String(value)}`)
    .join(', ');

/** What a store promises a consumer, in words, for the path's reader. */
function storeFacts(node: BrokerNode, group?: string): string[] {
  const facts: string[] = [];

  if (node.retentionSeconds !== undefined)
    facts.push(`keeps unread messages for ${durationWords(node.retentionSeconds)}`);
  else if (node.retentionUnbounded) facts.push('keeps messages until they are read');
  else if (node.retentionDefault) facts.push("keeps messages for the cluster's default retention");

  if (node.maxAttempts !== undefined)
    facts.push(
      `up to ${node.maxAttempts} deliveries${node.redeliveryDelaySeconds ? `, ${durationWords(node.redeliveryDelaySeconds)} apart` : ''}`,
    );
  else if (node.system === 'rabbitmq' || node.system === 'sqs')
    facts.push('redelivers a failed message without limit');

  if (node.idleExpirySeconds !== undefined)
    facts.push(`deleted after ${durationWords(node.idleExpirySeconds)} without a consumer`);

  if (node.maxLength !== undefined) facts.push(`holds at most ${node.maxLength} messages`);

  if (group) facts.push(`consumer group ${named(group)}`);

  return facts;
}

/**
 * Route every committed example of every event published to a broker read
 * here, to each consumer that says where it reads, and report what the
 * configuration gets wrong.
 */
export function analyzeDelivery(input: {
  graph: ResourceGraph;
  events: DeliveryEvent[];
  consumers: ConsumerDeclaration[];
}): DeliveryReport {
  const broker = new Broker(input.graph);
  const findings: DeliveryFinding[] = [];
  const routes: ConsumerDelivery[] = [];

  if (broker.nodes.size === 0) return { routes, findings, complete: true };

  for (const event of input.events) {
    for (const transport of event.transports)
      analyzeTransport(broker, event, transport, input.consumers, findings, routes);
  }

  const unique = dedupe(findings);

  return {
    ...(broker.environment && { environment: broker.environment }),
    routes,
    findings: unique,
    complete: !unique.some((finding) => finding.confidence === 'unknown'),
  };
}

function analyzeTransport(
  broker: Broker,
  event: DeliveryEvent,
  transport: DeliveryTransport,
  allConsumers: ConsumerDeclaration[],
  findings: DeliveryFinding[],
  routes: ConsumerDelivery[],
) {
  const name = event.event;
  const systems = systemsOf(transport);

  // An event bound for a broker this configuration does not describe is someone else's to check.
  if (!broker.has(systems)) return;

  const address =
    transport.address === '' && systems.includes('eventbridge') ? 'default' : transport.address;

  const starts = broker.find(address, { systems });

  if (starts.length !== 1) {
    findings.push(
      starts.length === 0
        ? {
            confidence: 'confirmed',
            code: 'destination_missing',
            event: name,
            message: `${named(name)} is published to ${named(address)}, which the broker configuration does not declare`,
          }
        : {
            confidence: 'unknown',
            code: 'not_evaluated',
            event: name,
            message: `${named(address)} is declared more than once, so the route of ${named(name)} is not evaluated`,
          },
    );

    return;
  }

  const start = starts[0]!;

  producerAccess(start, transport, event, findings);

  const consumers = allConsumers.filter(
    (consumer) => consumer.event === name && (consumer.queue || start.node.role === 'store'),
  );

  if (consumers.length > 0 && event.examples.length === 0)
    findings.push({
      confidence: 'unknown',
      code: 'no_examples',
      event: name,
      message: `${named(name)} has no committed example, so its filters were not checked against a real message`,
    });

  const readers = new Map<string, Array<{ service: string; group?: string }>>();

  for (const consumer of consumers) {
    const queueName = consumer.queue ?? start.resource.ref.id;
    const candidates = broker.find(queueName, { role: 'store' });
    const reachable = candidates.filter((candidate) => connected(broker, start, candidate));
    const pick = reachable.length > 0 ? reachable : candidates;

    if (pick.length !== 1) {
      findings.push({
        confidence: pick.length === 0 ? 'confirmed' : 'unknown',
        code: pick.length === 0 ? 'queue_missing' : 'not_evaluated',
        event: name,
        consumer: consumer.service,
        message:
          pick.length === 0
            ? `${named(consumer.service)} reads ${named(name)} from ${named(queueName)}, which the broker configuration does not declare`
            : `${named(queueName)} is declared more than once, so the route of ${named(consumer.service)} is not evaluated`,
      });
      continue;
    }

    const store = pick[0]!;

    readers.set(store.key, [
      ...(readers.get(store.key) ?? []),
      { service: consumer.service, ...(consumer.group && { group: consumer.group }) },
    ]);

    const reachableAtAll = connected(broker, start, store);

    if (!reachableAtAll)
      findings.push({
        confidence: 'confirmed',
        code: 'no_route',
        event: name,
        consumer: consumer.service,
        message: `${named(consumer.service)} declares that it consumes ${named(name)} from ${named(queueName)}, but nothing routes ${named(address)} to it`,
        ...(store.resource.source && { source: store.resource.source }),
      });

    const taken: CatalogRelationship[] = [];
    const deliveries: ExampleDelivery[] = [];

    for (const example of event.examples) {
      const headers = headersOf(example.data, transport.headers);

      const message: DeliveryMessage = {
        address,
        routingKey: transport.routingKey ?? '',
        headers,
        body: example.data,
        source: transport.source,
        detailType: transport.detailType,
      };

      const routed = route(broker, message, start);
      const path = routed.stores.get(store.key);

      taken.push(...routed.taken);

      for (const note of routed.unknown)
        findings.push({
          confidence: 'unknown',
          code: 'not_evaluated',
          event: name,
          consumer: consumer.service,
          message: note,
        });

      for (const blocked of routed.blocked)
        findings.push({
          confidence: blocked.access === 'denied' ? 'confirmed' : 'possible',
          code: 'delivery_blocked',
          event: name,
          consumer: consumer.service,
          message:
            blocked.access === 'denied'
              ? `the access policy of ${named(blocked.to.id)} does not let ${named(blocked.from.id)} deliver to it`
              : `no access policy read here lets ${named(blocked.from.id)} deliver to ${named(blocked.to.id)}, so it cannot deliver unless one is attached elsewhere`,
          ...(blocked.source && { source: blocked.source }),
        });

      const reaches = path ? true : routed.unknown.length ? undefined : false;

      if (reaches === false && reachableAtAll && routed.blocked.length === 0) {
        const shown = shownHeaders(headers);

        findings.push({
          confidence: 'possible',
          code: 'example_filtered',
          event: name,
          consumer: consumer.service,
          message: `the routes to ${named(queueName)} exclude the committed example ${named(example.name)}${shown ? ` (${named(shown)})` : ''}, so ${named(consumer.service)} would not receive it`,
          ...(store.resource.source && { source: store.resource.source }),
        });
      }

      deliveries.push({ name: example.name, headers, reaches, path: path ?? [] });
    }

    routeFailures(broker, taken, findings, name, consumer.service);

    const failure = deadLetterRoute(broker, store, event, transport, consumer, findings);

    storeNeeds(store, consumer, findings, name, taken);
    consumerAccess(store, consumer, findings, name);

    routes.push({
      event: name,
      producers: event.producers,
      system: start.node.system,
      exchange: address,
      routingKey: transport.routingKey ?? '',
      consumer: consumer.service,
      queue: queueName,
      ...(consumer.group && { group: consumer.group }),
      examples: deliveries,
      ...(failure && { deadLetter: failure }),
      facts: storeFacts(store.node, store.node.system === 'kafka' ? consumer.group : undefined),
      ...(store.node.maxAttempts !== undefined && { maxAttempts: store.node.maxAttempts }),
      ...(start.node.vhost && { vhost: start.node.vhost }),
    });
  }

  groupFindings(broker, readers, findings, name);
}

function producerAccess(
  start: Node,
  transport: DeliveryTransport,
  event: DeliveryEvent,
  findings: DeliveryFinding[],
) {
  const identity = transport.identity;

  if (!identity) return;

  const who = event.producers.map(named).join(', ') || 'the producer';
  const grants = start.node.grants;
  const where = `${start.node.entity} ${named(start.resource.ref.id)}`;

  if (!grants) {
    findings.push({
      confidence: 'unknown',
      code: 'not_evaluated',
      event: event.event,
      message: `the configuration read does not say who may publish to ${where}, so the access of ${who} is not evaluated`,
    });

    return;
  }

  if (grants.undecided?.publish.includes(identity)) {
    findings.push({
      confidence: 'unknown',
      code: 'not_evaluated',
      event: event.event,
      message: `whether ${who} may publish to ${where} as ${named(identity)} depends on a policy condition or resource that is not evaluated`,
      ...(start.resource.source && { source: start.resource.source }),
    });

    return;
  }

  if (!grants.publish.includes(identity)) {
    findings.push({
      confidence: grants.complete ? 'confirmed' : 'possible',
      code: 'publish_denied',
      event: event.event,
      message: grants.complete
        ? `${who} publishes as ${named(identity)}, which cannot publish to ${where}`
        : `${who} publishes as ${named(identity)}, and nothing read here lets it publish to ${where}`,
      ...(start.resource.source && { source: start.resource.source }),
    });

    return;
  }

  // RabbitMQ topic permissions narrow which routing keys a user may publish with.
  for (const permission of start.node.topicPermissions ?? []) {
    if (permission.user !== identity) continue;

    const allowed = rabbitPatternMatches(permission.write, transport.routingKey ?? '');

    if (allowed === false)
      findings.push({
        confidence: 'confirmed',
        code: 'publish_denied',
        event: event.event,
        message: `${who} publishes as ${named(identity)}, whose topic permission on ${where} does not cover routing key ${transport.routingKey ? named(transport.routingKey) : '(empty)'}`,
      });
    else if (allowed === undefined)
      findings.push({
        confidence: 'unknown',
        code: 'not_evaluated',
        event: event.event,
        message: `the topic permission of ${named(identity)} on ${where} uses a pattern that is not evaluated`,
      });
  }
}

function consumerAccess(
  store: Node,
  consumer: ConsumerDeclaration,
  findings: DeliveryFinding[],
  event: string,
) {
  const identity = consumer.identity;

  if (!identity) return;

  const grants = store.node.grants;
  const where = `${store.node.entity} ${named(store.resource.ref.id)}`;

  const base = {
    event,
    consumer: consumer.service,
    ...(store.resource.source && { source: store.resource.source }),
  };

  if (!grants) {
    findings.push({
      ...base,
      confidence: 'unknown',
      code: 'not_evaluated',
      message: `the configuration read does not say who may consume from ${where}, so the access of ${named(consumer.service)} is not evaluated`,
    });

    return;
  }

  if (grants.undecided?.consume.includes(identity))
    findings.push({
      ...base,
      confidence: 'unknown',
      code: 'not_evaluated',
      message: `whether ${named(consumer.service)} may consume from ${where} as ${named(identity)} depends on a policy condition or resource that is not evaluated`,
    });
  else if (!grants.consume.includes(identity))
    findings.push({
      ...base,
      confidence: grants.complete ? 'confirmed' : 'possible',
      code: 'consume_denied',
      message: grants.complete
        ? `${named(consumer.service)} consumes as ${named(identity)}, which cannot consume from ${where}`
        : `${named(consumer.service)} consumes as ${named(identity)}, and nothing read here lets it consume from ${where}`,
    });

  if (grants.groups && consumer.group) {
    const group = consumer.group;

    const allowed = (grants.groups[identity] ?? []).some((pattern) =>
      pattern.endsWith('*') ? group.startsWith(pattern.slice(0, -1)) : pattern === group,
    );

    if (!allowed)
      findings.push({
        ...base,
        confidence: grants.complete ? 'confirmed' : 'possible',
        code: 'group_denied',
        message: `${named(consumer.service)} consumes as ${named(identity)}, which may not join consumer group ${named(group)}`,
      });
  }
}

/** Retention, attempts and timing against what the consumer declared it needs. */
function storeNeeds(
  store: Node,
  consumer: ConsumerDeclaration,
  findings: DeliveryFinding[],
  event: string,
  taken: CatalogRelationship[],
) {
  const node = store.node;
  const name = store.resource.ref.id;

  const base = {
    event,
    consumer: consumer.service,
    ...(store.resource.source && { source: store.resource.source }),
  };

  const recovery = consumer.recovery ? durationSeconds(consumer.recovery) : undefined;

  if (recovery !== undefined) {
    if (node.retentionSeconds !== undefined && node.retentionSeconds < recovery)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'retention_short',
        message: `${named(name)} keeps unread messages for ${durationWords(node.retentionSeconds)}, shorter than the ${durationWords(recovery)} ${named(consumer.service)} declares it may be down`,
      });

    if (node.retentionDefault)
      findings.push({
        ...base,
        confidence: 'unknown',
        code: 'not_evaluated',
        message: `${named(name)} uses the cluster's default retention, so the ${durationWords(recovery)} recovery window of ${named(consumer.service)} is not checked`,
      });

    if (node.idleExpirySeconds !== undefined && node.idleExpirySeconds < recovery)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'retention_short',
        message: `${named(name)} is deleted after ${durationWords(node.idleExpirySeconds)} without a consumer, shorter than the ${durationWords(recovery)} ${named(consumer.service)} declares it may be down`,
      });

    if (node.maxLength !== undefined)
      findings.push({
        ...base,
        confidence: 'possible',
        code: 'retention_short',
        message: `${named(name)} holds at most ${node.maxLength} messages, so a backlog longer than that while ${named(consumer.service)} is down is lost`,
      });
  }

  const expected = consumer.deadLetter?.maxAttempts;

  if (expected !== undefined) {
    if (node.maxAttempts === undefined && (node.system === 'rabbitmq' || node.system === 'sqs'))
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'attempts_mismatch',
        message: `${named(name)} redelivers a failed message without limit, so the ${expected} attempts ${named(consumer.service)} expects are not enforced`,
      });
    else if (node.maxAttempts !== undefined && node.maxAttempts !== expected)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'attempts_mismatch',
        message: `${named(consumer.service)} expects to give up after ${expected} attempts, but ${named(name)} delivers up to ${node.maxAttempts} times`,
      });
  }

  const window = consumer.processingWindow ? durationSeconds(consumer.processingWindow) : undefined;

  if (window === undefined) return;

  if (node.maxAttempts !== undefined && node.redeliveryDelaySeconds) {
    const worst = node.maxAttempts * node.redeliveryDelaySeconds;

    if (worst > window)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'retries_exceed_window',
        message: `a failing message on ${named(name)} can be retried for up to ${durationWords(worst)} (${node.maxAttempts} attempts, ${durationWords(node.redeliveryDelaySeconds)} apart), longer than the ${durationWords(window)} ${named(consumer.service)} declares`,
      });
  }

  for (const edge of taken) {
    const age = routeOf(edge).maxAgeSeconds;

    if (age !== undefined && age > window)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'retries_exceed_window',
        message: `${named(edge.from.id)} retries delivery to ${named(edge.to.id)} for up to ${durationWords(age)}, longer than the ${durationWords(window)} ${named(consumer.service)} declares`,
        ...(edge.source && { source: edge.source }),
      });
  }
}

/** A route's own failure destination, such as an SNS subscription's or an EventBridge target's. */
function routeFailures(
  broker: Broker,
  taken: CatalogRelationship[],
  findings: DeliveryFinding[],
  event: string,
  consumer: string,
) {
  for (const edge of taken) {
    const target = routeOf(edge).deadLetter;

    if (target === undefined) continue;

    if (broker.find(target, { role: 'store' }).length > 0) continue;

    const unresolved = target === '(not resolved)';

    findings.push({
      confidence: unresolved ? 'unknown' : 'confirmed',
      code: unresolved ? 'not_evaluated' : 'dead_letter_missing',
      event,
      consumer,
      message: unresolved
        ? `${named(edge.from.id)} → ${named(edge.to.id)}: its dead-letter queue is not resolved`
        : `${named(edge.from.id)} → ${named(edge.to.id)} puts undeliverable messages in ${named(target)}, which the configuration does not declare`,
      ...(edge.source && { source: edge.source }),
    });
  }
}

function deadLetterRoute(
  broker: Broker,
  store: Node,
  event: DeliveryEvent,
  transport: DeliveryTransport,
  consumer: ConsumerDeclaration,
  findings: DeliveryFinding[],
): ConsumerDelivery['deadLetter'] {
  const declared = consumer.deadLetter?.queue;
  const dl = store.node.deadLetter;
  const name = store.resource.ref.id;

  const base = {
    event: event.event,
    consumer: consumer.service,
    ...(store.resource.source && { source: store.resource.source }),
  };

  if (!dl) {
    if (declared)
      findings.push({
        ...base,
        confidence: 'policy',
        code: 'dead_letter_mismatch',
        message: `${named(consumer.service)} expects rejected messages in ${named(declared)}, but ${named(name)} has no dead-letter destination`,
      });

    return undefined;
  }

  const [target] = broker.find(dl.target, {
    systems: [store.node.system],
    vhost: store.node.vhost ?? '/',
  });

  if (!target) {
    findings.push({
      ...base,
      confidence: 'confirmed',
      code: 'dead_letter_missing',
      message: `${named(name)} dead-letters to ${named(dl.target)}, which the broker configuration does not declare`,
    });

    return { exchange: dl.target, queues: [], path: [] };
  }

  let queues: string[];
  let trail: DeliveryHop[];

  if (target.node.role === 'store') {
    queues = [target.resource.ref.id];
    trail = [{ ref: target.resource.ref, entity: target.node.entity, via: 'dead-letter' }];
  } else {
    const example = event.examples[0]?.data;

    const routed = route(
      broker,
      {
        address: dl.target,
        routingKey: dl.routingKey ?? transport.routingKey ?? '',
        headers: headersOf(example, transport.headers),
        body: example,
      },
      target,
    );

    queues = [...routed.stores.values()].map((hops) => hops.at(-1)!.ref.id).sort();
    trail = [...routed.stores.values()][0] ?? [];

    if (queues.length === 0 && routed.unknown.length === 0)
      findings.push({
        ...base,
        confidence: 'confirmed',
        code: 'dead_letter_dropped',
        message: `${named(name)} dead-letters to ${named(dl.target)}, which routes nowhere, so a rejected message is dropped`,
      });
  }

  if (declared && queues.length > 0 && !queues.includes(declared))
    findings.push({
      ...base,
      confidence: 'policy',
      code: 'dead_letter_mismatch',
      message: `${named(consumer.service)} expects rejected messages in ${named(declared)}, but ${named(name)} dead-letters to ${queues.map(named).join(', ')}`,
    });

  return { exchange: dl.target, queues, path: trail };
}

/**
 * Two services reading one queue, or one Kafka consumer group, share its
 * messages: each gets some of them. Independent consumers need their own.
 */
function groupFindings(
  broker: Broker,
  readers: Map<string, Array<{ service: string; group?: string }>>,
  findings: DeliveryFinding[],
  event: string,
) {
  for (const [key, list] of readers) {
    const store = broker.nodes.get(key)!;
    const name = store.resource.ref.id;
    const kafka = store.node.system === 'kafka';
    const byGroup = new Map<string, Set<string>>();

    for (const reader of list) {
      if (kafka && !reader.group) {
        findings.push({
          confidence: 'unknown',
          code: 'no_group',
          event,
          consumer: reader.service,
          message: `${named(reader.service)} declares no consumer group for topic ${named(name)}, so whether it gets every message is not evaluated`,
        });
        continue;
      }

      const group = kafka ? reader.group! : name;

      byGroup.set(group, new Set([...(byGroup.get(group) ?? []), reader.service]));
    }

    for (const [group, services] of byGroup) {
      if (services.size < 2) continue;

      const names = [...services].sort();

      findings.push({
        confidence: 'confirmed',
        code: 'shared_group',
        event,
        consumer: names[0]!,
        message: kafka
          ? `${names.map(named).join(' and ')} all join consumer group ${named(group)} on ${named(name)}, so each receives only some of the messages; give each its own group`
          : `${names.map(named).join(' and ')} all read ${named(name)}, so each receives only some of the messages; give each its own queue`,
        ...(store.resource.source && { source: store.resource.source }),
      });
    }
  }
}

const findingKey = (f: DeliveryFinding) =>
  `${f.code}\0${f.event}\0${f.consumer ?? ''}\0${f.message}`;

function dedupe(findings: DeliveryFinding[]): DeliveryFinding[] {
  return [...new Map(findings.map((finding) => [findingKey(finding), finding])).values()];
}

// ---------------------------------------------------------------------------
// Inputs, from one repository or the company's composed graph

/** The events in a loaded catalog that delivery can route. */
export function deliveryEvents(events: LoadedEvent[]): DeliveryEvent[] {
  return events.flatMap((event) => {
    if (event.folder.isVersioned) return [];

    const delivery = deliveryEventOf(event);

    return delivery ? [delivery] : [];
  });
}

const eventDelivery = z.object({ delivery: deliveryEvent });

/** The events a composed graph carries delivery inputs for, from every repository. */
export function deliveryEventsFromGraph(graph: ResourceGraph): DeliveryEvent[] {
  return graph.resources.flatMap((resource) => {
    if (resource.ref.kind !== 'event') return [];

    const parsed = eventDelivery.safeParse(resource.attributes);

    // The event's name heads each finding, as consumers' names are checked.
    return parsed.success && isSafeName(parsed.data.delivery.event) ? [parsed.data.delivery] : [];
  });
}

const eventDomain = z.object({ domain: z.string() }).catch({ domain: '' });

const edgeDeadLetter = z
  .object({
    deadLetter: z
      .object({
        queue: z.string().refine(isSafeName),
        maxAttempts: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .catch({});

/** Consumers that declared where they read, from the composed graph's `consumes` edges. */
export function deliveryConsumersFromGraph(graph: ResourceGraph): ConsumerDeclaration[] {
  const domains = new Map(
    graph.resources
      .filter((resource) => resource.ref.kind === 'event')
      .map((resource) => [
        resourceKey(resource.ref),
        eventDomain.parse(resource.attributes).domain,
      ]),
  );

  return graph.relationships.flatMap((edge) => {
    if (edge.type !== 'consumes' || edge.from.kind !== 'event') return [];

    const needs = deliveryNeedsOf(edge);

    if (!needs) return [];

    const domain =
      domains.get(resourceKey(edge.from)) || (edge.from.namespace?.split('/').at(-1) ?? '');

    const { deadLetter } = edgeDeadLetter.parse(edge.attributes);
    const event = `${domain}/${edge.from.id}`;

    // Names from another site's index land in pull-request Markdown: one not
    // safe to print is counted under a placeholder, so the gate still fires.
    if (!isSafeName(event)) return [];

    return [
      {
        service: isSafeName(edge.to.id) ? edge.to.id : UNSAFE_CONSUMER,
        event,
        ...needs,
        ...(deadLetter && { deadLetter }),
      },
    ];
  });
}

export interface DeliveryInputs {
  graph: ResourceGraph;
  events: DeliveryEvent[];
  consumers: ConsumerDeclaration[];
}

/** The company's inputs, read from its composed graph (the site's `/catalog.json`). */
export function companyDeliveryInputs(graph: ResourceGraph): DeliveryInputs {
  return {
    graph,
    events: deliveryEventsFromGraph(graph),
    consumers: deliveryConsumersFromGraph(graph),
  };
}

const isBrokerEdge = (edge: CatalogRelationship) =>
  edge.type === 'routesTo' || edge.type === 'deadLettersTo';

const isBrokerNode = (resource: CatalogResource) => nodeOf(resource) !== undefined;

/**
 * One side of a change laid over the company's delivery inputs, so a route
 * split across repositories is checked whole: this repository's broker
 * configuration, events and consumers replace what the company has for them,
 * on both sides, and everything else comes from the company.
 */
export function overlayDelivery(
  company: DeliveryInputs,
  side: DeliveryInputs,
  other: DeliveryInputs,
): DeliveryInputs {
  const local = [side, other];

  const nodes = new Set(
    local.flatMap((inputs) =>
      inputs.graph.resources.filter(isBrokerNode).map((resource) => resourceKey(resource.ref)),
    ),
  );

  const edges = new Set(
    local.flatMap((inputs) => inputs.graph.relationships.filter(isBrokerEdge).map(relationshipKey)),
  );

  const events = new Set(local.flatMap((inputs) => inputs.events.map((event) => event.event)));

  const consumers = new Set(
    local.flatMap((inputs) => inputs.consumers.map((c) => `${c.service}\0${c.event}`)),
  );

  return {
    graph: {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [
        ...company.graph.resources.filter(
          (resource) => isBrokerNode(resource) && !nodes.has(resourceKey(resource.ref)),
        ),
        ...side.graph.resources.filter(isBrokerNode),
      ],
      relationships: [
        ...company.graph.relationships.filter(
          (edge) => isBrokerEdge(edge) && !edges.has(relationshipKey(edge)),
        ),
        ...side.graph.relationships.filter(isBrokerEdge),
      ],
    },
    events: [...company.events.filter((event) => !events.has(event.event)), ...side.events],
    consumers: [
      ...company.consumers.filter((c) => !consumers.has(`${c.service}\0${c.event}`)),
      ...side.consumers,
    ],
  };
}

// ---------------------------------------------------------------------------
// Drift

const ruleOf = (delivery: ExampleDelivery | undefined): string | undefined =>
  [...(delivery?.path ?? [])].reverse().find((hop) => hop.via === 'route')?.rule;

/**
 * What a change does to delivery: a committed example that reached a consumer
 * and no longer would, a configuration problem the change introduces, and
 * anything it leaves unevaluated, so an incomplete check never reads as a pass.
 */
export function driftDelivery(base: DeliveryReport, current: DeliveryReport): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const where = current.environment ?? base.environment;
  const env = where ? ` in ${named(where)}` : '';

  for (const before of base.routes) {
    const after = current.routes.find(
      (r) => r.event === before.event && r.consumer === before.consumer,
    );

    for (const example of before.examples) {
      if (!example.reaches) continue;

      // By name, or by what it carries when the change renames it. With no
      // match, the route is lost when no example on it still arrives.
      const now =
        after?.examples.find((e) => e.name === example.name) ??
        after?.examples.find((e) => isDeepStrictEqual(e.headers, example.headers));

      const arrives = now
        ? now.reaches !== false
        : !after || after.examples.length === 0 || after.examples.some((e) => e.reaches !== false);

      // Arrived before and can no longer be evaluated: the change made it
      // unknown, so it is not passed as if it still arrives.
      if (after && now && now.reaches === undefined) {
        const [domain = '', id = ''] = before.event.split('/');

        findings.push({
          domain,
          eventId: id,
          severity: 'suspicious',
          kind: 'delivery_unknown',
          message: `delivery to ${named(before.queue)}${env} can no longer be evaluated: the committed example ${named(example.name)} reached ${named(before.consumer)} before this change`,
          consumers: [before.consumer],
          advice: `Check the route by hand, or with ac delivery verify, before merging`,
        });
        continue;
      }

      if (after && arrives) continue;

      const [domain = '', id = ''] = before.event.split('/');
      const shown = shownHeaders(example.headers);
      const previously = ruleOf(example);

      const rule = current.routes
        .filter((r) => r.queue === before.queue)
        .flatMap((r) => r.examples)
        .map(ruleOf)
        .find(Boolean);

      const proposed = !after ? 'the route is gone' : rule ? named(rule) : 'no route that takes it';

      findings.push({
        domain,
        eventId: id,
        severity: 'breaking',
        kind: 'delivery_route_lost',
        message: `delivery to ${named(before.queue)}${env} changed: previously ${previously ? named(previously) : 'routed'}, proposed ${proposed}. The committed example ${named(example.name)}${shown ? ` (${named(shown)})` : ''} would no longer reach ${named(before.consumer)}`,
        consumers: [before.consumer],
        advice: `Restore the route, or agree the change with the owner of ${named(before.consumer)} first`,
      });
    }
  }

  const known = new Set(base.findings.map(findingKey));

  for (const finding of current.findings) {
    if (known.has(findingKey(finding))) continue;

    // A filtered example is reported above when it used to arrive; one that
    // never did is not this change's doing.
    if (finding.code === 'example_filtered') continue;

    const [domain = '', id = ''] = finding.event.split('/');
    const unknown = finding.confidence === 'unknown';

    findings.push({
      domain,
      eventId: id,
      severity: unknown ? 'info' : finding.confidence === 'possible' ? 'suspicious' : 'breaking',
      kind: unknown ? 'delivery_unknown' : 'delivery_misconfigured',
      message: `${finding.message}${env}${unknown ? ' (delivery not fully evaluated)' : ''}`,
      consumers: finding.consumer ? [finding.consumer] : [],
    });
  }

  return findings;
}
