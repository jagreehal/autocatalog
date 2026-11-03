import { parseAllDocuments } from 'yaml';
import { z } from 'zod';
import { emptyResourceGraph } from './architecture';
import { brokerResource, named, nodeRef } from './delivery-model';
import { jsonValueSchema, type JsonValue } from './json';
import type { ResourceGraph } from './resource-graph';

/**
 * Kafka from Strimzi's `KafkaTopic` and `KafkaUser` resources. A topic is a
 * store its consumers read directly: no routing, no broker-side retries or
 * dead-lettering. What matters is retention, who may write and read, and
 * which consumer groups each user may join.
 */

const STRIMZI = /kafka\.strimzi\.io\//;

const topic = z.object({
  kind: z.literal('KafkaTopic'),
  metadata: z.object({ name: z.string() }),
  spec: z
    .object({
      topicName: z.string().optional(),
      config: z.record(z.string(), jsonValueSchema).default({}),
    })
    .default({ config: {} }),
});

const acl = z.object({
  type: z.enum(['allow', 'deny']).default('allow'),
  resource: z.object({
    type: z.string(),
    name: z.string().default('*'),
    patternType: z.enum(['literal', 'prefix']).default('literal'),
  }),
  operations: z.array(z.string()).optional(),
  operation: z.string().optional(),
});

const user = z.object({
  kind: z.literal('KafkaUser'),
  metadata: z.object({ name: z.string() }),
  spec: z
    .object({
      authorization: z.object({ type: z.string(), acls: z.array(acl).default([]) }).optional(),
    })
    .default({}),
});

/** Every Strimzi document in a YAML file, when it holds a topic or user. */
export function parseStrimzi(text: string): JsonValue[] | undefined {
  if (!STRIMZI.test(text) || !/kind:\s*Kafka(Topic|User)/.test(text)) return undefined;

  try {
    return parseAllDocuments(text).map((doc) => jsonValueSchema.parse(doc.toJSON() ?? null));
  } catch {
    return undefined;
  }
}

const covers = (resource: z.infer<typeof acl>['resource'], name: string) =>
  resource.name === '*' ||
  (resource.patternType === 'prefix' ? name.startsWith(resource.name) : resource.name === name);

/** Topics and users from every Strimzi file in the repository, read together: they are often kept apart. */
export function strimziGraph(
  documents: Array<{ value: JsonValue; file: string }>,
  options: { environment?: string },
): ResourceGraph {
  const topics = documents.flatMap(({ value, file }) => {
    const parsed = topic.safeParse(value);

    return parsed.success ? [{ ...parsed.data, file }] : [];
  });

  const users = documents.flatMap(({ value }) => {
    const parsed = user.safeParse(value);

    return parsed.success ? [parsed.data] : [];
  });

  const graph = emptyResourceGraph();

  for (const entry of topics) {
    const name = entry.spec.topicName ?? entry.metadata.name;

    const retention = z.coerce
      .number()
      .optional()
      .catch(undefined)
      .parse(entry.spec.config['retention.ms']);

    const publish = new Set<string>();
    const consume = new Set<string>();
    const groups: Record<string, string[]> = {};
    const notes: string[] = [];

    for (const account of users) {
      const authorization = account.spec.authorization;

      if (!authorization) continue;

      if (authorization.type !== 'simple') {
        notes.push(
          `${named(account.metadata.name)} uses ${named(authorization.type)} authorization, which is not evaluated`,
        );
        continue;
      }

      for (const rule of authorization.acls) {
        const operations = (rule.operations ?? (rule.operation ? [rule.operation] : [])).map((o) =>
          o.toLowerCase(),
        );

        const can = (operation: string) =>
          operations.includes(operation) || operations.includes('all');

        if (rule.type === 'deny') {
          if (rule.resource.type === 'topic' && covers(rule.resource, name))
            notes.push(`${named(account.metadata.name)} has a deny rule, which is not evaluated`);
          continue;
        }

        if (rule.resource.type === 'topic' && covers(rule.resource, name)) {
          if (can('write')) publish.add(account.metadata.name);

          if (can('read')) consume.add(account.metadata.name);
        }

        if (rule.resource.type === 'group' && can('read'))
          groups[account.metadata.name] = [
            ...(groups[account.metadata.name] ?? []),
            rule.resource.patternType === 'prefix' || rule.resource.name === '*'
              ? `${rule.resource.name === '*' ? '' : rule.resource.name}*`
              : rule.resource.name,
          ];
      }
    }

    graph.resources.push(
      brokerResource(
        nodeRef('kafka', name),
        { type: 'code', file: entry.file },
        {
          system: 'kafka',
          entity: 'topic',
          role: 'store',
          environment: options.environment,
          ...(retention === undefined
            ? { retentionDefault: true }
            : retention < 0
              ? { retentionUnbounded: true }
              : { retentionSeconds: retention / 1000 }),
          // With no KafkaUser read, access is not known rather than granted to nobody.
          ...(users.length > 0 && {
            grants: {
              publish: [...publish].sort(),
              consume: [...consume].sort(),
              groups,
              complete: notes.length === 0,
            },
          }),
          unevaluated: notes,
        },
      ),
    );
  }

  return graph;
}
