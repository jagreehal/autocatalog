import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { correlationPath } from '../src/correlation';
import { scoreEvent } from '../src/health';
import type { JsonObject, JsonValue } from '../src/json';
import { exampleCaseOf, loadCatalog } from '../src/load';
import { validateCatalog } from '../src/validate';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-example-cases-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const schema: JsonObject = {
  type: 'object',
  required: ['orderId', 'total'],
  properties: { orderId: { type: 'string' }, total: { type: 'number' } },
};

/** One event folder: manifest overrides, schema, and example files by path under examples/. */
async function event(
  examples: Record<string, JsonValue>,
  manifest: JsonObject = {},
  eventSchema: JsonObject = schema,
  /** Files written as they are, such as an examples.config.yaml. */
  files: Record<string, string> = {},
): Promise<void> {
  const dir = path.join(root, 'orders', 'OrderPlaced');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'autocatalog.json'),
    JSON.stringify({
      id: 'order.placed',
      version: '1.0.0',
      name: 'Order placed',
      summary: 's',
      ...manifest,
    }),
  );
  await fs.writeFile(path.join(dir, 'schema.json'), JSON.stringify(eventSchema));

  const write = async (file: string, text: string) => {
    const target = path.join(dir, 'examples', file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  };

  for (const [file, data] of Object.entries(examples)) await write(file, JSON.stringify(data));

  for (const [file, text] of Object.entries(files)) await write(file, text);
}

const happy = { orderId: 'o1', total: 10 };

describe('example cases', () => {
  it('reads the case from the folder an example sits in, as EventCatalog nests them', async () => {
    await event({
      'placed.json': happy,
      'duplicate/redelivered.json': happy,
      'late/after-outage.json': happy,
      'regional/eu.json': happy,
    });

    const [loaded] = await loadCatalog(root);

    expect(loaded?.examples.map((e) => [e.name, e.case])).toEqual([
      ['redelivered', 'duplicate'],
      ['after-outage', 'late'],
      ['placed', undefined],
      // A folder that is not a case is only a folder.
      ['eu', undefined],
    ]);
  });

  it('takes titles and summaries from EventCatalog’s examples.config.yaml', async () => {
    await event({ 'placed.json': happy, 'duplicate/redelivered.json': happy }, {}, schema, {
      'examples.config.yaml': [
        'duplicate/redelivered.json:',
        '  name: Redelivered after a timeout',
        '  summary: The broker gave up waiting for an ack and sent it again.',
        '',
      ].join('\n'),
    });

    const [loaded] = await loadCatalog(root);

    expect(loaded?.examples.find((e) => e.name === 'redelivered')).toMatchObject({
      title: 'Redelivered after a timeout',
      summary: 'The broker gave up waiting for an ack and sent it again.',
    });
    expect(loaded?.examples.find((e) => e.name === 'placed')?.title).toBeUndefined();
  });

  it('reads EventCatalog’s JSON config as metadata, never as an example', async () => {
    await event({ 'placed.json': happy }, {}, schema, {
      'examples.config.json': JSON.stringify({ 'placed.json': { name: 'A placed order' } }),
    });

    const [loaded] = await loadCatalog(root);

    expect(loaded?.examples.map((e) => [e.name, e.title])).toEqual([['placed', 'A placed order']]);
  });

  it('allows the same name in different case folders', async () => {
    await event({ 'sample.json': happy, 'duplicate/sample.json': happy });

    expect((await loadCatalog(root))[0]?.examples.map((e) => [e.name, e.case])).toEqual([
      ['sample', 'duplicate'],
      ['sample', undefined],
    ]);
  });

  it('requires an invalid example to fail the schema, since it shows what consumers must reject', async () => {
    await event({
      'placed.json': happy,
      'invalid/missing-total.json': { orderId: 'o1' },
      'invalid/looks-fine.json': happy,
    });

    const result = await validateCatalog(root);

    expect(result.errors.map((e) => [e.code, e.message])).toEqual([
      [
        'invalid_example_is_valid',
        'Example "looks-fine" is under examples/invalid/ but the schema accepts it, so it shows nothing a consumer must reject',
      ],
    ]);
  });

  it('checks a duplicate repeats another example’s idempotency key', async () => {
    const delivery = { guarantee: 'at-least-once', idempotencyKey: 'orderId' };

    await event(
      {
        'placed.json': happy,
        'duplicate/redelivered.json': happy,
        'duplicate/stranger.json': { orderId: 'o9', total: 10 },
        // Repeating a message the schema rejects is not repeating a real one.
        'invalid/no-total.json': { orderId: 'o9' },
      },
      { delivery },
    );

    const result = await validateCatalog(root);

    expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'duplicate_example_unmatched',
        'Duplicate example "stranger" has idempotency key orderId "o9", which no other example has, so it is not a repeat of anything',
      ],
    ]);
  });

  it('asks for an idempotency key when there is a duplicate example to recognise', async () => {
    await event({ 'placed.json': happy, 'duplicate/redelivered.json': happy });

    const result = await validateCatalog(root);

    expect(result.warnings.map((w) => w.message)).toEqual([
      'Duplicate example "redelivered" has no delivery.idempotencyKey to recognise it by',
    ]);
  });
});

describe('exampleCaseOf', () => {
  it('reads a case only from a folder, never from a bare name', () => {
    expect(
      ['empty/no-lines.json', 'empty', 'empty.json', 'regional/eu.json'].map(exampleCaseOf),
    ).toEqual(['empty', undefined, undefined, undefined]);
  });
});

describe('correlation', () => {
  const fields = (properties: JsonObject, required: string[] = []): JsonObject => ({
    type: 'object',
    required,
    properties,
  });

  async function loaded(manifest: JsonObject, eventSchema: JsonObject) {
    await event({}, manifest, eventSchema);

    return (await loadCatalog(root))[0]!;
  }

  it('finds a correlation field by its common names, nested or not', async () => {
    for (const [properties, expected] of [
      [{ correlationId: { type: 'string' } }, 'correlationId'],
      [{ meta: fields({ trace_id: { type: 'string' } }, ['trace_id']) }, 'meta.trace_id'],
      [{ traceparent: { type: 'string' } }, 'traceparent'],
      [{ causationId: { type: 'string' } }, 'causationId'],
      [{ orderId: { type: 'string' } }, undefined],
      // One per item is several, not one per journey.
      [{ items: { type: 'array', items: fields({ traceId: { type: 'string' } }) } }, undefined],
      // The shallowest wins: the envelope's, not one a nested object repeats.
      [
        {
          context: fields({ correlationId: { type: 'string' } }),
          correlationId: { type: 'string' },
        },
        'correlationId',
      ],
    ] as const) {
      await fs.rm(root, { recursive: true, force: true });
      expect(correlationPath(await loaded({}, fields(properties)))).toBe(expected);
    }
  });

  it('prefers the declared key over a guess', async () => {
    const event = await loaded(
      { delivery: { correlationKey: 'journeyRef' } },
      fields({ journeyRef: { type: 'string' }, traceId: { type: 'string' } }),
    );

    expect(correlationPath(event)).toBe('journeyRef');
  });
});

describe('health for the cross-domain playbook', () => {
  const check = (score: ReturnType<typeof scoreEvent>, name: string) =>
    score.checks.find((c) => c.name === name);

  it('asks at-least-once events for a duplicate example', async () => {
    await event(
      { 'placed.json': happy, 'late/after-outage.json': happy },
      {
        delivery: { guarantee: 'at-least-once', idempotencyKey: 'orderId' },
      },
    );

    const cases = check(scoreEvent((await loadCatalog(root))[0]!), 'example-cases');

    expect(cases).toMatchObject({ earned: false });
    expect(cases?.hint).toContain('examples/duplicate/');
  });

  it('earns the example check with any edge case when delivery promises nothing', async () => {
    await event({ 'placed.json': happy, 'empty/no-lines.json': happy });

    expect(check(scoreEvent((await loadCatalog(root))[0]!), 'example-cases')?.earned).toBe(true);
  });

  it('does not count a happy path alone as covering the cases', async () => {
    await event({ 'placed.json': happy });

    expect(check(scoreEvent((await loadCatalog(root))[0]!), 'example-cases')?.earned).toBe(false);
  });

  it('earns correlation from a field, or from a CloudEvents envelope', async () => {
    await event({}, { envelope: { type: 'cloudevents' } });
    expect(check(scoreEvent((await loadCatalog(root))[0]!), 'correlation')?.earned).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
    await event({});
    const missing = check(scoreEvent((await loadCatalog(root))[0]!), 'correlation');
    expect(missing?.earned).toBe(false);
    expect(missing?.hint).toContain('delivery.correlationKey');
  });

  it('still adds up to 100', async () => {
    await event({});

    expect(
      scoreEvent((await loadCatalog(root))[0]!).checks.reduce((sum, c) => sum + c.points, 0),
    ).toBe(100);
  });

  it('validates a declared correlation key like the other delivery keys', async () => {
    await event({}, { delivery: { correlationKey: 'journeyRef' } });

    expect((await validateCatalog(root)).errors.map((e) => e.message)).toEqual([
      'The correlation key "journeyRef" is not in the schema, so consumers cannot use it',
    ]);
  });
});
