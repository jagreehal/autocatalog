import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compatibilityBreaks, summariseDrift } from '../src/drift';
import type { JsonObject } from '../src/json';
import { driftOpenApi } from '../src/openapi-drift';

let baseDir: string;

let currDir: string;

const spec = (paths: JsonObject, schemas: JsonObject = {}) => ({
  openapi: '3.0.3',
  info: { title: 'Payments', version: '1.0.0' },
  paths,
  components: { schemas },
});

const create = (bodyRef: string, response: JsonObject) => ({
  '/payments': {
    post: {
      operationId: 'createPayment',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: bodyRef } } },
      },
      responses: { '201': { content: { 'application/json': { schema: response } } } },
    },
  },
});

async function write(root: string, doc: JsonObject): Promise<void> {
  await fs.mkdir(path.join(root, 'contracts'), { recursive: true });
  await fs.writeFile(path.join(root, 'contracts', 'openapi.json'), JSON.stringify(doc));
}

const body = (field: string) => ({
  type: 'object',
  properties: { [field]: { type: 'number' }, currency: { type: 'string' } },
  required: [field, 'currency'],
  additionalProperties: false,
});

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-api-base-'));
  currDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-api-curr-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.rm(currDir, { recursive: true, force: true });
});

describe('driftOpenApi', () => {
  it('names the operation and the request field a rename moves, through a component $ref', async () => {
    const ref = '#/components/schemas/CreatePaymentBody';
    await write(baseDir, spec(create(ref, {}), { CreatePaymentBody: body('amount') }));
    await write(currDir, spec(create(ref, {}), { CreatePaymentBody: body('value') }));

    const findings = await driftOpenApi(baseDir, currDir);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      domain: 'contracts/openapi.json',
      eventId: 'POST /payments (createPayment)',
      kind: 'field_renamed',
      severity: 'breaking',
      consumers: [],
      message: 'request: field `body.amount` (number) looks renamed to `body.value`',
    });
    expect(compatibilityBreaks(summariseDrift(findings), 'backward').length).toBeGreaterThan(0);
  });

  it('grades by who reads: a tightened request and a widened response break, the mirrors do not', async () => {
    const op = (request: JsonObject, response: JsonObject) => ({
      '/limits': {
        put: {
          parameters: [{ in: 'query', name: 'n', schema: request }],
          responses: { '200': { content: { 'application/json': { schema: response } } } },
        },
      },
    });

    await write(baseDir, spec(op({ type: 'integer', maximum: 10 }, { enum: ['a', 'b'] })));
    await write(currDir, spec(op({ type: 'integer', maximum: 5 }, { enum: ['a', 'b', 'c'] })));
    const tightened = await driftOpenApi(baseDir, currDir);

    expect(tightened.map((f) => [f.message.split(':')[0], f.severity])).toEqual([
      ['request', 'breaking'],
      ['response', 'breaking'],
    ]);

    // The gate asks the same question in API terms: both changes break existing
    // clients (BACKWARD), and neither stops new clients working against the old API.
    expect(compatibilityBreaks(summariseDrift(tightened), 'backward')).toHaveLength(2);
    expect(compatibilityBreaks(summariseDrift(tightened), 'forward')).toHaveLength(0);

    const loosened = await driftOpenApi(currDir, baseDir);

    expect(loosened.every((f) => f.severity === 'additive')).toBe(true);
    expect(compatibilityBreaks(summariseDrift(loosened), 'backward')).toHaveLength(0);
    expect(compatibilityBreaks(summariseDrift(loosened), 'forward')).toHaveLength(2);
  });

  it('reports a removed operation as breaking', async () => {
    await write(baseDir, spec(create('#/components/schemas/B', {}), { B: body('amount') }));
    await write(currDir, spec({}));

    expect(await driftOpenApi(baseDir, currDir)).toMatchObject([
      {
        kind: 'operation_removed',
        severity: 'breaking',
        eventId: 'POST /payments (createPayment)',
      },
    ]);
  });

  it('annotates the changed line of a YAML document, and accepts a major info.version bump', async () => {
    const yaml = (version: string, field: string) =>
      [
        'openapi: 3.1.0',
        'info:',
        '  title: Orders',
        `  version: ${version}`,
        'paths:',
        '  /orders/{id}:',
        '    get:',
        '      operationId: getOrder',
        '      responses:',
        "        '200':",
        '          description: ok',
        '          content:',
        '            application/json:',
        '              schema:',
        '                type: object',
        '                properties:',
        '                  id: { type: string }',
        `                  ${field}: { type: number }`,
      ].join('\n');

    await fs.writeFile(path.join(baseDir, 'openapi.yaml'), yaml('1.0.0', 'total'));
    await fs.writeFile(path.join(currDir, 'openapi.yaml'), yaml('1.0.0', 'amountDue'));
    const [renamed] = await driftOpenApi(baseDir, currDir);

    expect(renamed).toMatchObject({
      kind: 'field_renamed',
      source: { file: 'openapi.yaml', line: 18 },
      advice:
        'Next: keep `200.total` alongside `200.amountDue` until clients move off it, or bump info.version to 2.0.0 to mark it intentional and notify its clients',
    });

    await fs.writeFile(path.join(currDir, 'openapi.yaml'), yaml('2.0.0', 'amountDue'));
    const [acknowledged] = await driftOpenApi(baseDir, currDir);

    expect(acknowledged).toMatchObject({ kind: 'field_renamed', acknowledged: true });
  });
});
