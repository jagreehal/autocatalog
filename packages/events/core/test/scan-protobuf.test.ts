import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverProtobuf, idFromMessageName } from '../src/scan-protobuf';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'proto-scan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const proto = `
syntax = "proto3";
package acme.payments;

message PaymentCompleted {
  string payment_id = 1;
  double amount = 2;
  optional string note = 3;
  repeated Item items = 4;
  Currency currency = 5;
  map<string, string> labels = 6;
  int64 sequence = 7;

  message Item { string sku = 1; }
  enum Currency { GBP = 0; USD = 1; }
}

message HealthRequest { string ping = 1; }
message HealthResponse { string pong = 1; }

service Health {
  rpc Check (HealthRequest) returns (HealthResponse);
}
`;

async function scan(source = proto): Promise<Awaited<ReturnType<typeof discoverProtobuf>>> {
  await fs.writeFile(path.join(root, 'payments.proto'), source);

  return discoverProtobuf({ root });
}

describe('discoverProtobuf', () => {
  it('maps a message to an event and skips RPC request/response types', async () => {
    const result = await scan();
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.id)).toEqual(['payment.completed']);
    expect(result.events[0]!.domain).toBe('payments');
  });

  it('maps proto3 field types through the canonical JSON mapping', async () => {
    const [event] = (await scan()).events;
    expect(event!.schema.properties).toEqual(
      expect.objectContaining({
        payment_id: { type: 'string' },
        amount: { type: 'number' },
        // 64-bit integers do not fit in JSON numbers, so proto3 JSON sends strings.
        sequence: { type: 'string', format: 'int64' },
        currency: { type: 'string', enum: ['GBP', 'USD'] },
        items: {
          type: 'array',
          items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
        },
        labels: { type: 'object', additionalProperties: { type: 'string' } },
      }),
    );
  });

  it('treats explicit `optional`, repeated and map fields as not guaranteed', async () => {
    const [event] = (await scan()).events;
    const required = event!.schema.required;
    expect(required).toContain('payment_id');
    expect(required).not.toContain('note');
    expect(required).not.toContain('items');
    expect(required).not.toContain('labels');
  });

  it('reads declared metadata from an autocatalog option', async () => {
    const result = await scan(`
      syntax = "proto3";
      package acme.orders;
      message OrderPlaced {
        option (autocatalog.id) = "order.placed";
        option (autocatalog.version) = "2.0.0";
        string order_id = 1;
      }
    `);

    const [event] = result.events;
    expect(event!.id).toBe('order.placed');
    expect(event!.version).toBe('2.0.0');
    expect(event!.needsReview).toBe(false);
    expect(event!.provenance?.default).toBe('extracted');
  });

  it('maps well-known types rather than emitting an empty schema', async () => {
    const result = await scan(`
      syntax = "proto3";
      package acme.orders;
      import "google/protobuf/timestamp.proto";
      message OrderPlaced {
        google.protobuf.Timestamp created_at = 1;
      }
    `);

    expect(result.events[0]!.schema.properties).toEqual(
      expect.objectContaining({ created_at: { type: 'string', format: 'date-time' } }),
    );
  });

  it('reports an unparseable proto instead of failing the scan', async () => {
    const result = await scan('syntax = "proto3"; message Broken {');
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain('payments.proto');
  });
});

describe('idFromMessageName', () => {
  it('splits camel case into a dotted id', () => {
    expect(idFromMessageName('PaymentCompleted')).toBe('payment.completed');
    expect(idFromMessageName('Order_Placed')).toBe('order.placed');
  });
});
