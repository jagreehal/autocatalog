import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jsonObjectSchema } from '../src/json';
import { discoverAvro, eventFromAvroSchema, idFromAvroName } from '../src/scan-avro';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'avro-scan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const record = {
  type: 'record' as const,
  name: 'PaymentCompleted',
  namespace: 'com.acme.payments',
  doc: 'Fires when a payment completes.',
  fields: [
    { name: 'paymentId', type: 'string' },
    { name: 'amount', type: 'double' },
    { name: 'note', type: ['null', 'string'] },
    { name: 'retries', type: 'int', default: 0 },
    { name: 'currency', type: { type: 'enum', name: 'Currency', symbols: ['GBP', 'USD'] } },
    { name: 'tags', type: { type: 'array', items: 'string' } },
    { name: 'createdAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
  ],
};

describe('eventFromAvroSchema', () => {
  const { event } = eventFromAvroSchema(record, 'schemas/payment.avsc');

  it('derives a dotted id from the record name and a domain from the namespace', () => {
    expect(event.id).toBe('payment.completed');
    expect(event.domain).toBe('payments');
  });

  it('maps Avro types to their JSON Schema equivalents', () => {
    const props = jsonObjectSchema.parse(event.schema.properties);
    expect(props.paymentId).toEqual({ type: 'string' });
    expect(props.amount).toEqual({ type: 'number' });
    expect(props.currency).toEqual({ type: 'string', enum: ['GBP', 'USD'] });
    expect(props.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(props.createdAt).toEqual({ type: 'integer', format: 'date-time' });
  });

  it('treats a null union as optional and unwraps it to the real type', () => {
    const props = jsonObjectSchema.parse(event.schema.properties);
    expect(props.note).toEqual({ type: 'string' });
    expect(event.schema.required).not.toContain('note');
  });

  it('treats a field with a default as optional', () => {
    expect(event.schema.required).not.toContain('retries');
    // `tags` is required despite being an array: Avro has no implicit default,
    // so a field without one must be written. (Protobuf differs — repeated
    // fields there default to empty.)
    expect(event.schema.required).toEqual(['paymentId', 'amount', 'currency', 'tags', 'createdAt']);
  });

  it('marks an undeclared record as needing review', () => {
    expect(event.needsReview).toBe(true);
    expect(event.provenance?.default).toBe('inferred');
  });

  it('takes declared metadata from x-autocatalog', () => {
    const declared = {
      ...record,
      'x-autocatalog': { id: 'payment.settled', version: '3.1.0', domain: 'ledger' },
    };

    const { event: e } = eventFromAvroSchema(declared, 'schemas/payment.avsc');
    expect(e.id).toBe('payment.settled');
    expect(e.domain).toBe('ledger');
    expect(e.needsReview).toBe(false);
  });

  it('terminates on a self-referencing record', () => {
    const recursive = {
      type: 'record' as const,
      name: 'Node',
      fields: [
        { name: 'value', type: 'string' },
        { name: 'child', type: ['null', 'Node'] },
      ],
    };

    const { event: e } = eventFromAvroSchema(recursive, 'node.avsc');
    const child = jsonObjectSchema.parse(jsonObjectSchema.parse(e.schema.properties).child);
    expect(child.description).toContain('recursive');
  });
});

describe('idFromAvroName', () => {
  it('strips the namespace and splits camel case', () => {
    expect(idFromAvroName('com.acme.OrderPlaced')).toBe('order.placed');
    expect(idFromAvroName('payment_refunded')).toBe('payment.refunded');
  });
});

describe('discoverAvro', () => {
  it('reads .avsc files and ignores JSON that is not an Avro record', async () => {
    await fs.writeFile(path.join(root, 'payment.avsc'), JSON.stringify(record));
    await fs.writeFile(path.join(root, 'other.json'), JSON.stringify(record));
    await fs.writeFile(path.join(root, 'union.avsc'), JSON.stringify(['null', 'string']));

    const result = await discoverAvro({ root });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.id)).toEqual(['payment.completed']);
    expect(result.events[0]!.source?.file).toBe('payment.avsc');
  });

  it('reports a malformed file instead of failing the scan', async () => {
    await fs.writeFile(path.join(root, 'broken.avsc'), '{ not json');
    const result = await discoverAvro({ root });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('broken.avsc');
  });
});
