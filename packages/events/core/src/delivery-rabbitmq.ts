import { z } from 'zod';
import type { SourceLocation } from './adapter-event';
import { rabbitPatternMatches } from './delivery-match';
import {
  brokerResource,
  deadLetterEdge,
  named,
  nodeRef,
  routeEdge,
  type BrokerNode,
  type DeliveryBinding,
} from './delivery-model';
import { isJsonObject, jsonValueSchema, type JsonValue } from './json';
import { emptyResourceGraph } from './architecture';
import type { ResourceGraph, ResourceRef } from './resource-graph';
import { resourceKey } from './resource-graph';
import { sourceLines } from './source-lines';

const args = z.record(z.string(), jsonValueSchema).default({});

const optionalString = z.string().optional().catch(undefined);

const optionalNumber = z.number().optional().catch(undefined);

const definitionsFile = z.object({
  exchanges: z
    .array(
      z.object({
        name: z.string(),
        vhost: z.string().default('/'),
        type: z.string(),
        arguments: args,
      }),
    )
    .default([]),
  queues: z
    .array(z.object({ name: z.string(), vhost: z.string().default('/'), arguments: args }))
    .default([]),
  bindings: z
    .array(
      z.object({
        source: z.string(),
        vhost: z.string().default('/'),
        destination: z.string(),
        destination_type: z.enum(['queue', 'exchange']),
        routing_key: z.string().default(''),
        arguments: args,
      }),
    )
    .default([]),
  policies: z
    .array(
      z.object({
        name: z.string(),
        vhost: z.string().default('/'),
        pattern: z.string(),
        'apply-to': z.string().default('all'),
        priority: z.number().default(0),
        definition: args,
      }),
    )
    .default([]),
  operator_policies: z
    .array(
      z.object({
        name: z.string(),
        vhost: z.string().default('/'),
        pattern: z.string(),
        'apply-to': z.string().default('queues'),
        priority: z.number().default(0),
        definition: args,
      }),
    )
    .default([]),
  users: z.array(z.object({ name: z.string() })).optional(),
  permissions: z
    .array(
      z.object({
        user: z.string(),
        vhost: z.string().default('/'),
        configure: z.string().default(''),
        write: z.string().default(''),
        read: z.string().default(''),
      }),
    )
    .optional(),
  topic_permissions: z
    .array(
      z.object({
        user: z.string(),
        vhost: z.string().default('/'),
        exchange: z.string(),
        write: z.string().default(''),
        read: z.string().default(''),
      }),
    )
    .default([]),
});

export type RabbitMqDefinitions = z.infer<typeof definitionsFile>;

/** A definitions file names the broker it was exported from; a bare `{queues: []}` is not one. */
export const looksLikeRabbitMqDefinitions = (value: JsonValue): boolean =>
  isJsonObject(value) &&
  ('rabbit_version' in value || 'rabbitmq_version' in value || Array.isArray(value.bindings)) &&
  (Array.isArray(value.queues) || Array.isArray(value.exchanges));

export const RABBITMQ = 'rabbitmq';

/**
 * The namespace of a vhost's queues (`rabbitmq`) or exchanges
 * (`rabbitmq-exchange`), with the vhost appended when it is not the default.
 * Exchanges get their own: an exchange and a queue often share a name.
 */
export const rabbitNamespace = (vhost: string, entity: 'exchange' | 'queue' = 'queue'): string => {
  const system = entity === 'exchange' ? `${RABBITMQ}-exchange` : RABBITMQ;

  return vhost === '/' ? system : `${system}${vhost.startsWith('/') ? '' : '/'}${vhost}`;
};

/** RabbitMQ 4 gives a quorum queue this delivery limit when none is set. */
const QUORUM_DELIVERY_LIMIT = 20;

type Policy = RabbitMqDefinitions['policies'][number];

/** The policy that applies, or why which one applies is not known. */
interface PolicyLookup {
  policy?: Policy;
  unknown?: string;
}

/** Who may publish and consume, with what was left unevaluated. */
interface GrantLookup {
  grants?: BrokerNode['grants'];
  notes: string[];
}

/**
 * The policy RabbitMQ applies to a queue or exchange: the highest priority one
 * whose pattern matches. A pattern not evaluated, or a tie, leaves it unknown.
 */
function effectivePolicy(
  policies: Policy[],
  entity: 'queues' | 'exchanges',
  vhost: string,
  name: string,
): PolicyLookup {
  const candidates: Policy[] = [];

  for (const policy of policies) {
    if (policy.vhost !== vhost) continue;

    const applyTo = policy['apply-to'];

    if (
      applyTo !== 'all' &&
      applyTo !== entity &&
      !(entity === 'queues' && applyTo.endsWith('queues'))
    )
      continue;

    const matches = rabbitPatternMatches(policy.pattern, name);

    if (matches === undefined)
      return {
        unknown: `policy ${named(policy.name)} uses a pattern that is not evaluated (${named(policy.pattern)})`,
      };

    if (matches) candidates.push(policy);
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const [top, next] = candidates;

  if (top && next && top.priority === next.priority)
    return {
      unknown: `policies ${named(top.name)} and ${named(next.name)} match with the same priority`,
    };

  return top ? { policy: top } : {};
}

/** The lower of two limits, as RabbitMQ applies an operator policy beside the queue's own. */
const lower = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

/** Who may publish to an exchange and consume from a queue, from users and their permissions. */
function grantsFor(
  defs: RabbitMqDefinitions,
  vhost: string,
  name: string,
  entity: 'exchange' | 'queue',
): GrantLookup {
  if (!defs.permissions) return { notes: [] };

  const notes: string[] = [];
  const publish: string[] = [];
  const consume: string[] = [];

  for (const permission of defs.permissions) {
    if (permission.vhost !== vhost) continue;

    const pattern = entity === 'exchange' ? permission.write : permission.read;

    // `{username}` and friends are expanded per connection; not evaluated here.
    if (pattern.includes('{')) {
      notes.push(`permissions for ${named(permission.user)} use a variable that is not evaluated`);
      continue;
    }

    const allowed = rabbitPatternMatches(pattern, name);

    if (allowed === undefined) {
      notes.push(
        `permissions for ${named(permission.user)} use a pattern that is not evaluated (${named(pattern)})`,
      );
      continue;
    }

    if (allowed) (entity === 'exchange' ? publish : consume).push(permission.user);
  }

  return {
    grants: { publish: publish.sort(), consume: consume.sort(), complete: notes.length === 0 },
    notes,
  };
}

/** The exchanges, queues and bindings one definitions document declares, as a graph. */
export function rabbitMqGraph(
  raw: JsonValue,
  options: { file: string; text?: string; environment?: string },
): ResourceGraph {
  const defs = definitionsFile.parse(raw);
  const lineOf = options.text ? sourceLines(options.text) : () => undefined;

  const at = (steps: string[]): SourceLocation => {
    const line = lineOf(steps);

    return { type: 'code', file: options.file, ...(line && { line }) };
  };

  const environment = options.environment;
  const graph = emptyResourceGraph();

  const exchangeRef = (vhost: string, name: string) =>
    nodeRef(rabbitNamespace(vhost, 'exchange'), name);

  const queueRef = (vhost: string, name: string) => nodeRef(rabbitNamespace(vhost, 'queue'), name);
  const exchanges = new Set(defs.exchanges.map((e) => `${e.vhost}\0${e.name}`));
  const queues = new Set(defs.queues.map((q) => `${q.vhost}\0${q.name}`));
  const policies = [...defs.policies];

  defs.exchanges.forEach((exchange, index) => {
    const notes: string[] = [];

    if (!['direct', 'fanout', 'topic', 'headers'].includes(exchange.type))
      notes.push(`exchange type ${named(exchange.type)} is not evaluated`);

    const { policy, unknown } = effectivePolicy(
      policies,
      'exchanges',
      exchange.vhost,
      exchange.name,
    );

    if (unknown) notes.push(unknown);

    const alternate =
      optionalString.parse(exchange.arguments['alternate-exchange']) ??
      optionalString.parse(policy?.definition['alternate-exchange']);

    const { grants, notes: grantNotes } = grantsFor(
      defs,
      exchange.vhost,
      exchange.name,
      'exchange',
    );

    const source = at(['exchanges', String(index)]);
    // Topic permissions narrow which routing keys a user may publish with here.

    const topicPermissions = defs.topic_permissions
      .filter((p) => p.vhost === exchange.vhost && p.exchange === exchange.name)
      .map((p) => ({ user: p.user, write: p.write }));

    graph.resources.push(
      brokerResource(exchangeRef(exchange.vhost, exchange.name), source, {
        system: RABBITMQ,
        entity: 'exchange',
        role: 'router',
        type: exchange.type,
        vhost: exchange.vhost,
        environment,
        alternate,
        grants,
        ...(topicPermissions.length && { topicPermissions }),
        unevaluated: [...notes, ...grantNotes],
      }),
    );

    if (alternate && exchanges.has(`${exchange.vhost}\0${alternate}`))
      graph.relationships.push(
        routeEdge(
          exchangeRef(exchange.vhost, exchange.name),
          exchangeRef(exchange.vhost, alternate),
          source,
          {
            alternate: true,
            environment,
          },
        ),
      );
  });

  defs.queues.forEach((queue, index) => {
    const notes: string[] = [];
    const { policy, unknown } = effectivePolicy(policies, 'queues', queue.vhost, queue.name);
    const operator = effectivePolicy(defs.operator_policies, 'queues', queue.vhost, queue.name);

    if (unknown) notes.push(unknown);

    if (operator.unknown) notes.push(operator.unknown);

    const fromArgs = (key: string) => queue.arguments[`x-${key}`];
    const fromPolicy = (key: string) => policy?.definition[key];
    const fromOperator = (key: string) => operator.policy?.definition[key];

    // A queue argument overrides an ordinary policy; an operator policy then
    // caps the result, the lower of the two winning.
    const number = (key: string) =>
      lower(
        optionalNumber.parse(fromArgs(key)) ?? optionalNumber.parse(fromPolicy(key)),
        optionalNumber.parse(fromOperator(key)),
      );

    // An argument the queue was declared with wins over a policy.
    const dlx =
      optionalString.parse(fromArgs('dead-letter-exchange')) ??
      optionalString.parse(fromPolicy('dead-letter-exchange'));

    const dlrk =
      optionalString.parse(fromArgs('dead-letter-routing-key')) ??
      optionalString.parse(fromPolicy('dead-letter-routing-key'));

    const quorum = optionalString.parse(fromArgs('queue-type')) === 'quorum';
    const ttl = number('message-ttl');
    const expires = number('expires');
    const deliveryLimit = number('delivery-limit') ?? (quorum ? QUORUM_DELIVERY_LIMIT : undefined);
    const { grants, notes: grantNotes } = grantsFor(defs, queue.vhost, queue.name, 'queue');
    const source = at(['queues', String(index)]);

    graph.resources.push(
      brokerResource(queueRef(queue.vhost, queue.name), source, {
        system: RABBITMQ,
        entity: 'queue',
        role: 'store',
        vhost: queue.vhost,
        environment,
        ...(dlx !== undefined && {
          deadLetter: { target: dlx, ...(dlrk && { routingKey: dlrk }) },
        }),
        // A classic queue redelivers a requeued message without limit.
        maxAttempts: deliveryLimit,
        ...(ttl === undefined ? { retentionUnbounded: true } : { retentionSeconds: ttl / 1000 }),
        ...(expires !== undefined && { idleExpirySeconds: expires / 1000 }),
        maxLength: number('max-length'),
        grants,
        unevaluated: [...notes, ...grantNotes],
      }),
    );

    if (dlx && exchanges.has(`${queue.vhost}\0${dlx}`))
      graph.relationships.push(
        deadLetterEdge(queueRef(queue.vhost, queue.name), exchangeRef(queue.vhost, dlx), source, {
          ...(dlrk && { routingKey: dlrk }),
          ...(environment && { environment }),
        }),
      );
  });

  // Every binding between one exchange and one destination rides on a single edge.
  const routes = new Map<
    string,
    { from: ResourceRef; to: ResourceRef; source: SourceLocation; bindings: DeliveryBinding[] }
  >();

  defs.bindings.forEach((binding, index) => {
    const known = binding.destination_type === 'queue' ? queues : exchanges;

    // A binding to something the file does not declare has nowhere to draw to;
    // the analysis reports the missing end when a route depends on it.
    if (!exchanges.has(`${binding.vhost}\0${binding.source}`)) return;

    if (!known.has(`${binding.vhost}\0${binding.destination}`)) return;

    const from = exchangeRef(binding.vhost, binding.source);

    const to =
      binding.destination_type === 'queue'
        ? queueRef(binding.vhost, binding.destination)
        : exchangeRef(binding.vhost, binding.destination);

    const key = `${resourceKey(from)}>${resourceKey(to)}`;
    const line = lineOf(['bindings', String(index)]);

    const entry = {
      routingKey: binding.routing_key,
      arguments: binding.arguments,
      ...(line && { line }),
    };

    const existing = routes.get(key);

    if (existing) existing.bindings.push(entry);
    else routes.set(key, { from, to, source: at(['bindings', String(index)]), bindings: [entry] });
  });

  for (const { from, to, source, bindings } of routes.values())
    graph.relationships.push(routeEdge(from, to, source, { bindings, environment }));

  return graph;
}
