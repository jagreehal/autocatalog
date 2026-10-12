import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateCatalog } from '../src/validate';

const here = path.dirname(fileURLToPath(import.meta.url));

const goodRoot = path.join(here, 'fixtures/basic-catalog/events');

const dupeRoot = path.join(here, 'fixtures/duplicate-catalog/events');

describe('validateCatalog', () => {
  it('returns a structured error when the events directory does not exist', async () => {
    const result = await validateCatalog('/tmp/autocatalog-does-not-exist-' + Date.now());
    expect(result.events).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('events_directory_missing');
  });

  it('returns ok for the basic catalog', async () => {
    const result = await validateCatalog(goodRoot);
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it('does not report duplicate (id, version) when domains differ', async () => {
    const result = await validateCatalog(dupeRoot);
    const dup = result.errors.find((e) => e.code === 'duplicate_event');
    expect(dup).toBeUndefined();
  });

  it('reports duplicate (domain, id, version) pairs', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/bad-duplicate-tmp/events');
    const evtA = path.join(tmpRoot, 'payments/FooA');
    const evtB = path.join(tmpRoot, 'payments/FooB');
    await fs.mkdir(evtA, { recursive: true });
    await fs.mkdir(evtB, { recursive: true });

    const manifest = JSON.stringify({
      id: 'foo',
      version: '1.0.0',
      name: 'Foo',
      summary: 'duplicate',
    });

    const schema =
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }';

    await fs.writeFile(path.join(evtA, 'autocatalog.json'), manifest);
    await fs.writeFile(path.join(evtA, 'schema.json'), schema);
    await fs.writeFile(path.join(evtB, 'autocatalog.json'), manifest);
    await fs.writeFile(path.join(evtB, 'schema.json'), schema);

    const result = await validateCatalog(tmpRoot);
    const dup = result.errors.find((e) => e.code === 'duplicate_event');
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('payments@foo@1.0.0');

    await fs.rm(path.join(here, 'fixtures/bad-duplicate-tmp'), { recursive: true });
  });

  it('reads a schema in the dialect it declares, as EventCatalog catalogs write draft-07', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-dialect-'));

    try {
      for (const [folder, $schema] of [
        ['Draft07', 'http://json-schema.org/draft-07/schema#'],
        ['Draft06', 'http://json-schema.org/draft-06/schema#'],
        ['Draft201909', 'https://json-schema.org/draft/2019-09/schema'],
      ] as const) {
        const dir = path.join(root, 'orders', folder);
        await fs.mkdir(path.join(dir, 'examples'), { recursive: true });
        await fs.writeFile(
          path.join(dir, 'autocatalog.json'),
          JSON.stringify({
            id: folder.toLowerCase(),
            version: '1.0.0',
            name: folder,
            summary: 's',
          }),
        );
        // A tuple is `items` as an array before 2020-12, which 2020-12 rejects outright.
        await fs.writeFile(
          path.join(dir, 'schema.json'),
          JSON.stringify({
            $schema,
            type: 'object',
            properties: {
              pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] },
            },
          }),
        );
        await fs.writeFile(path.join(dir, 'examples/good.json'), '{"pair":["a",1]}');
        await fs.writeFile(path.join(dir, 'examples/bad.json'), '{"pair":["a","b"]}');
      }

      const result = await validateCatalog(root);

      expect(result.errors.map((e) => `${e.code} ${path.basename(e.path ?? '')}`).sort()).toEqual([
        'example_does_not_match_schema bad.json',
        'example_does_not_match_schema bad.json',
        'example_does_not_match_schema bad.json',
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports examples that do not validate against the schema', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/bad-example-tmp/events');
    const evt = path.join(tmpRoot, 'x/Bad');
    await fs.mkdir(path.join(evt, 'examples'), { recursive: true });
    await fs.writeFile(
      path.join(evt, 'autocatalog.json'),
      JSON.stringify({ id: 'bad', version: '1', name: 'Bad', summary: 's' }),
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'number' } },
      }),
    );
    await fs.writeFile(
      path.join(evt, 'examples/oops.json'),
      JSON.stringify({ amount: 'not-a-number' }),
    );

    const result = await validateCatalog(tmpRoot);
    const ex = result.errors.find((e) => e.code === 'example_does_not_match_schema');
    expect(ex).toBeDefined();
    expect(ex?.message).toContain('oops');

    await fs.rm(path.join(here, 'fixtures/bad-example-tmp'), { recursive: true });
  });

  it('reports unresolved deprecation.replacedBy', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/bad-replaced-tmp/events');
    const evt = path.join(tmpRoot, 'x/Dep');
    await fs.mkdir(evt, { recursive: true });
    await fs.writeFile(
      path.join(evt, 'autocatalog.json'),
      JSON.stringify({
        id: 'dep',
        version: '1',
        name: 'Dep',
        summary: 's',
        status: 'deprecated',
        deprecation: {
          since: '2026-01-01',
          replacedBy: { id: 'never.exists', version: '1' },
        },
      }),
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }',
    );

    const result = await validateCatalog(tmpRoot);
    const err = result.errors.find((e) => e.code === 'unresolved_replaced_by');
    expect(err).toBeDefined();

    await fs.rm(path.join(here, 'fixtures/bad-replaced-tmp'), { recursive: true });
  });

  it('reports an MDX-only folder as missing its manifest', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/bad-mdxonly-tmp/events');
    const evt = path.join(tmpRoot, 'x/Legacy');
    await fs.mkdir(evt, { recursive: true });
    await fs.writeFile(
      path.join(evt, 'index.mdx'),
      '---\nid: legacy\nversion: 1.0.0\nname: Legacy\nsummary: s\n---\nSome narrative.\n',
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }',
    );

    const result = await validateCatalog(tmpRoot);
    expect(result.errors.some((e) => e.message.includes('autocatalog.json'))).toBe(true);

    await fs.rm(path.join(here, 'fixtures/bad-mdxonly-tmp'), { recursive: true });
  });

  it('warns when version is neither semver nor an integer version', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/non-semver-tmp/events');

    const write = async (folder: string, version: string) => {
      const evt = path.join(tmpRoot, 'payments', folder);
      await fs.mkdir(evt, { recursive: true });
      await fs.writeFile(
        path.join(evt, 'autocatalog.json'),
        JSON.stringify({ id: folder, version, name: folder, summary: 's' }),
      );
      await fs.writeFile(
        path.join(evt, 'schema.json'),
        '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }',
      );
    };

    // EventCatalog's V-prefixed integers and v-prefixed semver are both fine.
    await write('Bare', '3');
    await write('Lower', 'v1');
    await write('Upper', 'V2');
    await write('Prefixed', 'V1.2.0');
    await write('Legacy', 'latest');

    const result = await validateCatalog(tmpRoot);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(['version_not_semver']);
    expect(result.warnings[0]?.message).toContain('latest');

    await fs.rm(path.join(here, 'fixtures/non-semver-tmp'), { recursive: true });
  });

  it('reports manifests that break the project policy contract', async () => {
    const policy = {
      type: 'object',
      required: ['owner', 'classification'],
      properties: { id: { type: 'string', pattern: '^[a-z]+(\\.[a-z]+)+$' } },
    };

    const result = await validateCatalog(goodRoot, { policy });
    const violations = result.errors.filter((e) => e.code === 'policy_violation');
    expect(violations).toHaveLength(result.events.length);
    expect(violations[0]?.message).toContain('classification');
    expect(violations[0]?.path).toBeDefined();
  });

  it('passes a catalog that satisfies its policy contract', async () => {
    const result = await validateCatalog(goodRoot, {
      policy: { type: 'object', required: ['id'] },
    });

    expect(result.errors).toEqual([]);
  });

  it('reports a policy contract that is not valid JSON Schema', async () => {
    const result = await validateCatalog(goodRoot, { policy: { type: 'nonsense' } });
    expect(result.errors.map((e) => e.code)).toEqual(['schema_invalid_json_schema']);
  });

  it('warns when a consumer declares a field the schema does not have', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/consumer-fields-tmp/events');
    const evt = path.join(tmpRoot, 'orders/OrderPlaced');
    await fs.mkdir(evt, { recursive: true });
    await fs.writeFile(
      path.join(evt, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.placed',
        version: '1.0.0',
        name: 'Order placed',
        summary: 's',
        consumers: ['Billing'],
        consumerFields: { Billing: ['items[].sku', 'items[].price'] },
      }),
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      JSON.stringify({
        type: 'object',
        properties: { items: { type: 'array', items: { properties: { sku: {} } } } },
      }),
    );

    const result = await validateCatalog(tmpRoot);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'consumer_field_unknown',
        'Consumer "Billing" declares it reads "items[].price", which the schema does not have',
      ],
    ]);

    await fs.rm(path.join(here, 'fixtures/consumer-fields-tmp'), { recursive: true });
  });
  it('rejects a delivery key the schema does not have, and warns when it is optional', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/delivery-tmp/events');
    const evt = path.join(tmpRoot, 'orders/OrderPlaced');
    await fs.mkdir(evt, { recursive: true });
    await fs.writeFile(
      path.join(evt, 'autocatalog.json'),
      JSON.stringify({
        id: 'order.placed',
        version: '1.0.0',
        name: 'Order placed',
        summary: 's',
        delivery: {
          guarantee: 'at-least-once',
          orderingKey: 'customer.id',
          idempotencyKey: 'orderNumber',
        },
      }),
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      JSON.stringify({
        type: 'object',
        required: ['orderId'],
        properties: {
          orderId: { type: 'string' },
          // `id` is required inside `customer`, but `customer` itself is optional.
          customer: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        },
      }),
    );

    try {
      const result = await validateCatalog(tmpRoot);
      expect(result.errors.map((e) => [e.code, e.message])).toEqual([
        [
          'delivery_key_unknown',
          'The idempotency key "orderNumber" is not in the schema, so consumers cannot use it',
        ],
      ]);
      expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
        [
          'delivery_key_optional',
          'The ordering key "customer.id" is optional in the schema; an event without it has no order',
        ],
      ]);

      // Keys every payload carries are fine.
      await fs.writeFile(
        path.join(evt, 'autocatalog.json'),
        JSON.stringify({
          id: 'order.placed',
          version: '1.0.0',
          name: 'Order placed',
          summary: 's',
          delivery: { orderingKey: 'orderId', idempotencyKey: 'orderId' },
        }),
      );
      const valid = await validateCatalog(tmpRoot);
      expect([...valid.errors, ...valid.warnings]).toEqual([]);
    } finally {
      await fs.rm(path.join(here, 'fixtures/delivery-tmp'), { recursive: true });
    }
  });
});
