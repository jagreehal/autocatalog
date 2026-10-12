import { describe, expect, it } from 'vitest';
import {
  importConfluentRegistry,
  importGlueRegistry,
  registryJsonSchema,
} from '../src/schema-registries';
import { resourceSchema } from '../src/resource-drift';
import type { JsonValue } from '../src/json';

describe('schema registries', () => {
  it('imports every native version and preserves references and registry identity', async () => {
    const nativeSchema = JSON.stringify({
      type: 'object',
      properties: { amount: { type: 'number' } },
    });

    const imported = await importConfluentRegistry(
      {
        listSubjects: async () => ['statements-value'],
        listVersions: async () => [1, 2],
        getVersion: async (subject, version) => ({
          subject,
          version,
          id: 100 + version,
          schemaType: 'JSON',
          schema: nativeSchema,
          references: version === 2 ? [{ name: 'money.json', subject: 'money', version: 1 }] : [],
        }),
        getCompatibility: async () => 'BACKWARD',
      },
      { id: 'acme-kafka', url: 'https://registry.example', subjects: ['statements-value'] },
    );

    expect(imported.resources).toHaveLength(2);
    expect(imported.resources[1]).toMatchObject({
      ref: { kind: 'event', namespace: 'acme-kafka', id: 'statements-value', version: '2' },
      attributes: {
        registry: {
          provider: 'confluent',
          id: 'acme-kafka',
          schemaId: 102,
          nativeVersion: '2',
          compatibility: 'BACKWARD',
          references: [{ name: 'money.json', subject: 'money', version: 1 }],
        },
        nativeSchema,
      },
    });
    expect(resourceSchema(imported.resources[0]!)).toEqual({
      type: 'object',
      properties: { amount: { type: 'number' } },
    });
  });
  it('imports paginated Glue schemas with native schema version IDs and Avro contracts', async () => {
    const tokens: Array<string | undefined> = [];

    const graph = await importGlueRegistry(
      {
        listSchemas: async (token): Promise<JsonValue> => {
          tokens.push(token);

          return token
            ? { Schemas: [] }
            : {
                Schemas: [
                  {
                    SchemaArn: 'arn:aws:glue:eu-west-1:123:schema/acme/statement',
                    SchemaName: 'statement',
                  },
                ],
                NextToken: 'next',
              };
        },
        getSchema: async () => ({ DataFormat: 'AVRO', Compatibility: 'BACKWARD_ALL' }),
        listVersions: async () => ({
          Schemas: [
            { VersionNumber: 1, Status: 'AVAILABLE' },
            { VersionNumber: 2, Status: 'FAILURE' },
          ],
        }),
        getVersion: async () => ({
          SchemaVersionId: 'version-uuid',
          VersionNumber: 1,
          DataFormat: 'AVRO',
          SchemaDefinition: JSON.stringify({
            type: 'record',
            name: 'Statement',
            fields: [{ name: 'amount', type: 'double' }],
          }),
        }),
      },
      { id: 'acme-glue', registry: 'acme' },
    );

    expect(tokens).toEqual([undefined, 'next']);
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0]).toMatchObject({
      ref: { kind: 'event', namespace: 'acme-glue', id: 'statement', version: '1' },
      attributes: {
        registry: {
          provider: 'glue',
          schemaVersionId: 'version-uuid',
          compatibility: 'BACKWARD_ALL',
        },
        payloadSchema: { type: 'object', properties: { amount: { type: 'number' } } },
      },
    });
  });
  it('resolves referenced JSON schemas into a self-contained payload contract', async () => {
    const graph = await importConfluentRegistry(
      {
        listSubjects: async () => ['statements-value'],
        listVersions: async () => [1],
        getCompatibility: async () => 'BACKWARD',
        getVersion: async (subject, version) =>
          subject === 'money'
            ? {
                subject,
                version,
                id: 2,
                schemaType: 'JSON',
                schema: '{"type":"number","minimum":0}',
                references: [],
              }
            : {
                subject,
                version,
                id: 1,
                schemaType: 'JSON',
                schema: '{"type":"object","properties":{"amount":{"$ref":"money.json"}}}',
                references: [{ name: 'money.json', subject: 'money', version: 1 }],
              },
      },
      { id: 'acme-kafka' },
    );

    const schema = resourceSchema(graph.resources[0]!);
    expect(schema).toMatchObject({
      properties: { amount: { $ref: '#/$defs/money~1v1' } },
      $defs: { 'money/v1': { type: 'number', minimum: 0 } },
    });
  });
  it('resolves named Avro records from registry references', async () => {
    const graph = await importConfluentRegistry(
      {
        listSubjects: async () => ['statement'],
        listVersions: async () => [1],
        getCompatibility: async () => 'BACKWARD',
        getVersion: async (subject, version) => ({
          subject,
          version,
          id: 1,
          schemaType: 'AVRO',
          schema: JSON.stringify(
            subject === 'money'
              ? { type: 'record', name: 'Money', fields: [{ name: 'value', type: 'double' }] }
              : { type: 'record', name: 'Statement', fields: [{ name: 'amount', type: 'Money' }] },
          ),
          references: subject === 'money' ? [] : [{ name: 'Money', subject: 'money', version: 1 }],
        }),
      },
      { id: 'acme-kafka' },
    );

    expect(resourceSchema(graph.resources[0]!)).toMatchObject({
      properties: { amount: { type: 'object', properties: { value: { type: 'number' } } } },
    });
  });
  it('resolves Protobuf imports from referenced subjects', async () => {
    const graph = await importConfluentRegistry(
      {
        listSubjects: async () => ['statement'],
        listVersions: async () => [1],
        getCompatibility: async () => 'BACKWARD',
        getVersion: async (subject, version) => ({
          subject,
          version,
          id: 1,
          schemaType: 'PROTOBUF',
          schema:
            subject === 'money'
              ? 'syntax = "proto3"; package money; message Money { double value = 1; }'
              : 'syntax = "proto3"; package billing; import "money.proto"; message Statement { money.Money amount = 1; }',
          references:
            subject === 'money' ? [] : [{ name: 'money.proto', subject: 'money', version: 1 }],
        }),
      },
      { id: 'acme-kafka' },
    );

    expect(resourceSchema(graph.resources[0]!)).toMatchObject({
      properties: { amount: { type: 'object', properties: { value: { type: 'number' } } } },
    });
  });

  const paid =
    'syntax = "proto3"; package billing; import "google/protobuf/timestamp.proto"; import "google/protobuf/struct.proto"; message Paid { string id = 1; google.protobuf.Timestamp at = 2; google.protobuf.Struct meta = 3; }';

  const protobufRegistry = (schemas: Record<string, string>) => ({
    listSubjects: async () => Object.keys(schemas),
    listVersions: async () => [1],
    getCompatibility: async () => 'BACKWARD',
    getVersion: async (subject: string, version: number) => ({
      subject,
      version,
      id: 1,
      schemaType: 'PROTOBUF',
      schema: schemas[subject]!,
      references:
        subject === 'with-reference' ? [{ name: 'money.proto', subject: 'money', version: 1 }] : [],
    }),
  });

  it('resolves Protobuf well-known types without a registry reference', async () => {
    expect(registryJsonSchema(paid, 'PROTOBUF')).toMatchObject({
      properties: {
        id: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
        meta: { type: 'object' },
      },
    });

    const graph = await importConfluentRegistry(
      protobufRegistry({
        money: 'syntax = "proto3"; package money; message Money { double value = 1; }',
        'with-reference': paid
          .replace('import "google/protobuf/struct.proto";', 'import "money.proto";')
          .replace('google.protobuf.Struct meta = 3;', 'money.Money meta = 3;'),
      }),
      { id: 'acme-kafka', subjects: ['with-reference'] },
    );

    expect(resourceSchema(graph.resources[0]!)).toMatchObject({
      properties: {
        at: { type: 'string', format: 'date-time' },
        meta: { type: 'object', properties: { value: { type: 'number' } } },
      },
    });
  });

  it('reports a subject that does not translate and imports the rest', async () => {
    const registry = protobufRegistry({
      broken: 'syntax = "proto3"; package billing; message Broken { Missing value = 1; }',
      paid,
    });

    const errors: string[] = [];

    const graph = await importConfluentRegistry(registry, {
      id: 'acme-kafka',
      onSubjectError: (message) => errors.push(message),
    });

    expect(graph.resources.map((resource) => resource.ref.id)).toEqual(['paid']);
    expect(errors).toEqual(["broken@1: no such Type or Enum 'Missing' in Type .billing.Broken"]);
    await expect(importConfluentRegistry(registry, { id: 'acme-kafka' })).rejects.toThrow(
      "broken@1: no such Type or Enum 'Missing' in Type .billing.Broken",
    );
  });
});
