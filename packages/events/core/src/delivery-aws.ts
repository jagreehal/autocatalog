import { parse, type CollectionTag, type ScalarTag, type YAMLMap, type YAMLSeq } from 'yaml';
import { z } from 'zod';
import { emptyResourceGraph } from './architecture';
import type { SourceLocation } from './adapter-event';
import {
  brokerResource,
  deadLetterEdge,
  nodeRef,
  routeEdge,
  type BrokerNode,
} from './delivery-model';
import {
  isJsonObject,
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from './json';
import type { CatalogResource, ResourceGraph } from './resource-graph';
import { sourceLines } from './source-lines';

/**
 * AWS messaging from a CloudFormation or SAM template: SNS topics and their
 * SQS subscriptions, SQS queues, EventBridge buses and rules, the queue
 * policies that let a topic or bus deliver, and the IAM roles that may
 * publish and consume. IAM can be granted outside the template, so every
 * grant read here is incomplete: a missing one is possible, never confirmed.
 */

const INTRINSICS = [
  'Ref',
  'GetAtt',
  'Sub',
  'Join',
  'Select',
  'Split',
  'ImportValue',
  'If',
  'Equals',
  'Not',
  'And',
  'Or',
  'FindInMap',
  'Base64',
  'GetAZs',
  'Cidr',
  'Condition',
];

/** CloudFormation's short-form intrinsics as the long form JSON templates use. */
const intrinsic = (name: string, value: JsonValue): JsonObject => {
  if (name === 'Ref') return { Ref: value };

  if (name === 'Condition') return { Condition: value };

  if (name === 'GetAtt') {
    const parts = z.string().safeParse(value);

    return { 'Fn::GetAtt': parts.success ? parts.data.split('.') : value };
  }

  return { [`Fn::${name}`]: value };
};

const CUSTOM_TAGS: Array<ScalarTag | CollectionTag> = INTRINSICS.flatMap((name) => [
  { tag: `!${name}`, resolve: (value: string) => intrinsic(name, value) },
  {
    tag: `!${name}`,
    collection: 'seq' as const,
    resolve: (value: YAMLMap | YAMLSeq) => intrinsic(name, jsonValueSchema.parse(value.toJSON())),
  },
  {
    tag: `!${name}`,
    collection: 'map' as const,
    resolve: (value: YAMLMap | YAMLSeq) => intrinsic(name, jsonValueSchema.parse(value.toJSON())),
  },
]);

const MESSAGING = /AWS::(SNS|SQS|Events)::/;

const template = z.object({
  Resources: z.record(
    z.string(),
    z.object({ Type: z.string(), Properties: jsonObjectSchema.default({}) }),
  ),
});

/** A template's text parsed, when it is a CloudFormation template with messaging resources. */
export function parseCloudFormation(text: string, file: string): JsonValue | undefined {
  if (!MESSAGING.test(text)) return undefined;

  let value: JsonValue;

  try {
    value = file.endsWith('.json')
      ? jsonValueSchema.parse(JSON.parse(text))
      : jsonValueSchema.parse(parse(text, { customTags: CUSTOM_TAGS, uniqueKeys: false }) ?? null);
  } catch {
    return undefined;
  }

  return template.safeParse(value).success ? value : undefined;
}

const optionalString = z.string().optional().catch(undefined);

const optionalNumber = z.coerce.number().optional().catch(undefined);

const redrive = z
  .object({ deadLetterTargetArn: jsonValueSchema, maxReceiveCount: z.coerce.number().optional() })
  .optional()
  .catch(undefined);

/** A JSON policy written inline or as a JSON string, as both are allowed. */
const inlineJson = (value: JsonValue | undefined): JsonObject | undefined => {
  if (isJsonObject(value)) return value;

  const text = optionalString.parse(value);

  if (!text) return undefined;

  try {
    const parsed = jsonValueSchema.parse(JSON.parse(text));

    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const statement = z.object({
  Effect: z.string().default('Allow'),
  Principal: jsonValueSchema.optional(),
  NotPrincipal: jsonValueSchema.optional(),
  Action: jsonValueSchema.optional(),
  NotAction: jsonValueSchema.optional(),
  Resource: jsonValueSchema.optional(),
  NotResource: jsonValueSchema.optional(),
  Condition: jsonValueSchema.optional(),
});

/** Condition operators evaluated, and only on `aws:SourceArn`; anything else is unknown. */
const SOURCE_OPERATORS = new Set(['ArnEquals', 'ArnLike', 'StringEquals', 'StringLike']);

type Statement = z.infer<typeof statement>;

const statements = (document: JsonValue | undefined): Statement[] => {
  const doc = inlineJson(document);
  const list = doc?.Statement;

  return (Array.isArray(list) ? list : list === undefined ? [] : [list]).flatMap((entry) => {
    const parsed = statement.safeParse(entry);

    return parsed.success ? [parsed.data] : [];
  });
};

const asList = (value: JsonValue | undefined): JsonValue[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Whether an IAM action pattern such as `sns:*` covers an action. */
function actionCovers(pattern: string, action: string): boolean {
  return globMatches(pattern.toLowerCase(), action.toLowerCase());
}

/**
 * `*` as any run of characters, `?` as one, matched in linear time with no
 * regular expression, since a policy in a pull request is untrusted.
 */
export function globMatches(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;

  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      resume = t;
    } else if (star !== -1) {
      p = star + 1;
      t = ++resume;
    } else return false;
  }

  while (pattern[p] === '*') p++;

  return p === pattern.length;
}

const covers = (actions: JsonValue | undefined, wanted: string) =>
  asList(actions).some((action) => {
    const text = optionalString.parse(action);

    return text !== undefined && actionCovers(text, wanted);
  });

interface Entity {
  logicalId: string;
  type: string;
  name: string;
  properties: JsonObject;
  source: SourceLocation;
}

export function cloudFormationGraph(
  raw: JsonValue,
  options: { file: string; text?: string; environment?: string },
): ResourceGraph {
  const resources = template.parse(raw).Resources;
  const lineOf = options.text ? sourceLines(options.text) : () => undefined;

  const at = (logicalId: string): SourceLocation => {
    const line = lineOf(['Resources', logicalId]);

    return { type: 'code', file: options.file, ...(line && { line }) };
  };

  const environment = options.environment;
  const entities = new Map<string, Entity>();

  for (const [logicalId, { Type, Properties }] of Object.entries(resources)) {
    const nameKey =
      Type === 'AWS::SNS::Topic'
        ? 'TopicName'
        : Type === 'AWS::SQS::Queue'
          ? 'QueueName'
          : Type === 'AWS::Events::EventBus' || Type === 'AWS::Events::Rule'
            ? 'Name'
            : Type === 'AWS::IAM::Role'
              ? 'RoleName'
              : undefined;

    const name = (nameKey && optionalString.parse(Properties[nameKey])) || logicalId;

    entities.set(logicalId, {
      logicalId,
      type: Type,
      name,
      properties: Properties,
      source: at(logicalId),
    });
  }

  const ofType = (type: string) => [...entities.values()].filter((entity) => entity.type === type);

  const namespaceOf = new Map([
    ['AWS::SNS::Topic', 'sns'],
    ['AWS::SQS::Queue', 'sqs'],
    ['AWS::Events::EventBus', 'eventbridge'],
    ['AWS::Events::Rule', 'eventbridge-rule'],
  ]);

  /** The template entity a value refers to: `Ref`, `GetAtt`, or a literal ARN or name. */
  const resolve = (value: JsonValue | undefined): Entity | undefined => {
    if (isJsonObject(value)) {
      const ref = optionalString.parse(value.Ref);
      const getAtt = value['Fn::GetAtt'];
      const target = ref ?? (Array.isArray(getAtt) ? optionalString.parse(getAtt[0]) : undefined);

      return target ? entities.get(target) : undefined;
    }

    const text = optionalString.parse(value);

    if (!text) return undefined;

    const name = text.split(/[:/]/).at(-1);

    return [...entities.values()].find(
      (entity) => entity.name === name && namespaceOf.has(entity.type),
    );
  };

  const refOf = (entity: Entity) => nodeRef(namespaceOf.get(entity.type)!, entity.name);
  const graph = emptyResourceGraph();
  const nodes = new Map<string, CatalogResource>();

  const addNode = (
    entity: Entity,
    node: Partial<BrokerNode> & Pick<BrokerNode, 'system' | 'entity' | 'role'>,
  ) => {
    const resource = brokerResource(refOf(entity), entity.source, {
      environment,
      unevaluated: [],
      ...node,
    });

    nodes.set(entity.logicalId, resource);
    graph.resources.push(resource);
  };

  // Identity policies: which role may publish to and consume from what.
  const identityStatements: Array<{ identity: string; statement: Statement }> = [];

  for (const role of ofType('AWS::IAM::Role'))
    for (const policy of asList(role.properties.Policies))
      for (const entry of statements(isJsonObject(policy) ? policy.PolicyDocument : undefined))
        identityStatements.push({ identity: role.name, statement: entry });

  for (const policy of [...ofType('AWS::IAM::Policy'), ...ofType('AWS::IAM::ManagedPolicy')])
    for (const role of asList(policy.properties.Roles)) {
      const identity = resolve(role)?.name ?? optionalString.parse(role);

      if (!identity) continue;

      for (const entry of statements(policy.properties.PolicyDocument))
        identityStatements.push({ identity, statement: entry });
    }

  const grantsFor = (
    entity: Entity,
    publishAction: string,
    consumeAction?: string,
  ): BrokerNode['grants'] => {
    // A template with no IAM in it says nothing about access.
    if (identityStatements.length === 0) return undefined;

    // What the statements say per identity and action, resolved as IAM does
    // once all are read: a Deny wins; a Deny that may apply leaves the answer
    // undecided; then an Allow grants; an Allow that may apply, alone, is
    // undecided. An uncertain Allow never takes away a definite one.
    const said = new Map<string, Set<'allow' | 'maybe-allow' | 'deny' | 'maybe-deny'>>();

    const record = (key: string, value: 'allow' | 'maybe-allow' | 'deny' | 'maybe-deny') =>
      said.set(key, (said.get(key) ?? new Set()).add(value));

    for (const { identity, statement: entry } of identityStatements) {
      const match = resourceMatches(entry.Resource, entity);

      if (match === false) continue;

      for (const [action, key] of [
        [publishAction, `publish\0${identity}`],
        ...(consumeAction ? [[consumeAction, `consume\0${identity}`]] : []),
      ] as const) {
        if (!covers(entry.Action, action)) continue;

        const conditional = entry.Condition !== undefined || match === undefined;

        if (entry.Effect === 'Deny') record(key, conditional ? 'maybe-deny' : 'deny');
        else if (entry.Effect === 'Allow') record(key, conditional ? 'maybe-allow' : 'allow');
      }
    }

    const decide = (statements: Set<string>): 'granted' | 'denied' | 'undecided' | undefined =>
      statements.has('deny')
        ? 'denied'
        : statements.has('maybe-deny')
          ? statements.has('allow') || statements.has('maybe-allow')
            ? 'undecided'
            : undefined
          : statements.has('allow')
            ? 'granted'
            : statements.has('maybe-allow')
              ? 'undecided'
              : undefined;

    const pick = (kind: string, value: 'granted' | 'undecided') =>
      [...said.entries()]
        .flatMap(([key, statements]) =>
          key.startsWith(`${kind}\0`) && decide(statements) === value
            ? [key.slice(kind.length + 1)]
            : [],
        )
        .sort();

    const undecided = {
      publish: pick('publish', 'undecided'),
      consume: pick('consume', 'undecided'),
    };

    return {
      publish: pick('publish', 'granted'),
      consume: pick('consume', 'granted'),
      complete: false,
      ...((undecided.publish.length > 0 || undecided.consume.length > 0) && { undecided }),
    };
  };

  /**
   * Whether a statement's Resource names this entity: true for `*` or a
   * reference to it, false for something else, undefined for a pattern or a
   * reference not resolved. A statement without Resource (a resource policy's)
   * applies to what it is attached to.
   */
  function resourceMatches(resource: JsonValue | undefined, entity: Entity): boolean | undefined {
    if (resource === undefined) return true;

    const results = asList(resource).map((value) => {
      const text = optionalString.parse(value);

      if (text === '*') return true;

      if (text?.includes('*')) return undefined;

      const target = resolve(value);

      if (target) return target.logicalId === entity.logicalId;

      return undefined;
    });

    return results.includes(true) ? true : results.includes(undefined) ? undefined : false;
  }

  for (const topic of ofType('AWS::SNS::Topic'))
    addNode(topic, {
      system: 'sns',
      entity: 'topic',
      role: 'router',
      grants: grantsFor(topic, 'sns:Publish'),
    });

  for (const bus of ofType('AWS::Events::EventBus'))
    addNode(bus, {
      system: 'eventbridge',
      entity: 'bus',
      role: 'router',
      grants: grantsFor(bus, 'events:PutEvents'),
    });

  for (const queue of ofType('AWS::SQS::Queue')) {
    const policy = redrive.parse(inlineJson(queue.properties.RedrivePolicy));
    const target = policy && resolve(policy.deadLetterTargetArn);
    const retention = optionalNumber.parse(queue.properties.MessageRetentionPeriod) ?? 345600;

    addNode(queue, {
      system: 'sqs',
      entity: 'queue',
      role: 'store',
      retentionSeconds: retention,
      redeliveryDelaySeconds: optionalNumber.parse(queue.properties.VisibilityTimeout) ?? 30,
      ...(policy && {
        deadLetter: {
          target:
            target?.name ??
            String(optionalString.parse(policy.deadLetterTargetArn) ?? '(not resolved)'),
        },
        maxAttempts: policy.maxReceiveCount,
      }),
      grants: grantsFor(queue, 'sqs:SendMessage', 'sqs:ReceiveMessage'),
      unevaluated: policy && !target ? ['its dead-letter queue is not in this template'] : [],
    });
  }

  // Drawn once every queue exists: a dead-letter queue may be declared after its source.
  for (const queue of ofType('AWS::SQS::Queue')) {
    const policy = redrive.parse(inlineJson(queue.properties.RedrivePolicy));
    const target = policy && resolve(policy.deadLetterTargetArn);

    if (target && nodes.has(target.logicalId))
      graph.relationships.push(deadLetterEdge(refOf(queue), refOf(target), queue.source));
  }

  // Whether a queue's policy lets a topic or bus send to it.
  const queuePolicies = ofType('AWS::SQS::QueuePolicy');

  /** Whether a statement's conditions hold for a delivery from `source`: undefined when not evaluated. */
  const conditionHolds = (
    condition: JsonValue | undefined,
    source: Entity,
  ): boolean | undefined => {
    if (condition === undefined) return true;

    if (!isJsonObject(condition)) return undefined;

    const results = Object.entries(condition).map(([operator, block]) => {
      if (!SOURCE_OPERATORS.has(operator) || !isJsonObject(block)) return undefined;

      const keys = Object.keys(block);

      if (keys.some((key) => key !== 'aws:SourceArn')) return undefined;

      const values = asList(block['aws:SourceArn']);

      // A wildcard ARN is a pattern this does not run.
      if (values.some((value) => optionalString.parse(value)?.includes('*'))) return undefined;

      return values.some((value) => resolve(value)?.logicalId === source.logicalId);
    });

    return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
  };

  /**
   * Whether a queue's policies let a topic or rule send to it, as IAM decides:
   * a matching Deny wins over any Allow, and a statement this does not evaluate
   * leaves the answer unknown rather than granted.
   */
  const access = (
    queue: Entity,
    source: Entity,
    service: string,
  ): 'granted' | 'denied' | 'missing' | 'unknown' => {
    const applicable = queuePolicies.filter((policy) =>
      asList(policy.properties.Queues).some((q) => resolve(q)?.logicalId === queue.logicalId),
    );

    if (applicable.length === 0) return 'missing';

    // As IAM decides: a Deny that applies wins; one that may apply leaves any
    // grant undecided. An Allow grants; one that may apply, alone, is
    // undecided. An uncertain Allow never takes away a definite one.
    let allowed = false;
    let maybeAllowed = false;
    let maybeDenied = false;

    for (const policy of applicable) {
      for (const entry of statements(policy.properties.PolicyDocument)) {
        const deny = entry.Effect === 'Deny';

        if (
          entry.NotPrincipal !== undefined ||
          entry.NotAction !== undefined ||
          entry.NotResource !== undefined
        ) {
          if (deny) maybeDenied = true;
          else maybeAllowed = true;

          continue;
        }

        if (!covers(entry.Action, 'sqs:SendMessage')) continue;

        const resource = resourceMatches(entry.Resource, queue);

        if (resource === false) continue;

        const principal = entry.Principal;
        const services = isJsonObject(principal) ? asList(principal.Service) : [];
        const anyone = principal === '*' || (isJsonObject(principal) && principal.AWS === '*');

        if (!anyone && !services.includes(service)) continue;

        const condition = conditionHolds(entry.Condition, source);
        // A Resource not resolved is as undecided as a condition not evaluated.
        const holds = resource === undefined && condition !== false ? undefined : condition;

        if (deny) {
          if (holds === true) return 'denied';

          if (holds === undefined) maybeDenied = true;
        } else if (holds === true) allowed = true;
        else if (holds === undefined) maybeAllowed = true;
      }
    }

    if (maybeDenied && (allowed || maybeAllowed)) return 'unknown';

    if (allowed) return 'granted';

    return maybeAllowed ? 'unknown' : 'denied';
  };

  const subscriptions: Array<{
    topic: JsonValue | undefined;
    props: JsonObject;
    source: SourceLocation;
  }> = [
    ...ofType('AWS::SNS::Subscription').map((entity) => ({
      topic: entity.properties.TopicArn,
      props: entity.properties,
      source: entity.source,
    })),
    // A topic's inline subscriptions.
    ...ofType('AWS::SNS::Topic').flatMap((topic) =>
      asList(topic.properties.Subscription).flatMap((entry) =>
        isJsonObject(entry)
          ? [{ topic: { Ref: topic.logicalId }, props: entry, source: topic.source }]
          : [],
      ),
    ),
  ];

  for (const { topic: topicValue, props, source } of subscriptions) {
    const topic = resolve(topicValue);
    const queue = resolve(props.Endpoint);

    if (
      optionalString.parse(props.Protocol) !== 'sqs' ||
      !topic ||
      !queue ||
      queue.type !== 'AWS::SQS::Queue'
    )
      continue;

    const filter = inlineJson(props.FilterPolicy);

    const scope =
      optionalString.parse(props.FilterPolicyScope) === 'MessageBody' ? 'body' : 'attributes';

    const dlq = redrive.parse(inlineJson(props.RedrivePolicy));

    graph.relationships.push(
      routeEdge(refOf(topic), refOf(queue), source, {
        ...(filter && { filter: { scope, pattern: filter } }),
        access: access(queue, topic, 'sns.amazonaws.com'),
        ...(dlq && { deadLetter: resolve(dlq.deadLetterTargetArn)?.name ?? '(not resolved)' }),
        environment,
      }),
    );
  }

  // EventBridge: bus → rule (the pattern) → target (retries and dead-letter queue).
  const defaultBus = (): Entity => {
    const existing = entities.get('(default event bus)');

    if (existing) return existing;

    const bus: Entity = {
      logicalId: '(default event bus)',
      type: 'AWS::Events::EventBus',
      name: 'default',
      properties: {},
      source: { type: 'code', file: options.file },
    };

    entities.set(bus.logicalId, bus);
    addNode(bus, {
      system: 'eventbridge',
      entity: 'bus',
      role: 'router',
      grants: grantsFor(bus, 'events:PutEvents'),
    });

    return bus;
  };

  for (const rule of ofType('AWS::Events::Rule')) {
    const busValue = rule.properties.EventBusName;
    const bus = busValue === undefined ? defaultBus() : resolve(busValue);
    const pattern = inlineJson(rule.properties.EventPattern);

    if (!bus) continue;

    const ruleEntity: Entity = { ...rule, name: `${bus.name}/${rule.name}` };
    entities.set(rule.logicalId, ruleEntity);
    addNode(ruleEntity, {
      system: 'eventbridge',
      entity: 'rule',
      role: 'router',
      unevaluated: pattern ? [] : ['the rule has no event pattern that is evaluated'],
    });

    graph.relationships.push(
      routeEdge(refOf(bus), refOf(ruleEntity), rule.source, {
        ...(pattern && { filter: { scope: 'event', pattern } }),
        disabled: optionalString.parse(rule.properties.State) === 'DISABLED',
        environment,
      }),
    );

    for (const target of asList(rule.properties.Targets)) {
      if (!isJsonObject(target)) continue;

      const destination = resolve(target.Arn);

      if (!destination || !namespaceOf.has(destination.type)) continue;

      const retry = isJsonObject(target.RetryPolicy) ? target.RetryPolicy : {};

      const dlq = isJsonObject(target.DeadLetterConfig)
        ? resolve(target.DeadLetterConfig.Arn)
        : undefined;

      graph.relationships.push(
        routeEdge(refOf(ruleEntity), refOf(destination), rule.source, {
          ...(destination.type === 'AWS::SQS::Queue' && {
            access: access(destination, rule, 'events.amazonaws.com'),
          }),
          maxAttempts: optionalNumber.parse(retry.MaximumRetryAttempts) ?? 185,
          maxAgeSeconds: optionalNumber.parse(retry.MaximumEventAgeInSeconds) ?? 86400,
          ...(dlq && { deadLetter: dlq.name }),
          environment,
        }),
      );
    }
  }

  return graph;
}
