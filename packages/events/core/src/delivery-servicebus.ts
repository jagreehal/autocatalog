import { z } from 'zod';
import { emptyResourceGraph } from './architecture';
import type { SourceLocation } from './adapter-event';
import {
  brokerResource,
  deadLetterEdge,
  nodeRef,
  routeEdge,
  type ServiceBusRule,
} from './delivery-model';
import {
  isJsonObject,
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from './json';
import type { CatalogResource, ResourceGraph } from './resource-graph';
import { durationSeconds } from './schema';

/**
 * Azure Service Bus from an ARM template (what Bicep compiles to): topics,
 * their subscriptions and rules, queues, and the shared access rules that let
 * a key send or listen. A subscription is the store its consumer reads; its
 * dead-letter queue is built in. Access can also come from Azure RBAC, so the
 * grants read here are incomplete.
 */

const SERVICE_BUS = 'Microsoft.ServiceBus/namespaces';

const armResource: z.ZodType<ArmResource> = z.lazy(() =>
  z.object({
    type: z.string(),
    name: z.string(),
    properties: jsonObjectSchema.default({}),
    resources: z.array(armResource).default([]),
  }),
);

interface ArmResource {
  type: string;
  name: string;
  properties: JsonObject;
  resources: ArmResource[];
}

const armTemplate = z.object({ resources: z.array(armResource) });

export function parseArmServiceBus(text: string): JsonValue | undefined {
  if (!text.includes(SERVICE_BUS)) return undefined;

  try {
    const value = jsonValueSchema.parse(JSON.parse(text));

    return armTemplate.safeParse(value).success ? value : undefined;
  } catch {
    return undefined;
  }
}

/** ARM gives Service Bus messages this long a life when none is set: in effect, forever. */
const UNBOUNDED_SECONDS = 10_000 * 86400;

const optionalString = z.string().optional().catch(undefined);

const optionalNumber = z.coerce.number().optional().catch(undefined);

/** The topic or queue whose access rules apply. */
interface Scope {
  kind: 'topics' | 'queues';
  name: string;
}

interface Flat {
  /** The type with the namespace prefix, as `topics/subscriptions`. */
  kind: string;
  /** The name's segments after the namespace. */
  path: string[];
  properties: JsonObject;
  /** An ARM expression in the name: the resource cannot be placed. */
  expression: boolean;
}

/** Nested ARM resources flattened, each with its full type and name. */
function flatten(resources: ArmResource[], parentType = '', parentName = ''): Flat[] {
  return resources.flatMap((resource) => {
    const type =
      parentType && !resource.type.includes('/') ? `${parentType}/${resource.type}` : resource.type;

    const name =
      parentName && !resource.name.includes('/') ? `${parentName}/${resource.name}` : resource.name;

    const self: Flat[] = type.startsWith(SERVICE_BUS)
      ? [
          {
            kind: type.slice(SERVICE_BUS.length).replace(/^\//, ''),
            path: name.split('/').slice(1),
            properties: resource.properties,
            expression: name.startsWith('['),
          },
        ]
      : [];

    return [...self, ...flatten(resource.resources, type, name)];
  });
}

export function serviceBusGraph(
  raw: JsonValue,
  options: { file: string; environment?: string },
): ResourceGraph {
  const flat = flatten(armTemplate.parse(raw).resources);
  const source: SourceLocation = { type: 'code', file: options.file };
  const environment = options.environment;
  const graph = emptyResourceGraph();
  const nodes = new Map<string, CatalogResource>();
  const notes: string[] = [];

  if (flat.some((entry) => entry.expression))
    notes.push('a Service Bus resource is named by an ARM expression, which is not evaluated');

  /**
   * The shared access rules that cover an entity: the namespace's, and those of
   * the topic or queue itself, matched by kind and full name. A subscription is
   * covered by its topic's.
   */
  const rights = (scope: Scope) =>
    flat
      .filter((entry) => entry.kind.endsWith('authorizationRules') && !entry.expression)
      .flatMap((entry) => {
        const owner = entry.path.slice(0, -1);

        const applies =
          entry.kind === 'authorizationRules'
            ? owner.length === 0
            : entry.kind === `${scope.kind}/authorizationRules` &&
              owner.length === 1 &&
              owner[0] === scope.name;

        const list = z.array(z.string()).catch([]).parse(entry.properties.rights);

        return applies ? [{ identity: entry.path.at(-1)!, rights: list }] : [];
      });

  const hasAuthRules = flat.some((entry) => entry.kind.endsWith('authorizationRules'));

  const grantsFor = (scope: Scope) => {
    if (!hasAuthRules) return undefined;

    const entries = rights(scope);

    const can = (right: string) =>
      entries
        .filter((e) => e.rights.includes(right) || e.rights.includes('Manage'))
        .map((e) => e.identity)
        .sort();

    return { publish: can('Send'), consume: can('Listen'), complete: false };
  };

  const store = (id: string, props: JsonObject, entity: string, scope: Scope) => {
    const ttl = durationSeconds(optionalString.parse(props.defaultMessageTimeToLive) ?? '');
    const lock = durationSeconds(optionalString.parse(props.lockDuration) ?? '') ?? 60;
    const forwardDead = optionalString.parse(props.forwardDeadLetteredMessagesTo);

    const resource = brokerResource(nodeRef('servicebus', id), source, {
      system: 'servicebus',
      entity,
      role: 'store',
      environment,
      maxAttempts: optionalNumber.parse(props.maxDeliveryCount) ?? 10,
      redeliveryDelaySeconds: lock,
      ...(ttl === undefined || ttl >= UNBOUNDED_SECONDS
        ? { retentionUnbounded: true }
        : { retentionSeconds: ttl }),
      deadLetter: { target: forwardDead ?? `${id}/$deadletterqueue` },
      grants: grantsFor(scope),
      unevaluated: notes,
    });

    nodes.set(id, resource);
    graph.resources.push(resource);

    // The built-in dead-letter queue every queue and subscription has.
    if (!forwardDead) {
      const dlq = brokerResource(nodeRef('servicebus', `${id}/$deadletterqueue`), source, {
        system: 'servicebus',
        entity: 'deadletterqueue',
        role: 'store',
        environment,
        retentionUnbounded: true,
        grants: grantsFor(scope),
      });

      graph.resources.push(dlq);
      graph.relationships.push(deadLetterEdge(resource.ref, dlq.ref, source));
    }
  };

  for (const entry of flat) {
    if (entry.expression) continue;

    if (entry.kind === 'topics') {
      const [topic] = entry.path;

      if (!topic) continue;

      const resource = brokerResource(nodeRef('servicebus-topic', topic), source, {
        system: 'servicebus',
        entity: 'topic',
        role: 'router',
        environment,
        grants: grantsFor({ kind: 'topics', name: topic }),
      });

      nodes.set(`topic:${topic}`, resource);
      graph.resources.push(resource);
    }

    if (entry.kind === 'queues' && entry.path[0])
      store(entry.path[0], entry.properties, 'queue', { kind: 'queues', name: entry.path[0] });
  }

  for (const entry of flat) {
    if (entry.expression || entry.kind !== 'topics/subscriptions') continue;

    const [topic, subscription] = entry.path;

    if (!topic || !subscription || !nodes.has(`topic:${topic}`)) continue;

    const id = `${topic}/${subscription}`;

    store(id, entry.properties, 'subscription', { kind: 'topics', name: topic });

    const rules: ServiceBusRule[] = flat
      .filter(
        (rule) =>
          rule.kind === 'topics/subscriptions/rules' &&
          rule.path[0] === topic &&
          rule.path[1] === subscription,
      )
      .map((rule) => {
        const props = rule.properties;

        const sql = isJsonObject(props.sqlFilter)
          ? optionalString.parse(props.sqlFilter.sqlExpression)
          : undefined;

        const correlation = isJsonObject(props.correlationFilter)
          ? props.correlationFilter
          : undefined;

        return {
          name: rule.path[2] ?? 'rule',
          ...(optionalString.parse(props.filterType) === 'CorrelationFilter'
            ? { correlation: correlation ?? {} }
            : { sql: sql ?? '1=1' }),
        };
      });

    graph.relationships.push(
      routeEdge(nodeRef('servicebus-topic', topic), nodeRef('servicebus', id), source, {
        // A subscription with no rule of its own gets $Default, which takes everything.
        rules: rules.length > 0 ? rules : [{ name: '$Default', sql: '1=1' }],
        environment,
      }),
    );
  }

  return graph;
}
