import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventFrontmatter, type EventFrontmatter } from 'autocatalog-core';
import { runFromEventCatalog } from '../src/commands/from-eventcatalog';
import { runFromAsyncApi } from '../src/commands/from-asyncapi';

const here = path.dirname(fileURLToPath(import.meta.url));

const fixtures = path.resolve(here, '../../../../fixtures');

let out: string;

beforeEach(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-'));
});

afterEach(async () => {
  await fs.rm(out, { recursive: true, force: true });
});

// Asserts the folder exists with exactly this casing. Reading the path directly
// would resolve case-insensitively on macOS and Windows, so a wrong-cased folder
// like "Ordershipped" passes locally and only fails on Linux CI. readdir returns
// the name as actually stored.
async function expectExactPath(rel: string): Promise<void> {
  const segments = rel.split('/');
  let dir = out;

  for (const segment of segments) {
    expect(await fs.readdir(dir)).toContain(segment);
    dir = path.join(dir, segment);
  }
}

async function manifest(rel: string): Promise<EventFrontmatter> {
  await expectExactPath(rel);

  return eventFrontmatter.parse(
    JSON.parse(await fs.readFile(path.join(out, rel, 'autocatalog.json'), 'utf8')),
  );
}

describe('ac from-eventcatalog (executable story: the on-ramp)', () => {
  it('migrates an EventCatalog catalog into declared-provenance manifests', async () => {
    const exit = await runFromEventCatalog({
      source: path.join(fixtures, 'eventcatalog-sample'),
      out,
      quiet: true,
    });

    expect(exit).toBe(0);

    // domain-nested event keeps its domain, schema, badges, owner, narrative
    const payment = await manifest('payments/PaymentProcessed');
    expect(payment.provenance.default).toBe('declared');
    expect(payment.version).toBe('1.2.0');
    expect(payment.owner).toEqual({ team: 'billing-team' });
    expect(payment.badges?.[0]?.content).toBe('PCI');
    // producers/consumers reconstructed from the service's sends/receives
    expect(payment.producers).toEqual(['PaymentService']);

    const narrative = await fs.readFile(
      path.join(out, 'payments/PaymentProcessed/index.mdx'),
      'utf8',
    );

    expect(narrative).toContain('When it fires');
    expect(narrative).not.toContain('---'); // frontmatter stripped

    const schema = JSON.parse(
      await fs.readFile(path.join(out, 'payments/PaymentProcessed/schema.json'), 'utf8'),
    );

    expect(schema.required).toContain('paymentId');

    // top-level event without schema gets a placeholder and the consumer link
    const user = await manifest('userregistered/UserRegistered');
    expect(user.consumers).toEqual(['PaymentService']);
    // receives[].fields is what the consumer reads; from[] is the channel it reads on
    expect(user.consumerFields).toEqual({ PaymentService: ['userId', 'email'] });
    expect(user.transport).toEqual([
      { address: 'users.events', protocols: ['kafka'], deliveryMode: 'pull' },
    ]);

    const userSchema = JSON.parse(
      await fs.readFile(path.join(out, 'userregistered/UserRegistered/schema.json'), 'utf8'),
    );

    expect(userSchema.description).toContain('Placeholder');

    // versioned history comes along
    const legacy = await manifest('userregistered/UserRegistered/versioned/0.1.0');
    expect(legacy.version).toBe('0.1.0');
  });

  it('imported catalog passes validation', async () => {
    await runFromEventCatalog({
      source: path.join(fixtures, 'eventcatalog-sample'),
      out,
      quiet: true,
    });
    const { validateCatalog } = await import('autocatalog-core');
    const result = await validateCatalog(out);
    expect(result.errors).toEqual([]);
  });
});

describe('ac from-asyncapi', () => {
  it('imports an AsyncAPI 2.x document with resolved refs and examples', async () => {
    const exit = await runFromAsyncApi({
      file: path.join(fixtures, 'asyncapi-sample/streetlights-v2.yml'),
      out,
      quiet: true,
    });

    expect(exit).toBe(0);

    const measured = await manifest('lighting/LightMeasured');
    expect(measured.provenance.default).toBe('declared');
    // subscribe = the app publishes → app is the producer
    expect(measured.producers).toEqual(['StreetlightsService']);
    // a channel naming no servers travels on every server
    expect(measured.transport).toEqual([{ address: 'lighting/measured', protocols: ['mqtt'] }]);

    const schema = JSON.parse(
      await fs.readFile(path.join(out, 'lighting/LightMeasured/schema.json'), 'utf8'),
    );

    expect(schema.required).toEqual(['lumens', 'sensorId']); // $ref resolved

    const example = JSON.parse(
      await fs.readFile(path.join(out, 'lighting/LightMeasured/examples/bright.json'), 'utf8'),
    );

    expect(example.lumens).toBe(1200);

    // publish = others publish to the app → app is the consumer
    const dim = await manifest('lighting/DimLight');
    expect(dim.consumers).toEqual(['StreetlightsService']);
  });

  it('imports an AsyncAPI 3.x document via operations', async () => {
    const exit = await runFromAsyncApi({
      file: path.join(fixtures, 'asyncapi-sample/orders-v3.yml'),
      out,
      quiet: true,
    });

    expect(exit).toBe(0);
    const shipped = await manifest('orders/OrderShipped');
    expect(shipped.producers).toEqual(['OrdersService']);
    expect(shipped.version).toBe('2.1.0');
    expect(shipped.transport).toEqual([{ address: 'orders/events', protocols: ['kafka'] }]);
  });

  it('both imports validate cleanly', async () => {
    await runFromAsyncApi({
      file: path.join(fixtures, 'asyncapi-sample/streetlights-v2.yml'),
      out,
      quiet: true,
    });
    const { validateCatalog } = await import('autocatalog-core');
    const result = await validateCatalog(out);
    expect(result.errors).toEqual([]);
  });
});
