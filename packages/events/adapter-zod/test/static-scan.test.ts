import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonObjectSchema, type JsonObject } from 'autocatalog-core';
import { z } from 'zod';
import { discoverZodEvents } from '../src/scanner';
import { staticExports } from '../src/static-scan';

const KEYWORDS = [
  'type',
  'format',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
] as const;

/** The keywords a consumer's validation depends on, from a schema. */
function bounds(schema: JsonObject): JsonObject {
  return Object.fromEntries(KEYWORDS.flatMap((k) => (k in schema ? [[k, schema[k]!]] : [])));
}

function scanned(expression: string): JsonObject {
  const [ex] = staticExports(
    `import { z } from 'zod';\nexport const PaidEvent = ${expression};`,
    'paid.ts',
  );

  return ex!.schema!.schema;
}

// Zod's own toJSONSchema is the oracle: reading source must say what running
// it would have said about every bound and format.
const CASES: [string, z.ZodType][] = [
  ['z.string().min(3).max(64)', z.string().min(3).max(64)],
  ['z.string().length(8)', z.string().length(8)],
  ['z.string().email()', z.string().email()],
  ['z.string().uuid()', z.string().uuid()],
  ['z.string().url()', z.string().url()],
  ['z.string().datetime()', z.string().datetime()],
  ['z.email()', z.email()],
  ['z.uuid()', z.uuid()],
  ['z.number().min(0).max(100)', z.number().min(0).max(100)],
  ['z.number().gt(0).lt(10)', z.number().gt(0).lt(10)],
  ['z.number().positive()', z.number().positive()],
  ['z.number().nonnegative()', z.number().nonnegative()],
  ['z.number().negative()', z.number().negative()],
  ['z.number().multipleOf(5)', z.number().multipleOf(5)],
  ['z.number().int()', z.number().int()],
  ['z.number().int().min(1)', z.number().int().min(1)],
  ['z.int()', z.int()],
  ['z.array(z.string()).min(1).max(10)', z.array(z.string()).min(1).max(10)],
  ['z.array(z.string()).length(2)', z.array(z.string()).length(2)],
];

describe('static Zod extraction keeps what validation depends on', () => {
  it.each(CASES)('%s', (expression, runtime) => {
    expect(bounds(scanned(expression))).toEqual(
      bounds(jsonObjectSchema.parse(z.toJSONSchema(runtime))),
    );
  });

  it('keeps a pattern, and an implied one from startsWith', () => {
    expect(scanned('z.string().regex(/^[A-Z]{3}$/)').pattern).toBe('^[A-Z]{3}$');
    const implied = z.string().parse(scanned("z.string().startsWith('pay_')").pattern);
    expect(new RegExp(implied).test('pay_1')).toBe(true);
    expect(new RegExp(implied).test('refund_pay_1')).toBe(false);
  });

  it('flags a bound it cannot read rather than dropping it', () => {
    const [ex] = staticExports(
      "import { z } from 'zod';\nconst MAX = 10;\nexport const PaidEvent = z.string().max(MAX);",
      'paid.ts',
    );

    expect(ex!.schema!.limits).toEqual([
      { symbol: 'PaidEvent', reason: '.max() takes a value that is not a literal' },
    ]);
  });
});

describe('static Zod discovery', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-zod-static-'));
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  async function write(rel: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }

  it('finds a registry written as an array of event records', async () => {
    await write(
      'src/payments/events.ts',
      `import { z } from 'zod';
const Refunded = z.object({ id: z.string(), amount: z.number().positive() });
const failedSchema = { type: 'object', properties: { reason: { type: 'string' } } };
export const events = [
  { id: 'payment.refunded', version: '1.0.0', name: 'Refunded', summary: 'Money went back',
    schema: Refunded, examples: [{ name: 'default', data: { id: 'r1', amount: 5 } }] },
  { name: 'v1.payment.failed', description: 'A payment failed', schema: failedSchema },
];
export const notEvents = [{ label: 'nav' }];
`,
    );

    const { candidates, errors } = await discoverZodEvents({ root });

    expect(errors).toEqual([]);
    expect(candidates.map((c) => [c.finding.kind, c.event.id])).toEqual([
      ['registry', 'payment.refunded'],
      ['registry', 'payment.failed'],
    ]);
    const refunded = candidates[0]!.event;
    expect(refunded.schema).toMatchObject({
      properties: { amount: { type: 'number', exclusiveMinimum: 0 } },
    });
    expect(refunded.source).toMatchObject({ file: 'src/payments/events.ts', symbol: 'events' });
    expect(candidates[1]!.event.schema).toMatchObject({
      properties: { reason: { type: 'string' } },
    });
  });

  it('reads a numeric defineEvent version as the version it is', async () => {
    await write(
      'src/payments/paid.ts',
      `import { z } from 'zod';
import { defineEvent } from 'autocatalog-adapter-zod';
export const PaidEvent = defineEvent({ id: 'payment.paid', version: 1 }, z.object({ id: z.string() }));
`,
    );

    const { candidates, errors } = await discoverZodEvents({ root });

    expect(errors).toEqual([]);
    expect(candidates.map((c) => [c.event.id, c.event.version])).toEqual([['payment.paid', '1']]);
  });
});
