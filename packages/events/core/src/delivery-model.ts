import { z } from 'zod';
import type { SourceLocation } from './adapter-event';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from './json';
import type { CatalogRelationship, CatalogResource, ResourceRef } from './resource-graph';

/**
 * The shape every broker's configuration is read into. A broker's exchanges,
 * topics, buses, queues and subscriptions are `queue` resources: a *router*
 * passes a message on along `routesTo` edges, a *store* holds it for the
 * consumer that reads it. What a consumer can rely on (retention, attempts,
 * where failures go, who may publish and consume) sits on the store.
 */
export type BrokerSystem = 'rabbitmq' | 'sns' | 'sqs' | 'eventbridge' | 'kafka' | 'servicebus';

/** Who may publish to or consume from a node, by identity name. */
const grants = z.object({
  publish: z.array(z.string()).default([]),
  consume: z.array(z.string()).default([]),
  /** Consumer groups each identity may join, for brokers with groups. Prefixes end in `*`. */
  groups: z.record(z.string(), z.array(z.string())).optional(),
  /** Identities whose access a statement not evaluated could change: neither granted nor denied. */
  undecided: z
    .object({ publish: z.array(z.string()).default([]), consume: z.array(z.string()).default([]) })
    .optional(),
  /**
   * Whether the configuration read says everything about access to this node.
   * When it does not (IAM policies outside the template, a pattern not
   * evaluated), a missing grant is a possibility, not a fact.
   */
  complete: z.boolean(),
});

/**
 * A note on what was not evaluated, as a graph carries it. Another site's
 * graph can carry any text, and a note lands in pull-request Markdown: one
 * that could open a link, mention, tag or new line anywhere in it, code spans
 * included, is replaced. The node or route stays not evaluated either way.
 */
const unevaluatedNote = z
  .string()
  .transform((note) =>
    /[\r\n[\]@<]|https?:|www\./i.test(note) ? 'a rule here is not evaluated' : note,
  );

export const brokerNode = z.object({
  system: z.string(),
  // A kind such as `queue` or `topic`, printed beside the name.
  entity: z
    .string()
    .regex(/^[a-z][a-z-]*$/)
    .catch('node'),
  role: z.enum(['router', 'store']),
  /** A RabbitMQ exchange's type. */
  type: z.string().optional(),
  vhost: z.string().optional(),
  environment: z.string().optional(),
  /** Where a RabbitMQ exchange sends what no binding takes. */
  alternate: z.string().optional(),
  /** Where a store puts a message a consumer gives up on, by node name. */
  deadLetter: z.object({ target: z.string(), routingKey: z.string().optional() }).optional(),
  /** Deliveries before the store dead-letters or drops a message; absent when unlimited. */
  maxAttempts: z.number().optional(),
  /** How long before a failed delivery is tried again. */
  redeliveryDelaySeconds: z.number().optional(),
  /** How long an unread message is kept; absent with `retentionUnbounded` when kept until read. */
  retentionSeconds: z.number().optional(),
  retentionUnbounded: z.boolean().optional(),
  /** Retention is the cluster's default, which the configuration read does not say. */
  retentionDefault: z.boolean().optional(),
  /** A queue deleted after this long without a consumer. */
  idleExpirySeconds: z.number().optional(),
  /** Messages beyond this many are dropped or rejected. */
  maxLength: z.number().optional(),
  grants: grants.optional(),
  /** RabbitMQ topic permissions on an exchange: the routing keys each user may publish with. */
  topicPermissions: z.array(z.object({ user: z.string(), write: z.string() })).optional(),
  unevaluated: z.array(unevaluatedNote).default([]),
});

export type BrokerNode = z.infer<typeof brokerNode>;

const binding = z.object({
  routingKey: z.string(),
  arguments: z.record(z.string(), jsonValueSchema),
  line: z.number().optional(),
});

export type DeliveryBinding = z.infer<typeof binding>;

/** A Service Bus subscription rule: one that matches gives the subscription a copy. */
const serviceBusRule = z.object({
  name: z.string(),
  sql: z.string().optional(),
  correlation: z.record(z.string(), jsonValueSchema).optional(),
});

export type ServiceBusRule = z.infer<typeof serviceBusRule>;

export const routeAttributes = z.object({
  /** RabbitMQ bindings between the two ends. */
  bindings: z.array(binding).optional(),
  /** An SNS filter policy or EventBridge event pattern, and what it reads. */
  filter: z
    .object({ scope: z.enum(['attributes', 'body', 'event']), pattern: jsonObjectSchema })
    .optional(),
  /** Service Bus subscription rules. */
  rules: z.array(serviceBusRule).optional(),
  /** RabbitMQ's alternate exchange: taken only when nothing else matched. */
  alternate: z.boolean().optional(),
  /** An EventBridge rule switched off. */
  disabled: z.boolean().optional(),
  /**
   * Whether the destination lets the source deliver to it: `granted`,
   * `denied` by a policy that names other sources, or `missing` when no
   * policy read here allows it, or `unknown` when a policy uses something not
   * evaluated. Absent when the broker needs none.
   */
  access: z.enum(['granted', 'denied', 'missing', 'unknown']).optional(),
  /** Where the source puts a message it cannot deliver. */
  deadLetter: z.string().optional(),
  maxAttempts: z.number().optional(),
  maxAgeSeconds: z.number().optional(),
  environment: z.string().optional(),
  unevaluated: z.array(unevaluatedNote).default([]),
});

export type RouteAttributes = z.infer<typeof routeAttributes>;

/** A node's attributes, or undefined for a resource that is not a broker node. */
export function nodeOf(resource: CatalogResource): BrokerNode | undefined {
  if (resource.ref.kind !== 'queue') return undefined;

  const parsed = brokerNode.safeParse(resource.attributes);

  return parsed.success ? parsed.data : undefined;
}

export function routeOf(edge: CatalogRelationship): RouteAttributes {
  return routeAttributes.catch({ unevaluated: [] }).parse(edge.attributes ?? {});
}

/** The bindings a `routesTo` edge carries. */
export const edgeBindings = (edge: CatalogRelationship): DeliveryBinding[] =>
  routeOf(edge).bindings ?? [];

/** Drop the keys a reader left undefined, so attributes stay JSON. */
function json(value: z.input<typeof brokerNode> | z.input<typeof routeAttributes>): JsonObject {
  return jsonObjectSchema.parse(JSON.parse(JSON.stringify(value)));
}

export function brokerResource(
  ref: ResourceRef<'queue'>,
  source: SourceLocation | undefined,
  node: z.input<typeof brokerNode>,
): CatalogResource {
  return {
    ref,
    title: ref.id,
    tags: [],
    provenance: { default: 'extracted', fields: {} },
    needsReview: false,
    ...(source && { source }),
    attributes: json(node),
  };
}

export function routeEdge(
  from: ResourceRef,
  to: ResourceRef,
  source: SourceLocation | undefined,
  attributes: z.input<typeof routeAttributes>,
): CatalogRelationship {
  return {
    type: 'routesTo',
    from,
    to,
    provenance: 'extracted',
    needsReview: false,
    ...(source && { source }),
    attributes: json(attributes),
  };
}

export function deadLetterEdge(
  from: ResourceRef,
  to: ResourceRef,
  source: SourceLocation | undefined,
  attributes: JsonObject = {},
): CatalogRelationship {
  return {
    type: 'deadLettersTo',
    from,
    to,
    provenance: 'extracted',
    needsReview: false,
    ...(source && { source }),
    attributes,
  };
}

/** `queue` resource identity for a broker node: the namespace names the system and entity. */
export const nodeRef = (namespace: string, id: string): ResourceRef<'queue'> => ({
  kind: 'queue',
  namespace,
  id,
});

/** Transport protocols and the systems a destination of that name may live in. */
export const PROTOCOL_SYSTEMS = new Map<string, readonly BrokerSystem[]>([
  ['amqp', ['rabbitmq', 'servicebus']],
  ['rabbitmq', ['rabbitmq']],
  ['kafka', ['kafka']],
  ['sns', ['sns']],
  ['sqs', ['sqs']],
  ['eventbridge', ['eventbridge']],
  ['servicebus', ['servicebus']],
]);

/** Seconds as a reader says them: `90 seconds`, `4 hours`, `7 days`. */
export function durationWords(seconds: number): string {
  const units: Array<[number, string]> = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];

  for (const [size, unit] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;

      return `${count} ${unit}${count === 1 ? '' : 's'}`;
    }
  }

  return `${seconds} seconds`;
}

/** How an event is published, as delivery reads it from the event's `transport`. */
export const deliveryTransport = z.object({
  address: z.string(),
  protocols: z.array(z.string()).default([]),
  routingKey: z.string().optional(),
  headers: z.array(z.string()).optional(),
  identity: z.string().optional(),
  source: z.string().optional(),
  detailType: z.string().optional(),
});

export type DeliveryTransport = z.infer<typeof deliveryTransport>;

/** What delivery needs to know about an event, from its manifest or its resource on the composed graph. */
export const deliveryEvent = z.object({
  /** `domain/id`. */
  event: z.string(),
  producers: z.array(z.string()).default([]),
  transports: z.array(deliveryTransport),
  /** Committed examples only: a generated one is a guess at the shape, not a real message. */
  examples: z.array(z.object({ name: z.string(), data: jsonValueSchema })).default([]),
});

export type DeliveryEvent = z.infer<typeof deliveryEvent>;

/** Whether a transport names a broker delivery can read. */
export const isDeliveryTransport = (transport: { address?: string; protocols?: string[] }) =>
  transport.address !== undefined &&
  (transport.protocols ?? []).some((protocol) => PROTOCOL_SYSTEMS.has(protocol));

/** An event's delivery inputs, or undefined when none of its transports names a broker. */
export function deliveryEventOf(event: {
  frontmatter: {
    domain: string;
    id: string;
    producers?: string[];
    transport?: Array<{ address?: string; protocols: string[] }>;
    provenance?: { fields?: Record<string, string> };
  };
  examples: Array<{ name: string; data: JsonValue }>;
}): DeliveryEvent | undefined {
  const fm = event.frontmatter;

  const transports = (fm.transport ?? []).flatMap((transport) => {
    const parsed = deliveryTransport.safeParse(transport);

    return parsed.success && isDeliveryTransport(parsed.data) ? [parsed.data] : [];
  });

  if (transports.length === 0) return undefined;

  return {
    event: `${fm.domain}/${fm.id}`,
    producers: fm.producers ?? [],
    transports,
    examples:
      fm.provenance?.fields?.examples === 'inferred'
        ? []
        : event.examples.map(({ name, data }) => ({ name, data })),
  };
}

/**
 * A name in a finding as a code span: whatever a team named a queue or rule,
 * it reads as written and cannot become a link, mention, tag or new line where
 * the finding is printed. The fence outruns any backticks inside it.
 */
export function named(name: string): string {
  const flat = name.replace(/[\r\n]+/g, ' ');
  const longest = Math.max(0, ...[...flat.matchAll(/`+/g)].map(([run]) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${flat}${pad}${fence}`;
}
