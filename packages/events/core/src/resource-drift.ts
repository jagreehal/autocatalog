import {
  adviseBreaking,
  assessEventChange,
  compareSemverish,
  compatibilityViolations,
  type DriftSeverity,
  type DriftFinding,
} from './drift';
import { jsonObjectSchema, type JsonObject } from './json';
import {
  resourceKey,
  relationshipKey,
  isArchitectureCatalogResource,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';
import { validateCommands } from './command-resources';
import { jsonSchemaAjv, jsonSchemaDialect } from './json-schema-dialect';
import { z } from 'zod';
import { jsonValueSchema } from './json';

export interface ResourceDriftFinding {
  resource: ResourceRef;
  code: DriftFinding['kind'];
  severity: DriftSeverity;
  message: string;
  affectedServices: string[];
  /** The registry strategies the change violates, decided as for an event. */
  compatibility: Array<'backward' | 'forward'>;
  /** A breaking change the resource's own major version bump owns up to. */
  acknowledged?: boolean;
  advice?: string;
}

/** The finding in event drift's shape, so one report, severity gate and strategy gate cover both. */
export function asDriftFinding(finding: ResourceDriftFinding): DriftFinding {
  return {
    resource: finding.resource,
    domain: finding.resource.namespace ?? '',
    eventId: `${finding.resource.kind}/${finding.resource.id}`,
    kind: finding.code,
    severity: finding.severity,
    message: finding.message,
    consumers: finding.affectedServices,
    compatibility: finding.compatibility,
    acknowledged: finding.acknowledged,
    advice: finding.advice,
  };
}

/** A resource change in event drift's shape, before advice. */
function change(
  ref: ResourceRef,
  kind: DriftFinding['kind'],
  message: string,
  consumers: string[],
  severity: DriftSeverity = 'breaking',
): DriftFinding {
  return { domain: ref.namespace ?? '', eventId: ref.id, severity, kind, message, consumers };
}

/**
 * Advise and acknowledge one resource's changes by its version exactly as event
 * drift does, and record the strategies each violates while the diff is at hand.
 * An unversioned resource has no version to bump, so its advice says only what to keep.
 */
function resourceFindings(
  changes: DriftFinding[],
  resource: ResourceRef,
  version: { from?: string; to?: string },
): ResourceDriftFinding[] {
  const advised = adviseBreaking(changes, {
    from: version.from ?? '',
    to: version.from === undefined ? undefined : version.to,
  });

  return advised.map((finding) => ({
    resource,
    code: finding.kind,
    severity: finding.severity,
    message: finding.message,
    affectedServices: [...finding.consumers].sort(),
    compatibility: compatibilityViolations(finding),
    ...(finding.acknowledged && { acknowledged: true }),
    ...(finding.advice && { advice: finding.advice }),
  }));
}

export function resourceSchema(resource: CatalogResource): JsonObject | undefined {
  if (!('schema' in resource.attributes)) return undefined;

  const parsed = jsonObjectSchema.safeParse(
    'payloadSchema' in resource.attributes
      ? (resource.attributes.payloadSchema ?? resource.attributes.schema)
      : resource.attributes.schema,
  );

  return parsed.success ? parsed.data : undefined;
}

const logicalKey = (ref: ResourceRef) => resourceKey({ ...ref, version: undefined });

function latestResources(graph: ResourceGraph): Map<string, CatalogResource> {
  const resources = new Map<string, CatalogResource>();

  for (const resource of graph.resources) {
    const key = logicalKey(resource.ref);
    const existing = resources.get(key);

    if (!existing || compareSemverish(resource.ref.version ?? '0', existing.ref.version ?? '0') > 0)
      resources.set(key, resource);
  }

  return resources;
}

/** Schema changes, narrowed to the fields each reader declares; a reader that never said stays affected. */
function schemaChanges(
  previous: CatalogResource,
  schemas: { from: JsonObject; to: JsonObject },
  accesses: CatalogRelationship[],
  readers: string[],
): DriftFinding[] {
  // Keyed by service id, so a Map: a service named `constructor` is not Object.
  const consumerFields = new Map<string, string[]>();
  const unknown = new Set<string>();

  for (const edge of accesses) {
    const fields = edge.attributes?.fields;
    const parsedFields = z.array(z.string()).safeParse(fields);

    if (parsedFields.success && parsedFields.data.length)
      consumerFields.set(edge.from.id, [
        ...new Set([...(consumerFields.get(edge.from.id) ?? []), ...parsedFields.data]),
      ]);
    else unknown.add(edge.from.id);
  }

  for (const service of unknown) consumerFields.delete(service);

  return assessEventChange({
    domain: previous.ref.namespace ?? '',
    eventId: previous.ref.id,
    consumers: readers,
    consumerFields: Object.fromEntries(consumerFields),
    previous: schemas.from,
    proposed: schemas.to,
  });
}

export function driftResources(
  baseline: ResourceGraph,
  current: ResourceGraph,
): ResourceDriftFinding[] {
  const findings: ResourceDriftFinding[] = [];
  const before = latestResources(baseline);
  const after = latestResources(current);

  for (const [key, previous] of before) {
    const proposed = after.get(key);

    const accesses = [...baseline.relationships, ...current.relationships].filter(
      (edge) => logicalKey(edge.to) === key && ['reads', 'handles'].includes(edge.type),
    );

    const readers = [...new Set(accesses.map((edge) => edge.from.id))].sort();

    if (!proposed) {
      if (['collection', 'table', 'command'].includes(previous.ref.kind))
        findings.push(
          ...resourceFindings(
            [change(previous.ref, 'resource_removed', `${key} was removed`, readers)],
            previous.ref,
            { from: previous.ref.version },
          ),
        );
      continue;
    }

    const changes: DriftFinding[] = [];

    if (
      isArchitectureCatalogResource(previous) &&
      isArchitectureCatalogResource(proposed) &&
      previous.ref.kind === 'command'
    ) {
      const senders = [
        ...new Set(
          [...baseline.relationships, ...current.relationships].flatMap((edge) =>
            edge.type === 'sends' && logicalKey(edge.to) === key ? [edge.from.id] : [],
          ),
        ),
      ].sort();

      if (
        JSON.stringify(previous.attributes.outcome) !== JSON.stringify(proposed.attributes.outcome)
      )
        changes.push(
          change(
            proposed.ref,
            'command_outcome_changed',
            `${key} expected outcome changed`,
            senders,
          ),
        );

      const oldOutcome = jsonObjectSchema.safeParse(previous.attributes.outcomeSchema);
      const newOutcome = jsonObjectSchema.safeParse(proposed.attributes.outcomeSchema);

      if (oldOutcome.success && newOutcome.success)
        for (const finding of assessEventChange({
          domain: previous.ref.namespace ?? '',
          eventId: previous.ref.id,
          consumers: senders,
          previous: oldOutcome.data,
          proposed: newOutcome.data,
        }))
          changes.push({ ...finding, message: `Command outcome: ${finding.message}` });

      const handlers = (graph: ResourceGraph) =>
        [
          ...new Set(
            graph.relationships
              .filter((edge) => edge.type === 'handles' && logicalKey(edge.to) === key)
              .map((edge) => edge.from.id),
          ),
        ].sort();

      if (JSON.stringify(handlers(baseline)) !== JSON.stringify(handlers(current)))
        changes.push(
          change(
            proposed.ref,
            'command_handler_changed',
            `${key} logical handler changed`,
            senders,
            'suspicious',
          ),
        );
    }

    const oldSchema = resourceSchema(previous);
    const newSchema = resourceSchema(proposed);

    if (oldSchema && newSchema)
      changes.push(
        ...schemaChanges(previous, { from: oldSchema, to: newSchema }, accesses, readers),
      );

    findings.push(
      ...resourceFindings(changes, proposed.ref, {
        from: previous.ref.version,
        to: proposed.ref.version,
      }),
    );
  }

  for (const finding of validateCommands(current))
    findings.push({
      resource: finding.resource,
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      affectedServices: [],
      compatibility: [],
    });
  const previousEdges = new Set(baseline.relationships.map(relationshipKey));

  for (const edge of current.relationships) {
    if (
      edge.type === 'writes' &&
      edge.provenance === 'observed' &&
      !previousEdges.has(relationshipKey(edge))
    )
      findings.push({
        resource: edge.to,
        code: 'writer_undocumented',
        severity: 'suspicious',
        message: `${edge.from.id} writes ${resourceKey(edge.to)} without a baseline declaration`,
        affectedServices: [edge.from.id],
        compatibility: [],
      });
  }

  findings.push(...crossOwnerAccess(current, previousEdges));

  return findings;
}

/**
 * New direct access from one team's service to a datastore another team owns.
 * Access already in the baseline is known, and a reviewed edge is a deliberate
 * exception, so neither fails the build. Either owner unknown says nothing.
 */
function crossOwnerAccess(
  graph: ResourceGraph,
  previousEdges: Set<string>,
): ResourceDriftFinding[] {
  const owners = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource.owner?.team]),
  );

  return graph.relationships.flatMap((edge) => {
    const access =
      ['reads', 'writes'].includes(edge.type) && ['collection', 'table'].includes(edge.to.kind);

    if (!access || previousEdges.has(relationshipKey(edge))) return [];

    const team = owners.get(resourceKey(edge.from));
    const owner = owners.get(resourceKey(edge.to));

    if (!team || !owner || team === owner) return [];

    return [
      {
        resource: edge.to,
        code: 'cross_owner_access',
        severity: edge.attributes?.reviewed === true ? 'suspicious' : 'breaking',
        message: `${edge.from.id} (${team}) ${edge.type} ${edge.to.kind} ${edge.to.namespace ? `${edge.to.namespace}/` : ''}${edge.to.id}, which ${owner} owns`,
        affectedServices: [edge.from.id],
        compatibility: [],
        advice: `Ask ${owner} for an API or an event instead. If this is a deliberate exception, such as a migration, review the edge with ac resources promote.`,
      },
    ];
  });
}

export const documentObservations = z.array(
  z.object({
    resource: z.object({
      kind: z.string().min(1),
      namespace: z.string().optional(),
      id: z.string().min(1),
      version: z.string().optional(),
    }),
    kind: z.enum(['document', 'projection', 'patch']),
    value: jsonValueSchema,
  }),
);

export type DocumentObservation = z.infer<typeof documentObservations>[number];

export function validateResourceDocuments(
  graph: ResourceGraph,
  observations: DocumentObservation[],
) {
  let checked = 0;
  let skipped = 0;
  const findings: Array<ResourceDriftFinding & { path?: string }> = [];

  const resources = new Map(
    graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  for (const observation of documentObservations.parse(observations)) {
    if (observation.kind !== 'document') {
      skipped++;
      continue;
    }

    const resource = resources.get(resourceKey(observation.resource));
    const schema = resource ? resourceSchema(resource) : undefined;

    if (!schema) {
      skipped++;
      findings.push({
        resource: observation.resource,
        code: 'document_schema_unavailable',
        severity: 'info',
        message: 'No schema available to validate this document',
        affectedServices: [],
        compatibility: [],
      });
      continue;
    }

    // A registry schema that names no dialect has been draft-07 here all along.
    const ajv = jsonSchemaAjv(jsonSchemaDialect(schema, 'draft-07'));
    ajv.addFormat('decimal', /^-?\d+(?:\.\d+)?$/);
    ajv.addFormat('int64', /^-?\d+$/);
    const validate = ajv.compile(schema);
    checked++;

    if (validate(observation.value)) continue;

    for (const error of validate.errors ?? [])
      findings.push({
        resource: observation.resource,
        code: 'document_schema_mismatch',
        severity: 'suspicious',
        message: `Document violates ${error.keyword} at ${error.instancePath || '/'}`,
        path: error.instancePath,
        affectedServices: [],
        compatibility: [],
      });
  }

  return { checked, skipped, findings };
}
