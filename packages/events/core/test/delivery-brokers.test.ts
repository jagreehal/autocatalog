import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeDelivery,
  companyDeliveryInputs,
  composeResourceGraphs,
  createConsumerResourceGraph,
  createEventResourceGraph,
  deliveryEvents,
  driftDelivery,
  mergeArchitectureGraphs,
  overlayDelivery,
  rabbitMqGraph,
  readConsumerDeclarations,
  scanArchitecture,
  type ConsumerDeclaration,
  type DeliveryEvent,
  type ResourceGraph,
} from '../src';
import { cloudFormationGraph, parseCloudFormation } from '../src/delivery-aws';
import { strimziGraph } from '../src/delivery-kafka';
import { contentMatches, safePattern, sqlFilterMatches } from '../src/delivery-match';
import { serviceBusGraph } from '../src/delivery-servicebus';
import { loadRepositoryEvents } from '../src/repository-events';
import { parseAllDocuments } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));

const fixture = (name: string) => path.resolve(here, '../../../../fixtures', name);

interface Repo {
  events: DeliveryEvent[];
  consumers: ConsumerDeclaration[];
}

async function repo(name: string): Promise<Repo> {
  const root = fixture(name);

  return {
    events: deliveryEvents(await loadRepositoryEvents(root)),
    consumers: await readConsumerDeclarations(root),
  };
}

const finding = (code: string, confidence?: string) =>
  expect.objectContaining({ code, ...(confidence && { confidence }) });

describe('AWS: SNS, SQS and EventBridge from CloudFormation', () => {
  let inputs: Repo;
  let template: any;
  const FILE = 'infrastructure/messaging.yaml';

  beforeAll(async () => {
    inputs = await repo('delivery-aws');
    template = parseCloudFormation(
      await fs.readFile(path.join(fixture('delivery-aws'), FILE), 'utf8'),
      FILE,
    );
  });

  const analyse = (change: (t: any, c: ConsumerDeclaration[]) => void = () => {}) => {
    const t = structuredClone(template);
    const consumers = structuredClone(inputs.consumers);
    change(t, consumers);

    return analyzeDelivery({
      graph: cloudFormationGraph(t, { file: FILE }),
      events: inputs.events,
      consumers,
    });
  };

  const props = (t: any, id: string) => t.Resources[id].Properties;

  it('is found by the resource scan', async () => {
    const { graph, errors } = await scanArchitecture({
      root: fixture('delivery-aws'),
      publish: false,
    });

    expect(errors).toEqual([]);
    expect(graph.relationships).toContainEqual(
      expect.objectContaining({
        type: 'routesTo',
        from: { kind: 'queue', namespace: 'sns', id: 'payments' },
        to: { kind: 'queue', namespace: 'sqs', id: 'ledger-payments' },
      }),
    );
  });

  it('routes the SNS filter and the EventBridge pattern, with nothing left unevaluated', () => {
    const report = analyse();
    const payment = report.routes.find((r) => r.event === 'payments/payment.completed')!;
    const refund = report.routes.find((r) => r.event === 'payments/refund.issued')!;

    expect(report.complete).toBe(true);
    expect(payment.examples.map((e) => e.reaches)).toEqual([true, false]);
    expect(payment.examples[0]!.path.map((hop) => [hop.ref.id, hop.rule])).toEqual([
      ['payments', undefined],
      ['ledger-payments', 'currency = GBP'],
    ]);
    expect(payment.deadLetter?.queues).toEqual(['ledger-dead-letter']);
    expect(payment.facts).toEqual([
      'keeps unread messages for 1 day',
      'up to 5 deliveries, 1 minute apart',
    ]);
    expect(refund.examples[0]!.path.map((hop) => hop.ref.id)).toEqual([
      'default',
      'default/refunds-to-ledger',
      'ledger-payments',
    ]);
    expect(report.findings.map((f) => f.code)).toEqual(['example_filtered']);
  });

  it('a queue with no policy for the topic may not be delivered to', () => {
    const report = analyse((t) => delete t.Resources.LedgerQueuePolicy);

    expect(report.findings).toContainEqual(finding('delivery_blocked', 'possible'));
    expect(report.routes[0]!.examples[0]!.reaches).toBe(false);
  });

  it('a queue policy that names another source denies delivery', () => {
    const report = analyse((t) => {
      props(t, 'LedgerQueuePolicy').PolicyDocument.Statement[0].Condition.ArnEquals[
        'aws:SourceArn'
      ] = 'arn:aws:sns:eu-west-2:1:other';
    });

    expect(report.findings).toContainEqual(finding('delivery_blocked', 'confirmed'));
  });

  it('retention shorter than the consumer may be down breaks its declared need', () => {
    const report = analyse((t) => (props(t, 'LedgerQueue').MessageRetentionPeriod = 3600));

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'retention_short',
        confidence: 'policy',
        message:
          '`ledger-payments` keeps unread messages for 1 hour, shorter than the 12 hours `LedgerService` declares it may be down',
      }),
    );
  });

  it('a retry policy that outlasts the processing window, and attempts the consumer does not expect', () => {
    const report = analyse((t) => (props(t, 'LedgerQueue').RedrivePolicy.maxReceiveCount = 20));

    expect(report.findings).toContainEqual(finding('attempts_mismatch', 'policy'));
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'retries_exceed_window',
        message:
          'a failing message on `ledger-payments` can be retried for up to 20 minutes (20 attempts, 1 minute apart), longer than the 10 minutes `LedgerService` declares',
      }),
    );
  });

  it('a producer role without sns:Publish is possibly denied, since IAM can be granted elsewhere', () => {
    const report = analyse((t) => {
      props(t, 'PaymentServiceRole').Policies[0].PolicyDocument.Statement[0].Action = [
        'events:PutEvents',
      ];
    });

    expect(report.findings).toContainEqual(finding('publish_denied', 'possible'));
  });

  it('a disabled rule stops the refund reaching the ledger, which drift calls breaking', () => {
    const current = analyse((t) => (props(t, 'RefundsRule').State = 'DISABLED'));

    expect(driftDelivery(analyse(), current)).toContainEqual(
      expect.objectContaining({
        kind: 'delivery_route_lost',
        eventId: 'refund.issued',
        consumers: ['LedgerService'],
      }),
    );
  });

  it('a filter on the message body is matched against the payload', () => {
    const report = analyse((t) => {
      props(t, 'LedgerSubscription').FilterPolicyScope = 'MessageBody';
      props(t, 'LedgerSubscription').FilterPolicy = { amount: [{ numeric: ['>=', 20] }] };
    });

    expect(report.routes[0]!.examples.map((e) => e.reaches)).toEqual([false, true]);
  });
});

describe('Kafka from Strimzi', () => {
  let inputs: Repo;
  let documents: Array<{ value: any; file: string }>;

  beforeAll(async () => {
    inputs = await repo('delivery-kafka');
    documents = [];

    for (const file of ['kafka/topics.yaml', 'kafka/users.yaml']) {
      const text = await fs.readFile(path.join(fixture('delivery-kafka'), file), 'utf8');

      documents.push(...parseAllDocuments(text).map((doc) => ({ value: doc.toJSON(), file })));
    }
  });

  const analyse = (change: (docs: any[], c: ConsumerDeclaration[]) => void = () => {}) => {
    const docs = structuredClone(documents);
    const consumers = structuredClone(inputs.consumers);
    change(
      docs.map((d) => d.value),
      consumers,
    );

    return analyzeDelivery({ graph: strimziGraph(docs, {}), events: inputs.events, consumers });
  };

  const user = (docs: any[], name: string) =>
    docs.find((d) => d.kind === 'KafkaUser' && d.metadata.name === name);

  it('reads the topic as the store its consumers read, with retention and the group', () => {
    const report = analyse();

    expect(report.complete).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.routes[0]).toMatchObject({
      queue: 'payments',
      group: 'ledger',
      facts: ['keeps unread messages for 7 days', 'consumer group `ledger`'],
    });
  });

  it('two services in one consumer group each get only some of the messages', () => {
    const report = analyse((_, consumers) =>
      consumers.push({ ...consumers[0]!, service: 'AuditService', identity: 'ledger-service' }),
    );

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'shared_group',
        confidence: 'confirmed',
        message:
          '`AuditService` and `LedgerService` all join consumer group `ledger` on `payments`, so each receives only some of the messages; give each its own group',
      }),
    );
  });

  it('a consumer without a group is not evaluated', () => {
    const report = analyse((_, consumers) => delete consumers[0]!.group);

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual(finding('no_group', 'unknown'));
  });

  it("a group the consumer's user may not join, and a topic it may not read, are confirmed", () => {
    expect(analyse((_, c) => (c[0]!.group = 'audit')).findings).toContainEqual(
      finding('group_denied', 'confirmed'),
    );

    const report = analyse((docs) => user(docs, 'ledger-service').spec.authorization.acls.shift());

    expect(report.findings).toContainEqual(finding('consume_denied', 'confirmed'));
  });

  it('retention left to the cluster default is unknown against a recovery window; a short one breaks it', () => {
    const unset = analyse((docs) => delete docs[0].spec.config['retention.ms']);

    expect(unset.findings).toContainEqual(finding('not_evaluated', 'unknown'));

    const short = analyse((docs) => (docs[0].spec.config['retention.ms'] = 86400000));

    expect(short.findings).toContainEqual(finding('retention_short', 'policy'));
  });
});

describe('Azure Service Bus from ARM', () => {
  let inputs: Repo;
  let template: any;

  beforeAll(async () => {
    inputs = await repo('delivery-servicebus');
    template = JSON.parse(
      await fs.readFile(
        path.join(fixture('delivery-servicebus'), 'infrastructure/servicebus.json'),
        'utf8',
      ),
    );
  });

  const subscription = (t: any) => t.resources[0].resources[0].resources[0];

  const analyse = (change: (t: any, c: ConsumerDeclaration[]) => void = () => {}) => {
    const t = structuredClone(template);
    const consumers = structuredClone(inputs.consumers);
    change(t, consumers);

    return analyzeDelivery({
      graph: serviceBusGraph(t, { file: 'servicebus.json' }),
      events: inputs.events,
      consumers,
    });
  };

  it('routes the SQL rule and dead-letters to the built-in queue', () => {
    const report = analyse();

    expect(report.complete).toBe(true);
    expect(report.routes[0]).toMatchObject({
      queue: 'payments/ledger',
      deadLetter: { queues: ['payments/ledger/$deadletterqueue'] },
      facts: ['keeps unread messages for 1 day', 'up to 5 deliveries, 1 minute apart'],
    });
    expect(report.routes[0]!.examples.map((e) => e.reaches)).toEqual([true, false]);
  });

  it("a correlation filter matches on the producer's properties", () => {
    const report = analyse((t) => {
      subscription(t).resources[0].properties = {
        filterType: 'CorrelationFilter',
        correlationFilter: { properties: { currency: 'EUR' } },
      };
    });

    expect(report.routes[0]!.examples.map((e) => e.reaches)).toEqual([false, true]);
  });

  it('SQL it does not evaluate leaves the route incomplete', () => {
    const report = analyse((t) => {
      subscription(t).resources[0].properties.sqlFilter.sqlExpression = "currency LIKE 'G%'";
    });

    expect(report.complete).toBe(false);
  });

  it('a delivery count other than the consumer expects is a policy finding', () => {
    const report = analyse((t) => (subscription(t).properties.maxDeliveryCount = 10));

    expect(report.findings).toContainEqual(finding('attempts_mismatch', 'policy'));
  });
});

describe('RabbitMQ: groups, retention, retries and permissions', () => {
  let inputs: Repo;
  let definitions: any;

  beforeAll(async () => {
    inputs = await repo('delivery-rabbitmq');
    definitions = JSON.parse(
      await fs.readFile(
        path.join(fixture('delivery-rabbitmq'), 'infrastructure/rabbitmq/definitions.json'),
        'utf8',
      ),
    );
  });

  const analyse = (change: (d: any, c: ConsumerDeclaration[]) => void = () => {}) => {
    const d = structuredClone(definitions);
    const consumers = structuredClone(inputs.consumers);
    change(d, consumers);

    return analyzeDelivery({
      graph: rabbitMqGraph(d, { file: 'definitions.json' }),
      events: inputs.events,
      consumers,
    });
  };

  const withUsers = (d: any, write = '^payments$') => {
    d.users = [{ name: 'payments' }, { name: 'ledger' }];
    d.permissions = [
      { user: 'payments', vhost: '/', configure: '', write, read: '' },
      { user: 'ledger', vhost: '/', configure: '', write: '', read: '^ledger\\..*' },
    ];
  };

  it('evaluates permissions: the producer may publish and the consumer may read', () => {
    const report = analyse((d, c) => {
      withUsers(d);
      c[0]!.identity = 'ledger';
    });

    expect(report.findings.map((f) => f.code)).toEqual(['example_filtered']);
  });

  it('a consumer the permissions do not let read is confirmed', () => {
    const report = analyse((d, c) => {
      withUsers(d);
      c[0]!.identity = 'payments';
    });

    expect(report.findings).toContainEqual(finding('consume_denied', 'confirmed'));
  });

  it('two services on one queue share its messages', () => {
    const report = analyse((_, c) => c.push({ ...c[0]!, service: 'AuditService' }));

    expect(report.findings).toContainEqual(finding('shared_group', 'confirmed'));
  });

  it('a quorum queue gives up after 20 deliveries unless told otherwise', () => {
    const report = analyse((d, c) => {
      d.queues[0].arguments['x-queue-type'] = 'quorum';
      c[0]!.deadLetter = { queue: 'ledger.dead-letter', maxAttempts: 5 };
    });

    expect(report.routes[0]!.facts).toContain('up to 20 deliveries');
    expect(report.findings).toContainEqual(finding('attempts_mismatch', 'policy'));
  });

  it('a message TTL or idle expiry shorter than the recovery window breaks it', () => {
    const report = analyse((d, c) => {
      d.queues[0].arguments['x-message-ttl'] = 60000;
      d.queues[0].arguments['x-expires'] = 120000;
      c[0]!.recovery = 'PT1H';
    });

    expect(report.findings.filter((f) => f.code === 'retention_short')).toHaveLength(2);
  });
});

describe('routes split across repositories', () => {
  let company: ResourceGraph;
  let infra: ResourceGraph;
  let definitions: any;
  const split = (repo: string) => fixture(`delivery-split/${repo}`);

  beforeAll(async () => {
    infra = (await scanArchitecture({ root: split('infra'), publish: false })).graph;
    definitions = JSON.parse(
      await fs.readFile(path.join(split('infra'), 'rabbitmq/definitions.json'), 'utf8'),
    );

    const loaded = await loadRepositoryEvents(split('payments'));
    const events = createEventResourceGraph(loaded, { repository: 'payments', urls: false });

    const published = events.resources
      .filter((resource) => resource.ref.kind === 'event')
      .map((resource) => ({
        ref: resource.ref,
        domain: 'payments',
        id: resource.ref.id,
        repository: 'payments',
      }));

    const consumers = createConsumerResourceGraph(await readConsumerDeclarations(split('ledger')), {
      repository: 'ledger',
      events: published,
    });

    // As the company site composes them, and publishes them at /catalog.json.
    company = mergeArchitectureGraphs(composeResourceGraphs(events, infra), consumers);
  });

  it("joins one repository's broker, another's event and a third's consumer into one route", () => {
    const report = analyzeDelivery(companyDeliveryInputs(company));

    expect(report.routes).toHaveLength(1);
    expect(report.routes[0]).toMatchObject({ consumer: 'LedgerService', queue: 'ledger.payments' });
    expect(report.routes[0]!.examples.map((e) => e.reaches)).toEqual([true, false]);
  });

  it("checks the infra repository's change against the company's events and consumers", () => {
    const changed = structuredClone(definitions);
    changed.bindings[0].arguments.currency = 'EUR';

    const base = { graph: infra, events: [], consumers: [] };

    const current = {
      graph: rabbitMqGraph(changed, { file: 'rabbitmq/definitions.json' }),
      events: [],
      consumers: [],
    };

    const inputs = companyDeliveryInputs(company);

    const drift = driftDelivery(
      analyzeDelivery(overlayDelivery(inputs, base, current)),
      analyzeDelivery(overlayDelivery(inputs, current, base)),
    );

    expect(drift).toContainEqual(
      expect.objectContaining({ kind: 'delivery_route_lost', consumers: ['LedgerService'] }),
    );
  });
});

describe('matchers', () => {
  it.each([
    [{ currency: ['GBP'] }, { currency: 'GBP' }, true],
    [{ currency: [{ 'anything-but': ['GBP'] }] }, { currency: 'GBP' }, false],
    [{ currency: [{ prefix: 'G' }] }, { currency: 'GBP' }, true],
    [{ amount: [{ numeric: ['>', 0, '<=', 10] }] }, { amount: 5 }, true],
    [{ amount: [{ numeric: ['>', 10] }] }, { amount: 5 }, false],
    [{ region: [{ exists: false }] }, { currency: 'GBP' }, true],
    [{ $or: [{ currency: ['EUR'] }, { amount: [12.5] }] }, { currency: 'GBP', amount: 12.5 }, true],
    [{ detail: { currency: ['GBP'] } }, { detail: { currency: 'GBP' } }, true],
    [{ currency: [{ cidr: '10.0.0.0/8' }] }, { currency: 'GBP' }, undefined],
  ])('content filter %j against %j is %s', (pattern, target, expected) => {
    // SAFETY: each pattern above is a literal JSON object, as contentMatches takes.
    expect(contentMatches(pattern as any, target)).toBe(expected);
  });

  it.each([
    ["currency = 'GBP'", true],
    ["currency = 'GBP' AND amount > 10", true],
    ["currency IN ('EUR', 'USD')", false],
    ["NOT (currency = 'EUR')", true],
    ['region IS NULL', true],
    ["missing = 'x'", false],
    ['1=1', true],
    ["currency LIKE 'G%'", undefined],
  ])('SQL filter %s is %s', (sql, expected) => {
    expect(sqlFilterMatches(sql, { currency: 'GBP', amount: 12.5 })).toBe(expected);
  });

  it('runs only regular expressions that cannot backtrack badly', () => {
    expect(safePattern('^ledger\\..*')).toBeInstanceOf(RegExp);
    expect(safePattern('^(a|b)$')).toBeInstanceOf(RegExp);
    expect(safePattern('^(a+)+$')).toBeUndefined();
    expect(safePattern('^(a.*)*$')).toBeUndefined();
    expect(safePattern('[a-z]{1,9}')).toBeUndefined();
  });
});

describe('discovery scope', () => {
  it('does not read broker configuration kept as test data', async () => {
    const root = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'ac-delivery-'));

    await fs.mkdir(path.join(root, 'test/fixtures'), { recursive: true });
    await fs.copyFile(
      path.join(fixture('delivery-rabbitmq'), 'infrastructure/rabbitmq/definitions.json'),
      path.join(root, 'test/fixtures/definitions.json'),
    );

    const { graph } = await scanArchitecture({ root, publish: false });

    expect(graph.resources).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('review fixes', () => {
  let aws: Repo;
  let template: any;
  let sb: Repo;
  let arm: any;
  let rabbit: Repo;
  let definitions: any;

  beforeAll(async () => {
    aws = await repo('delivery-aws');
    template = parseCloudFormation(
      await fs.readFile(
        path.join(fixture('delivery-aws'), 'infrastructure/messaging.yaml'),
        'utf8',
      ),
      'messaging.yaml',
    );
    sb = await repo('delivery-servicebus');
    arm = JSON.parse(
      await fs.readFile(
        path.join(fixture('delivery-servicebus'), 'infrastructure/servicebus.json'),
        'utf8',
      ),
    );
    rabbit = await repo('delivery-rabbitmq');
    definitions = JSON.parse(
      await fs.readFile(
        path.join(fixture('delivery-rabbitmq'), 'infrastructure/rabbitmq/definitions.json'),
        'utf8',
      ),
    );
  });

  const awsReport = (change: (t: any) => void) => {
    const t = structuredClone(template);
    change(t);

    return analyzeDelivery({
      graph: cloudFormationGraph(t, { file: 'm.yaml' }),
      events: aws.events,
      consumers: aws.consumers,
    });
  };

  const statements = (t: any) => t.Resources.LedgerQueuePolicy.Properties.PolicyDocument.Statement;

  it('an explicit Deny beside a matching Allow denies delivery, as IAM does', () => {
    const report = awsReport((t) =>
      statements(t).push({ ...structuredClone(statements(t)[0]), Effect: 'Deny' }),
    );

    expect(report.findings).toContainEqual(finding('delivery_blocked', 'confirmed'));
    expect(
      report.routes.find((r) => r.event === 'payments/payment.completed')!.examples[0]!.reaches,
    ).toBe(false);
  });

  it('a redundant conditional Allow in a queue policy leaves delivery granted', () => {
    const report = awsReport((t) => {
      statements(t).push({
        ...structuredClone(statements(t)[0]),
        Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' } },
      });
    });

    expect(report.complete).toBe(true);
    expect(
      report.routes.find((r) => r.event === 'payments/payment.completed')!.examples[0]!.reaches,
    ).toBe(true);
  });

  it('a policy condition it does not evaluate leaves delivery unknown, not granted', () => {
    const report = awsReport((t) => {
      statements(t)[0].Condition = { StringEquals: { 'aws:SourceAccount': '123456789012' } };
    });

    expect(report.complete).toBe(false);
    expect(
      report.routes.find((r) => r.event === 'payments/payment.completed')!.examples[0]!.reaches,
    ).toBeUndefined();
  });

  it('a queue policy statement naming another queue grants nothing on this one', () => {
    const report = awsReport((t) => {
      statements(t)[0].Resource = { 'Fn::GetAtt': ['LedgerDeadLetter', 'Arn'] };
    });

    expect(report.findings).toContainEqual(finding('delivery_blocked', 'confirmed'));
  });

  it('a queue policy Resource it cannot resolve leaves delivery unknown', () => {
    const report = awsReport((t) => {
      statements(t)[0].Resource = {
        'Fn::Sub': 'arn:aws:sqs:${AWS::Region}:${AWS::AccountId}:ledger-payments',
      };
    });

    expect(report.complete).toBe(false);
    expect(
      report.routes.find((r) => r.event === 'payments/payment.completed')!.examples[0]!.reaches,
    ).toBeUndefined();
  });

  it('a conditional Deny beside an Allow leaves the identity undecided, not granted', () => {
    const report = awsReport((t) => {
      t.Resources.PaymentServiceRole.Properties.Policies[0].PolicyDocument.Statement.push({
        Effect: 'Deny',
        Action: 'sns:Publish',
        Resource: '*',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      });
    });

    expect(report.complete).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'not_evaluated',
        message: expect.stringMatching(/may publish to topic `payments` as `payment-service`/),
      }),
    );
  });

  it('a redundant conditional Allow leaves a definite grant granted', () => {
    const report = awsReport((t) => {
      t.Resources.PaymentServiceRole.Properties.Policies[0].PolicyDocument.Statement.push({
        Effect: 'Allow',
        Action: 'sns:Publish',
        Resource: '*',
        Condition: { Bool: { 'aws:SecureTransport': 'true' } },
      });
    });

    expect(report.complete).toBe(true);
    expect(report.findings.map((f) => f.code)).toEqual(['example_filtered']);
  });

  it('a conditional Allow alone is undecided, not granted', () => {
    const report = awsReport((t) => {
      t.Resources.PaymentServiceRole.Properties.Policies[0].PolicyDocument.Statement[0].Condition =
        {
          Bool: { 'aws:SecureTransport': 'true' },
        };
    });

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: 'not_evaluated',
        message: expect.stringMatching(/may publish to topic `payments`/),
      }),
    );
  });

  it("an identity policy's Deny takes back what its Allow granted", () => {
    const report = awsReport((t) => {
      t.Resources.PaymentServiceRole.Properties.Policies[0].PolicyDocument.Statement.push({
        Effect: 'Deny',
        Action: 'sns:Publish',
        Resource: '*',
      });
    });

    expect(report.findings).toContainEqual(finding('publish_denied', 'possible'));
  });

  it("a topic's access rule grants nothing on an unrelated topic", () => {
    const t = structuredClone(arm);
    const namespace = t.resources[0];

    // payment-service may only send to an `orders` topic now.
    namespace.resources = namespace.resources.filter(
      (r: any) => r.name !== 'payments-ns/payment-service',
    );
    namespace.resources.push(
      {
        type: 'Microsoft.ServiceBus/namespaces/topics',
        name: 'payments-ns/orders',
        properties: {},
      },
      {
        type: 'Microsoft.ServiceBus/namespaces/topics/authorizationRules',
        name: 'payments-ns/orders/payment-service',
        properties: { rights: ['Send'] },
      },
    );

    const report = analyzeDelivery({
      graph: serviceBusGraph(t, { file: 'sb.json' }),
      events: sb.events,
      consumers: sb.consumers,
    });

    expect(report.findings).toContainEqual(finding('publish_denied', 'possible'));
  });

  it('a queue argument overrides an ordinary policy; an operator policy still caps it', () => {
    const report = (change: (d: any) => void) => {
      const d = structuredClone(definitions);
      change(d);

      return analyzeDelivery({
        graph: rabbitMqGraph(d, { file: 'd.json' }),
        events: rabbit.events,
        consumers: rabbit.consumers,
      });
    };

    const policy = (ttl: number) => ({
      name: 'p',
      vhost: '/',
      pattern: '^ledger\\.payments$',
      'apply-to': 'queues',
      definition: { 'message-ttl': ttl },
    });

    const argumentWins = report((d) => {
      d.queues[0].arguments['x-message-ttl'] = 60000;
      d.policies = [policy(1000)];
    });

    expect(argumentWins.routes[0]!.facts).toContain('keeps unread messages for 1 minute');

    const operatorCaps = report((d) => {
      d.queues[0].arguments['x-message-ttl'] = 60000;
      d.operator_policies = [policy(1000)];
    });

    expect(operatorCaps.routes[0]!.facts).toContain('keeps unread messages for 1 second');
  });

  it('carries the vhost on the route, whatever the first example does', () => {
    const d = structuredClone(definitions);

    for (const entry of [...d.exchanges, ...d.queues, ...d.bindings]) entry.vhost = 'payments';

    // The first example is the one the bindings exclude.
    const events = rabbit.events.map((e) => ({ ...e, examples: [...e.examples].reverse() }));

    const report = analyzeDelivery({
      graph: rabbitMqGraph(d, { file: 'd.json' }),
      events,
      consumers: rabbit.consumers,
    });

    expect(report.routes[0]!.examples[0]!.reaches).toBe(false);
    expect(report.routes[0]!.vhost).toBe('payments');
  });

  it('NOT IN does not match a message that lacks the property', () => {
    expect(sqlFilterMatches("currency NOT IN ('GBP')", {})).toBe(false);
    expect(sqlFilterMatches("NOT (currency IN ('GBP'))", {})).toBe(false);
    expect(sqlFilterMatches("currency NOT IN ('GBP')", { currency: 'EUR' })).toBe(true);
  });
});
