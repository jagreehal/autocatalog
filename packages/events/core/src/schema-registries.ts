import { z } from 'zod';
import { common, parse as parseProto, Root } from 'protobufjs';
import {
  jsonObjectSchema,
  jsonValueSchema,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from './json';
import { avroSchemaToJsonSchema } from './scan-avro';
import { eventsFromProtoRoot } from './scan-protobuf';
import { emptyResourceGraph } from './architecture';
import { getCatalogJson } from './ownership-sources';
import { type EventCatalogResource, type ResourceGraph } from './resource-graph';

const reference = z.object({
  name: z.string(),
  subject: z.string(),
  version: z.number().int().positive(),
});

const confluentVersion = z.object({
  subject: z.string(),
  version: z.number().int().positive(),
  id: z.number().int(),
  schema: z.string(),
  schemaType: z.enum(['JSON', 'AVRO', 'PROTOBUF']).default('AVRO'),
  references: z.array(reference).default([]),
});

export interface ConfluentRegistryClient {
  listSubjects(): Promise<JsonValue>;
  listVersions(subject: string): Promise<JsonValue>;
  getVersion(subject: string, version: number): Promise<JsonValue>;
  getCompatibility(subject: string): Promise<string>;
}

export interface RegistryImportOptions {
  id: string;
  url?: string;
  subjects?: string[];
  /**
   * Told about a subject version whose schema does not translate, which is then
   * left out. Without it the first such version stops the import.
   */
  onSubjectError?: (message: string) => void;
}

const WELL_KNOWN_PROTOS = [
  'any',
  'duration',
  'empty',
  'field_mask',
  'struct',
  'timestamp',
  'wrappers',
].map((name) => `google/protobuf/${name}.proto`);

/** A Root that knows the well-known types, which subjects import without registering a reference. */
function protoRoot(): Root {
  const root = new Root();

  for (const file of WELL_KNOWN_PROTOS) {
    const definition = common.get(file);

    if (definition) root.addJSON(definition.nested ?? {});
  }

  return root;
}

export function registryJsonSchema(nativeSchema: string, format: string): JsonObject {
  if (format === 'JSON') return jsonObjectSchema.parse(JSON.parse(nativeSchema));

  if (format === 'AVRO') {
    return avroSchemaToJsonSchema(jsonValueSchema.parse(JSON.parse(nativeSchema)));
  }

  if (format === 'PROTOBUF') {
    const parsed = parseProto(nativeSchema, protoRoot(), { keepCase: true });
    parsed.root.resolveAll();

    const schemas = eventsFromProtoRoot(parsed.root, parsed.package, 'registry.proto').map(
      (entry) => entry.event.schema,
    );

    if (!schemas.length) throw new Error('Registry Protobuf schema contains no payload messages');

    return schemas.length === 1 ? schemas[0]! : { oneOf: schemas };
  }

  throw new Error(`Unsupported registry schema format: ${format}`);
}

function registryResource(
  id: string,
  subject: string,
  version: string,
  nativeSchema: string,
  format: string,
  metadata: JsonObject,
  url?: string,
  payloadSchema?: JsonObject,
): EventCatalogResource {
  return {
    ref: { kind: 'event', namespace: id, id: subject, version },
    title: subject,
    tags: ['registry'],
    provenance: { default: 'extracted', fields: {} },
    needsReview: true,
    source: { type: 'url', schema: url },
    attributes: {
      domain: id,
      status: 'active',
      schema: 'schema.json',
      examples: 0,
      payloadSchema: payloadSchema ?? registryJsonSchema(nativeSchema, format),
      nativeSchema,
      schemaFormat: format,
      registry: metadata,
    },
  };
}

type ConfluentVersion = z.infer<typeof confluentVersion>;

/** One version's payload contract, with its references resolved. */
function confluentPayloadSchema(
  schema: ConfluentVersion,
  dependencies: Map<string, ConfluentVersion>,
): JsonObject {
  if (schema.schemaType === 'JSON' && dependencies.size)
    return bundleRegistryJsonSchema(schema, dependencies);

  if (schema.schemaType === 'AVRO')
    return avroSchemaToJsonSchema(
      jsonValueSchema.parse(JSON.parse(schema.schema)),
      [...dependencies.values()].map((child) => jsonValueSchema.parse(JSON.parse(child.schema))),
    );

  if (schema.schemaType !== 'PROTOBUF' || !dependencies.size)
    return registryJsonSchema(schema.schema, schema.schemaType);

  const root = protoRoot();

  for (const dependency of dependencies.values())
    parseProto(dependency.schema, root, { keepCase: true });

  const parsed = parseProto(schema.schema, root, { keepCase: true });

  root.resolveAll();

  const messages = eventsFromProtoRoot(root, parsed.package, 'registry.proto').map(
    (entry) => entry.event.schema,
  );

  return messages.length === 1 ? messages[0]! : { oneOf: messages };
}

/** Native registry versions are kept verbatim; no semantic version is invented. */
export async function importConfluentRegistry(
  client: ConfluentRegistryClient,
  options: RegistryImportOptions,
): Promise<ResourceGraph> {
  const graph = emptyResourceGraph();
  const subjects = options.subjects ?? z.array(z.string()).parse(await client.listSubjects());

  for (const subject of [...new Set(subjects)].sort()) {
    const versions = z.array(z.number().int().positive()).parse(await client.listVersions(subject));
    const compatibility = await client.getCompatibility(subject);

    for (const version of [...new Set(versions)].sort((a, b) => a - b)) {
      const schema = confluentVersion.parse(await client.getVersion(subject, version));

      if (schema.subject !== subject || schema.version !== version)
        throw new Error(`Registry version identity mismatch: ${subject}@${version}`);
      const dependencies = new Map<string, z.infer<typeof confluentVersion>>();

      const fetchReferences = async (parent: z.infer<typeof confluentVersion>) => {
        for (const reference of parent.references) {
          const key = `${reference.subject}/v${reference.version}`;

          if (dependencies.has(key)) continue;

          if (dependencies.size >= 1000) throw new Error('Registry reference limit exceeded');

          const child = confluentVersion.parse(
            await client.getVersion(reference.subject, reference.version),
          );

          if (
            child.subject !== reference.subject ||
            child.version !== reference.version ||
            child.schemaType !== schema.schemaType
          )
            throw new Error(`Registry reference identity or format mismatch: ${key}`);
          dependencies.set(key, child);
          await fetchReferences(child);
        }
      };

      await fetchReferences(schema);
      let payloadSchema: JsonObject;

      try {
        payloadSchema = confluentPayloadSchema(schema, dependencies);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message = `${subject}@${version}: ${reason}`;

        if (!options.onSubjectError) throw new Error(message, { cause: error });
        options.onSubjectError(message);
        continue;
      }

      const resource = registryResource(
        options.id,
        subject,
        String(version),
        schema.schema,
        schema.schemaType,
        {
          provider: 'confluent',
          id: options.id,
          schemaId: schema.id,
          nativeVersion: String(version),
          compatibility,
          references: schema.references,
          referencedSchemas: [...dependencies].map(([identity, child]) => ({
            identity,
            schema: child.schema,
            schemaType: child.schemaType,
            references: child.references,
          })),
        },
        options.url,
        payloadSchema,
      );

      graph.resources.push(resource);
    }
  }

  return graph;
}

function bundleRegistryJsonSchema(
  root: z.infer<typeof confluentVersion>,
  dependencies: Map<string, z.infer<typeof confluentVersion>>,
): JsonObject {
  const pointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');

  const rewrite = (
    value: JsonValue,
    owner: z.infer<typeof confluentVersion>,
    prefix: string,
  ): JsonValue => {
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry, owner, prefix));

    if (!isJsonObject(value)) return value;
    const output: JsonObject = {};

    for (const [key, child] of Object.entries(value)) {
      if (key === '$id') continue;

      if (key === '$ref') {
        const ref = z.string().parse(child);

        if (ref.startsWith('#')) output[key] = `${prefix}${ref.slice(1)}`;
        else {
          const [name, fragment] = ref.split('#');
          const reference = owner.references.find((entry) => entry.name === name);

          if (!reference) throw new Error(`Unresolved registry JSON reference: ${ref}`);
          output[key] =
            `#/$defs/${pointer(`${reference.subject}/v${reference.version}`)}${fragment ?? ''}`;
        }
      } else output[key] = rewrite(child, owner, prefix);
    }

    return output;
  };

  const bundled = jsonObjectSchema.parse(
    rewrite(jsonObjectSchema.parse(JSON.parse(root.schema)), root, '#'),
  );

  const definitions = isJsonObject(bundled.$defs) ? bundled.$defs : {};

  for (const [key, dependency] of dependencies)
    definitions[key] = rewrite(
      jsonObjectSchema.parse(JSON.parse(dependency.schema)),
      dependency,
      `#/$defs/${pointer(key)}`,
    );
  bundled.$defs = definitions;

  return bundled;
}

export function confluentHttpClient(
  baseUrl: string,
  authorization?: string,
): ConfluentRegistryClient {
  const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};

  const read = (pathname: string) =>
    getCatalogJson(new URL(`${baseUrl.replace(/\/$/, '')}${pathname}`), headers);

  return {
    listSubjects: () => read('/subjects'),
    listVersions: (subject) => read(`/subjects/${encodeURIComponent(subject)}/versions`),
    getVersion: (subject, version) =>
      read(`/subjects/${encodeURIComponent(subject)}/versions/${version}`),
    getCompatibility: async (subject) =>
      z
        .object({ compatibilityLevel: z.string() })
        .parse(await read(`/config/${encodeURIComponent(subject)}?defaultToGlobal=true`))
        .compatibilityLevel,
  };
}

export interface GlueRegistryClient {
  listSchemas(token?: string): Promise<JsonValue>;
  getSchema(schemaArn: string): Promise<JsonValue>;
  listVersions(schemaArn: string, token?: string): Promise<JsonValue>;
  getVersion(schemaArn: string, version: number): Promise<JsonValue>;
}

export interface GlueImportOptions {
  id: string;
  registry: string;
  subjects?: string[];
}

const glueSchemaPage = z.object({
  Schemas: z.array(z.object({ SchemaArn: z.string(), SchemaName: z.string() })).default([]),
  NextToken: z.string().optional(),
});

const glueVersionPage = z.object({
  Schemas: z
    .array(z.object({ VersionNumber: z.number().int().positive(), Status: z.string() }))
    .default([]),
  NextToken: z.string().optional(),
});

const glueSchema = z.object({
  DataFormat: z.enum(['JSON', 'AVRO', 'PROTOBUF']),
  Compatibility: z.string(),
});

const glueVersion = z.object({
  SchemaVersionId: z.string(),
  VersionNumber: z.number().int().positive(),
  DataFormat: z.enum(['JSON', 'AVRO', 'PROTOBUF']),
  SchemaDefinition: z.string(),
});

export async function importGlueRegistry(
  client: GlueRegistryClient,
  options: GlueImportOptions,
): Promise<ResourceGraph> {
  const graph = emptyResourceGraph();
  let token: string | undefined;
  const seen = new Set<string>();

  for (let page = 0; page < 10000; page++) {
    const schemas = glueSchemaPage.parse(await client.listSchemas(token));

    for (const schema of schemas.Schemas) {
      if (options.subjects && !options.subjects.includes(schema.SchemaName)) continue;
      const definition = glueSchema.parse(await client.getSchema(schema.SchemaArn));
      let versionToken: string | undefined;
      const versionTokens = new Set<string>();

      for (let versionPage = 0; versionPage < 10000; versionPage++) {
        const versions = glueVersionPage.parse(
          await client.listVersions(schema.SchemaArn, versionToken),
        );

        for (const version of versions.Schemas) {
          if (version.Status !== 'AVAILABLE') continue;

          const payload = glueVersion.parse(
            await client.getVersion(schema.SchemaArn, version.VersionNumber),
          );

          if (
            payload.VersionNumber !== version.VersionNumber ||
            payload.DataFormat !== definition.DataFormat
          )
            throw new Error(
              `Glue version identity mismatch: ${schema.SchemaName}@${version.VersionNumber}`,
            );
          graph.resources.push(
            registryResource(
              options.id,
              schema.SchemaName,
              String(payload.VersionNumber),
              payload.SchemaDefinition,
              payload.DataFormat,
              {
                provider: 'glue',
                id: options.id,
                registry: options.registry,
                schemaArn: schema.SchemaArn,
                schemaVersionId: payload.SchemaVersionId,
                nativeVersion: String(payload.VersionNumber),
                compatibility: definition.Compatibility,
              },
              schema.SchemaArn,
            ),
          );
        }

        versionToken = versions.NextToken;

        if (!versionToken) break;

        if (versionTokens.has(versionToken)) throw new Error('Repeated Glue version token');
        versionTokens.add(versionToken);

        if (versionPage === 9999) throw new Error('Glue version page limit exceeded');
      }
    }

    token = schemas.NextToken;

    if (!token) return graph;

    if (seen.has(token)) throw new Error('Repeated Glue schema token');
    seen.add(token);
  }

  throw new Error('Glue schema page limit exceeded');
}
