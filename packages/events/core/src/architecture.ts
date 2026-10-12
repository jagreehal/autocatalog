import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AUTOCATALOG_GRAPH_SPEC,
  relationshipKey,
  resourceKey,
  type CatalogResource,
  type ServiceCatalogResource,
  type CatalogRelationship,
  type ResourceGraph,
  type ResourceRef,
  type RuntimeResourceEvidence,
} from './resource-graph';
import { jsonObjectSchema, isJsonObject, type JsonObject, type JsonValue } from './json';
import { provenanceRank } from './adapter-event';

const attribute = z.object({
  key: z.string(),
  value: z.object({
    stringValue: z.string().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
  }),
});

const span = z.object({
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  startTimeUnixNano: z.string().optional(),
  endTimeUnixNano: z.string().optional(),
  kind: z.union([z.number(), z.string()]).optional(),
  attributes: z.array(attribute).default([]),
  links: z.array(z.object({ traceId: z.string(), spanId: z.string() })).default([]),
});

export const otlpArchitectureInput = z.object({
  resourceSpans: z.array(
    z.object({
      resource: z
        .object({ attributes: z.array(attribute).default([]) })
        .default({ attributes: [] }),
      scopeSpans: z.array(z.object({ spans: z.array(span) })).default([]),
    }),
  ),
});

export type OtlpArchitectureInput = z.input<typeof otlpArchitectureInput>;

export interface TraceDiscoveryOptions {
  datastore?: string;
  environment?: string;
}

export function architectureResource(
  ref: ResourceRef<'collection' | 'table' | 'command' | 'queue' | 'endpoint'>,
  attributes: JsonObject = {},
): CatalogResource {
  return {
    ref,
    title: ref.id,
    tags: [],
    provenance: { default: 'inferred', fields: {} },
    needsReview: true,
    attributes,
  };
}

export function architectureService(id: string): ServiceCatalogResource {
  return {
    ref: { kind: 'service', id },
    title: id,
    tags: [],
    provenance: { default: 'inferred', fields: {} },
    needsReview: true,
    attributes: { domains: [] },
  };
}

export function emptyResourceGraph(): ResourceGraph {
  return { spec: AUTOCATALOG_GRAPH_SPEC, resources: [], relationships: [] };
}

/** Reconcile extracted contracts with observations, refusing competing contracts. */
function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key]!)]),
  );
}

/**
 * Merge graph fragments into one. Sources that disagree never fail the merge:
 * a contested schema is left out and a contested owner keeps the better-sourced
 * one, and either way the resource is marked for review.
 * {@link architectureConflicts} says what was contested.
 */
export function mergeArchitectureGraphs(...graphs: ResourceGraph[]): ResourceGraph {
  return mergeReporting(graphs, () => {});
}

/** What the sources behind {@link mergeArchitectureGraphs} disagree on, one line per fact. */
export function architectureConflicts(...graphs: ResourceGraph[]): string[] {
  const messages = new Set<string>();

  mergeReporting(graphs, (message) => messages.add(message));

  return [...messages];
}

function mergeReporting(graphs: ResourceGraph[], report: (message: string) => void): ResourceGraph {
  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();

  for (const graph of graphs) {
    for (const resource of graph.resources) {
      const key = resourceKey(resource.ref);
      const previous = resources.get(key);

      if (!previous) {
        resources.set(key, resource);
        continue;
      }

      const preferred =
        provenanceRank(resource.provenance.default) > provenanceRank(previous.provenance.default)
          ? resource
          : previous;

      const other = preferred === previous ? resource : previous;
      const left = jsonObjectSchema.parse(JSON.parse(JSON.stringify(previous.attributes)));
      const right = jsonObjectSchema.parse(JSON.parse(JSON.stringify(resource.attributes)));

      const { kind, namespace, id } = resource.ref;

      const name = `${kind} ${namespace ? `${namespace}/` : ''}${id}`;

      const schemaContested =
        left.schema !== undefined &&
        right.schema !== undefined &&
        JSON.stringify(canonicalJson(left.schema)) !== JSON.stringify(canonicalJson(right.schema));

      const ownerContested =
        previous.owner !== undefined &&
        resource.owner !== undefined &&
        previous.owner.team !== resource.owner.team;

      if (schemaContested) {
        report(`${name}: sources disagree on its schema; it is left out until they agree`);
      }

      if (ownerContested) {
        const kept = (preferred.owner ?? other.owner)!.team;

        report(
          `${name}: sources disagree on its owner (${previous.owner!.team}, ${resource.owner!.team}); ${kept} is kept`,
        );
      }

      const attributes = preferred === previous ? { ...right, ...left } : { ...left, ...right };

      if (schemaContested) delete attributes.schema;

      if (previous.ref.kind === 'service' && resource.ref.kind === 'service') {
        const domains = [
          ...(Array.isArray(left.domains) ? left.domains : []),
          ...(Array.isArray(right.domains) ? right.domains : []),
        ];

        attributes.domains = [...new Set(domains)].sort();
      }

      // SAFETY: identical resource keys establish the same kind; attributes from that kind remain intact.
      const merged = {
        ...other,
        ...preferred,
        attributes,
        evidence: combineEvidence(previous.evidence, resource.evidence),
        ...(schemaContested && {
          provenance: {
            default: 'inferred',
            fields: Object.fromEntries(
              Object.entries(preferred.provenance.fields).filter(([field]) => field !== 'schema'),
            ),
          },
        }),
        ...((schemaContested || ownerContested) && { needsReview: true }),
      } as CatalogResource;

      resources.set(key, merged);
    }

    for (const edge of graph.relationships) {
      const key = relationshipKey(edge);
      const previous = relationships.get(key);

      if (!previous) {
        relationships.set(key, edge);
        continue;
      }

      const preferred =
        provenanceRank(edge.provenance) > provenanceRank(previous.provenance) ? edge : previous;

      const attributes = { ...preferred.attributes };

      if (
        edge.type === 'reads' &&
        edge.provenance === 'extracted' &&
        previous.provenance === 'extracted'
      ) {
        const left = z.array(z.string()).safeParse(previous.attributes?.fields);
        const right = z.array(z.string()).safeParse(edge.attributes?.fields);

        if (left.success && right.success)
          attributes.fields = [...new Set([...left.data, ...right.data])].sort();
        else delete attributes.fields;
      }

      relationships.set(key, {
        ...preferred,
        attributes: Object.keys(attributes).length ? attributes : undefined,
        evidence: combineEvidence(previous.evidence, edge.evidence),
      });
    }
  }

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...resources.values()].sort((a, b) =>
      resourceKey(a.ref).localeCompare(resourceKey(b.ref)),
    ),
    relationships: [...relationships.values()].sort((a, b) =>
      relationshipKey(a).localeCompare(relationshipKey(b)),
    ),
  };
}

const readOperations = new Set([
  'find',
  'findone',
  'select',
  'findbyid',
  'count',
  'countdocuments',
  'estimateddocumentcount',
  'exists',
  'distinct',
  'aggregate',
  'get',
  'scan',
  'query',
]);

const writeOperations = new Set([
  'insert',
  'insertone',
  'insertmany',
  'update',
  'updateone',
  'updatemany',
  'replaceone',
  'delete',
  'deleteone',
  'deletemany',
  'save',
  'findoneandupdate',
  'findoneanddelete',
  'findoneandreplace',
  'findoneandremove',
  'findbyidandupdate',
  'findbyidanddelete',
  'findbyidandremove',
  'findandmodify',
  'bulkwrite',
  'bulksave',
  'put',
]);

export function databaseAccess(operation: string): 'reads' | 'writes' | undefined {
  const normalized = operation.toLowerCase().replaceAll(/[^a-z]/g, '');

  if (readOperations.has(normalized)) return 'reads';

  if (writeOperations.has(normalized)) return 'writes';

  return undefined;
}

function timestamp(nanos: string | undefined): string | undefined {
  if (!nanos || !/^\d+$/.test(nanos)) return undefined;
  const milliseconds = Number(BigInt(nanos) / 1_000_000n);

  if (milliseconds > 8.64e15) return undefined;

  return new Date(milliseconds).toISOString();
}

const attributed = (evidence: RuntimeResourceEvidence) =>
  (evidence.exports ?? []).reduce((sum, entry) => sum + entry.count, 0);

/**
 * Union of two observations. Counts attributed to the same export digest are counted once, so
 * re-importing an export, or two repositories importing it, adds nothing. Unattributed counts add.
 */
export function combineEvidence(
  a: RuntimeResourceEvidence | undefined,
  b: RuntimeResourceEvidence | undefined,
): RuntimeResourceEvidence | undefined {
  if (!a) return b;

  if (!b) return a;
  const exports = new Map<string, number>();

  // One entry per distinct export per fact.
  for (const entry of [...(a.exports ?? []), ...(b.exports ?? [])])
    exports.set(entry.id, Math.max(exports.get(entry.id) ?? 0, entry.count));

  const deduplicated = [...exports.values()].reduce((sum, count) => sum + count, 0);
  const first = [a.firstSeen, b.firstSeen].flatMap((value) => (value ? [value] : [])).sort();
  const last = [a.lastSeen, b.lastSeen].flatMap((value) => (value ? [value] : [])).sort();

  return {
    count: a.count - attributed(a) + b.count - attributed(b) + deduplicated,
    firstSeen: first[0],
    lastSeen: last.at(-1),
    sampleTraceIds: [...new Set([...a.sampleTraceIds, ...b.sampleTraceIds])].sort().slice(0, 10),
    environment: a.environment === b.environment ? a.environment : undefined,
    operations: [...new Set([...(a.operations ?? []), ...(b.operations ?? [])])].sort(),
    coverage: 'unknown',
    exports: exports.size
      ? [...exports.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, count]) => ({ id, count }))
      : undefined,
  };
}

/** Discover only facts attributable to spans; unknown operations remain unresolved. */
export function discoverTraceResources(
  input: OtlpArchitectureInput,
  options: TraceDiscoveryOptions = {},
): ResourceGraph {
  const data = otlpArchitectureInput.parse(input);
  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();

  const addResource = (resource: CatalogResource) => {
    const key = resourceKey(resource.ref);
    const previous = resources.get(key);
    resources.set(
      key,
      previous
        ? { ...previous, evidence: combineEvidence(previous.evidence, resource.evidence) }
        : resource,
    );
  };

  const addEdge = (edge: CatalogRelationship) => {
    const key = relationshipKey(edge);
    const previous = relationships.get(key);
    relationships.set(
      key,
      previous
        ? { ...previous, evidence: combineEvidence(previous.evidence, edge.evidence) }
        : edge,
    );
  };

  const attributesOf = (attributes: z.infer<typeof attribute>[]) =>
    new Map(
      attributes.map(({ key, value }) => [key, value.stringValue ?? String(value.intValue ?? '')]),
    );

  const spansById = new Map<string, { service: string; item: z.infer<typeof span> }>();

  for (const resourceSpans of data.resourceSpans) {
    const resourceAttributes = attributesOf(resourceSpans.resource.attributes);
    const service = resourceAttributes.get('service.name');

    if (!service) continue;
    addResource(architectureService(service));

    for (const scope of resourceSpans.scopeSpans)
      for (const item of scope.spans) {
        if (item.traceId && item.spanId)
          spansById.set(`${item.traceId}/${item.spanId}`, { service, item });
        const attrs = attributesOf(item.attributes);
        const operation = attrs.get('db.operation.name') ?? attrs.get('db.operation') ?? '';

        const evidence: RuntimeResourceEvidence = {
          count: 1,
          firstSeen: timestamp(item.startTimeUnixNano),
          lastSeen: timestamp(item.endTimeUnixNano ?? item.startTimeUnixNano),
          sampleTraceIds: item.traceId ? [item.traceId] : [],
          environment:
            options.environment ??
            resourceAttributes.get('deployment.environment.name') ??
            resourceAttributes.get('deployment.environment'),
          operations: operation ? [operation] : [],
          coverage: 'unknown',
        };

        const collection =
          attrs.get('db.collection.name') ??
          attrs.get('db.mongodb.collection') ??
          attrs.get('db.sql.table');

        if (collection) {
          const system = attrs.get('db.system.name') ?? attrs.get('db.system') ?? 'unknown';
          const database = attrs.get('db.namespace') ?? attrs.get('db.name') ?? 'unknown';

          const datastore =
            options.datastore ??
            attrs.get('server.address') ??
            attrs.get('net.peer.name') ??
            system;

          const ref: ResourceRef<'collection' | 'table'> = {
            kind: system === 'mongodb' ? 'collection' : 'table',
            namespace: `${datastore}/${database}`,
            id: collection,
          };

          addResource({ ...architectureResource(ref, { system, database, datastore }), evidence });
          const access = databaseAccess(operation);

          if (access)
            addEdge({
              type: access,
              from: { kind: 'service', id: service },
              to: ref,
              provenance: 'observed',
              needsReview: true,
              evidence,
            });
        }

        const destination =
          attrs.get('messaging.destination.name') ?? attrs.get('messaging.destination');

        if (destination) {
          const system = attrs.get('messaging.system') ?? 'unknown';
          const ref: ResourceRef<'queue'> = { kind: 'queue', namespace: system, id: destination };
          addResource({ ...architectureResource(ref, { system }), evidence });

          const messagingOperation =
            attrs.get('messaging.operation.type') ?? attrs.get('messaging.operation') ?? '';

          if (['send', 'publish', 'receive', 'process'].includes(messagingOperation)) {
            const sending = ['send', 'publish'].includes(messagingOperation);
            addEdge({
              type: sending ? 'sends' : 'consumes',
              from: sending ? { kind: 'service', id: service } : ref,
              to: sending ? ref : { kind: 'service', id: service },
              provenance: 'observed',
              needsReview: true,
              evidence,
            });
          }
        }
      }
  }

  for (const { service, item } of spansById.values()) {
    const parent = item.parentSpanId
      ? spansById.get(`${item.traceId}/${item.parentSpanId}`)
      : undefined;

    if (!parent || parent.service === service) continue;

    // Cross-service parentage establishes a call only for a server span.
    if (item.kind !== 2 && item.kind !== 'SPAN_KIND_SERVER') continue;
    addEdge({
      type: 'calls',
      from: { kind: 'service', id: parent.service },
      to: { kind: 'service', id: service },
      provenance: 'observed',
      needsReview: true,
      evidence: {
        count: 1,
        sampleTraceIds: item.traceId ? [item.traceId] : [],
        firstSeen: timestamp(item.startTimeUnixNano),
        lastSeen: timestamp(item.endTimeUnixNano),
        environment: options.environment,
        coverage: 'unknown',
      },
    });
  }

  // Attribute every count to this export so a later import of the same export is not counted again.
  const id = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);

  const attributeToExport = <Fact extends { evidence?: RuntimeResourceEvidence }>(
    fact: Fact,
  ): Fact =>
    fact.evidence
      ? { ...fact, evidence: { ...fact.evidence, exports: [{ id, count: fact.evidence.count }] } }
      : fact;

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...resources.values()]
      .map(attributeToExport)
      .sort((a, b) => resourceKey(a.ref).localeCompare(resourceKey(b.ref))),
    relationships: [...relationships.values()]
      .map(attributeToExport)
      .sort((a, b) => relationshipKey(a).localeCompare(relationshipKey(b))),
  };
}

export function promoteRelationship(
  graph: ResourceGraph,
  target: Pick<CatalogRelationship, 'type' | 'from' | 'to'>,
): ResourceGraph {
  const key = relationshipKey({ ...target, provenance: 'declared', needsReview: false });

  if (!graph.relationships.some((edge) => relationshipKey(edge) === key))
    throw new Error(`Unknown relationship: ${key}`);

  return {
    ...graph,
    relationships: graph.relationships.map((edge) =>
      relationshipKey(edge) === key
        ? {
            ...edge,
            provenance: 'declared',
            needsReview: false,
            attributes: { ...edge.attributes, reviewed: true },
          }
        : edge,
    ),
  };
}

export function datastoreOwnership(graph: ResourceGraph) {
  return graph.resources
    .flatMap((resource) => {
      if (resource.ref.kind !== 'collection' && resource.ref.kind !== 'table') return [];

      const accesses = graph.relationships.filter(
        (edge) => resourceKey(edge.to) === resourceKey(resource.ref),
      );

      return [
        {
          ref: resource.ref,
          owner: resource.owner?.team ?? null,
          writers: [
            ...new Set(
              accesses.filter((edge) => edge.type === 'writes').map((edge) => edge.from.id),
            ),
          ].sort(),
          readers: [
            ...new Set(
              accesses.filter((edge) => edge.type === 'reads').map((edge) => edge.from.id),
            ),
          ].sort(),
          evidence: resource.evidence,
        },
      ];
    })
    .sort((a, b) => resourceKey(a.ref).localeCompare(resourceKey(b.ref)));
}
