import { describe, expect, it } from 'vitest';
import { decodeCloudEvent, validateCloudEvent } from '../src/cloudevents';
import { publishCatalog } from '../src/publish-catalog';
import type { JsonValue } from '../src/json';
import { validateCatalog } from '../src/validate';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('CloudEvents envelopes', () => {
  it('reads the payload schema in the dialect it declares, as ac validate does', () => {
    const envelope = (pair: JsonValue) => ({
      specversion: '1.0',
      id: 'm1',
      source: '/orders',
      type: 'order.placed',
      data: { pair },
    });

    for (const $schema of [
      'http://json-schema.org/draft-06/schema#',
      'https://json-schema.org/draft/2019-09/schema',
    ]) {
      const schema = {
        $schema,
        type: 'object',
        properties: { pair: { type: 'array', items: [{ type: 'string' }, { type: 'number' }] } },
      };

      expect(validateCloudEvent(envelope(['a', 1]), schema), $schema).toEqual([]);
      expect(validateCloudEvent(envelope(['a', 'b']), schema), $schema).not.toEqual([]);
    }
  });

  it('validates structured and binary envelopes independently from the payload contract', () => {
    const payloadSchema = {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    };

    const structured = {
      specversion: '1.0',
      id: 'message-1',
      source: '/billing',
      type: 'statement.generated',
      dataschema: 'https://schemas.example/statement/1',
      data: { amount: 42 },
    };

    expect(decodeCloudEvent(structured)).toMatchObject({
      mode: 'structured',
      context: { id: 'message-1', type: 'statement.generated' },
      payload: { amount: 42 },
    });
    expect(validateCloudEvent(structured, payloadSchema)).toEqual([]);
    expect(
      decodeCloudEvent(
        { amount: 42 },
        {
          'Ce-Specversion': '1.0',
          'Ce-Id': 'message-1',
          'Ce-Source': '/billing',
          'Ce-Type': 'statement.generated',
          'Content-Type': 'application/json',
        },
      ),
    ).toMatchObject({ mode: 'binary', payload: { amount: 42 } });
    expect(
      validateCloudEvent({ ...structured, data: { amount: 'wrong' } }, payloadSchema),
    ).toContainEqual(
      expect.objectContaining({ code: 'cloudevents_payload_invalid', path: '/amount' }),
    );
    expect(validateCloudEvent({ ...structured, specversion: '0.3' }, payloadSchema)).toContainEqual(
      expect.objectContaining({ code: 'cloudevents_envelope_invalid' }),
    );
    expect(() => decodeCloudEvent({ ...structured, data_base64: 'e30=' })).toThrow();
  });
  describe('envelope attributes', () => {
    const payloadSchema = { type: 'object' };

    const structured = {
      specversion: '1.0',
      id: 'message-1',
      source: '/billing',
      type: 'statement.generated',
      data: {},
    };

    const headers = {
      'ce-specversion': '1.0',
      'ce-id': 'message-1',
      'ce-source': '/billing',
      'ce-type': 'statement.generated',
    };

    it('names the attribute that is invalid', () => {
      const { id: _id, ...withoutId } = structured;

      expect(validateCloudEvent({ ...withoutId, specversion: '0.3' }, payloadSchema)).toEqual([
        {
          code: 'cloudevents_envelope_invalid',
          path: 'specversion',
          message: 'CloudEvents attribute `specversion` is invalid: Invalid input: expected "1.0"',
        },
        {
          code: 'cloudevents_envelope_invalid',
          path: 'id',
          message:
            'CloudEvents attribute `id` is invalid: Invalid input: expected string, received undefined',
        },
      ]);
    });

    it('accepts lower-case alphanumeric extensions with scalar values', () => {
      expect(
        decodeCloudEvent({ ...structured, tenant: 'acme', retries: 2, replay: false }).context,
      ).toMatchObject({ tenant: 'acme', retries: 2, replay: false });
      expect(
        validateCloudEvent({ ...structured, averyveryverylongextensionname: 'x' }, payloadSchema),
      ).toEqual([]);
    });

    it('refuses extension names outside a-z0-9 and non-scalar extension values', () => {
      expect(
        validateCloudEvent(
          { ...structured, Tenant: 'acme', trace_id: 'x', routing: { region: 'eu' } },
          payloadSchema,
        ),
      ).toEqual([
        {
          code: 'cloudevents_envelope_invalid',
          path: 'Tenant',
          message:
            'CloudEvents attribute `Tenant` is invalid: attribute names are lower-case letters and digits',
        },
        {
          code: 'cloudevents_envelope_invalid',
          path: 'trace_id',
          message:
            'CloudEvents attribute `trace_id` is invalid: attribute names are lower-case letters and digits',
        },
        {
          code: 'cloudevents_envelope_invalid',
          path: 'routing',
          message:
            'CloudEvents attribute `routing` is invalid: extension values are strings, numbers or booleans',
        },
      ]);
    });

    it('percent-decodes binary header values', () => {
      expect(
        decodeCloudEvent({}, { ...headers, 'ce-subject': 'caf%C3%A9 %22menu%22' }).context.subject,
      ).toBe('café "menu"');
      expect(
        validateCloudEvent({}, payloadSchema, { ...headers, 'ce-subject': '%E0%A4%A' }),
      ).toEqual([
        {
          code: 'cloudevents_envelope_invalid',
          path: 'subject',
          message: 'CloudEvents attribute `subject` is invalid: not percent-encoded',
        },
      ]);
    });

    it('validates in the declared mode', () => {
      expect(validateCloudEvent(structured, payloadSchema, undefined, 'binary')).toEqual([
        {
          code: 'cloudevents_envelope_invalid',
          message: 'CloudEvents binary mode is declared, but no ce- headers were supplied',
        },
      ]);
      expect(validateCloudEvent({}, payloadSchema, headers, 'binary')).toEqual([]);
      expect(validateCloudEvent(structured, payloadSchema, headers, 'structured')).toEqual([]);
      expect(
        validateCloudEvent({ amount: 1 }, payloadSchema, headers, 'structured').map(
          (finding) => finding.path,
        ),
      ).toEqual(['specversion', 'id', 'source', 'type']);
    });
  });

  it('publishes an envelope declaration and validates structured event examples against its payload', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cloud-contract-'));

    try {
      await publishCatalog({
        outRoot: root,
        events: [
          {
            id: 'statement.generated',
            version: '1.0.0',
            name: 'Statement generated',
            summary: 'Statement generated',
            domain: 'ledger',
            folderName: 'StatementGenerated',
            schema: {
              type: 'object',
              properties: { amount: { type: 'number' } },
              required: ['amount'],
            },
            meta: { envelope: { type: 'cloudevents', mode: 'structured', specversion: '1.0' } },
            examples: [
              {
                name: 'example',
                data: {
                  specversion: '1.0',
                  id: 'message-1',
                  type: 'statement.generated',
                  source: '/billing',
                  data: { amount: 42 },
                },
              },
            ],
          },
        ],
      });
      const validated = await validateCatalog(root);
      expect(validated.errors).toEqual([]);
      expect(validated.events[0]?.frontmatter).toMatchObject({
        envelope: { type: 'cloudevents', mode: 'structured', specversion: '1.0' },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
