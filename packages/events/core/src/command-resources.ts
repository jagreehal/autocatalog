import path from 'node:path';
import { z } from 'zod';
import {
  architectureResource,
  architectureService,
  emptyResourceGraph,
  mergeArchitectureGraphs,
} from './architecture';
import {
  resourceKey,
  isArchitectureCatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';
import { jsonObjectSchema, isJsonObject, type JsonObject } from './json';
import {
  readResourceJson,
  ResourceReadError,
  resourceFiles,
  type ResourceScanOptions,
} from './resource-files';
import type { ResourceDiscoveryResult } from './model-resources';

export const commandManifest = z.object({
  kind: z.literal('command').default('command'),
  spec: z.literal('autocatalog/v2').optional(),
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  domain: z.string().optional(),
  owner: z
    .object({
      team: z.string().min(1),
      name: z.string().min(1).optional(),
      contact: z.string().url().optional(),
    })
    .optional(),
  senders: z.array(z.string().min(1)).default([]),
  handler: z.string().min(1).optional(),
  schema: z.string().default('./schema.json'),
  outcome: z
    .object({
      type: z.enum(['completion', 'result', 'event']),
      schema: z.string().optional(),
      event: z.string().optional(),
      /** The queue the handler replies on, for a sender that waits for the outcome. */
      replyTo: z.string().min(1).optional(),
    })
    .optional(),
  transport: z
    .array(z.object({ address: z.string().min(1), protocols: z.array(z.string()).default([]) }))
    .default([]),
  tags: z.array(z.string()).default([]),
});

export type CommandManifest = z.infer<typeof commandManifest>;

const MISSING = 'is required';

/** A manifest, or an error naming each invalid field in words rather than as a zod dump. */
function parseCommandManifest(value: JsonObject): CommandManifest {
  const parsed = commandManifest.safeParse(value, {
    error: (issue) => (issue.input === undefined ? MISSING : undefined),
  });

  if (parsed.success) return parsed.data;

  throw new Error(
    parsed.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'manifest';

        return issue.message === MISSING ? `${field} ${MISSING}` : `${field}: ${issue.message}`;
      })
      .join('; '),
  );
}

export interface CommandFinding {
  code: 'command_missing_handler' | 'command_multiple_handlers' | 'command_missing_outcome';
  severity: 'breaking' | 'suspicious';
  resource: ResourceRef;
  message: string;
}

export function validateCommands(graph: ResourceGraph): CommandFinding[] {
  return graph.resources.flatMap((resource) => {
    if (!isArchitectureCatalogResource(resource) || resource.ref.kind !== 'command') return [];

    const handlers = new Set(
      graph.relationships
        .filter(
          (edge) => edge.type === 'handles' && resourceKey(edge.to) === resourceKey(resource.ref),
        )
        .map((edge) => resourceKey(edge.from)),
    );

    const findings: CommandFinding[] = [];

    if (handlers.size !== 1)
      findings.push({
        code: handlers.size ? 'command_multiple_handlers' : 'command_missing_handler',
        severity: 'breaking',
        resource: resource.ref,
        message: `${resource.ref.id} expects one logical handler; found ${handlers.size}`,
      });

    if (!resource.attributes.outcome)
      findings.push({
        code: 'command_missing_outcome',
        severity: 'suspicious',
        resource: resource.ref,
        message: `${resource.ref.id} has no expected outcome`,
      });

    return findings;
  });
}

/** A command contract is a separate resource, even when transported by an event-capable queue. */
export async function scanCommandResources(
  options: ResourceScanOptions,
): Promise<ResourceDiscoveryResult> {
  const fragments: ResourceGraph[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];

  const files = await resourceFiles(options, {
    include: (file) => /(schema|autocatalog)\.json$/.test(file),
    skipped,
  });

  for (const file of files) {
    const relative = path.relative(options.root, file).split(path.sep).join('/');
    const conventional = /(^|\/)commands\/.*\/autocatalog\.json$/.test(relative);

    try {
      // Only a file that is, or says it is, a command can be wrong about it.
      // Any other JSON that cannot be read or parsed is not this scanner's concern.
      const value = await readResourceJson(file, options).catch((error: Error) => {
        if (conventional || !(error instanceof ResourceReadError)) throw error;

        return undefined;
      });

      const parsed = jsonObjectSchema.safeParse(value);

      if (!parsed.success) {
        if (conventional) throw new Error('Command manifest must be an object');
        continue;
      }

      const embedded = isJsonObject(parsed.data['x-autocatalog'])
        ? parsed.data['x-autocatalog']
        : undefined;

      const manifestFile = conventional || parsed.data.kind === 'command';

      const declaration = manifestFile ? parsed.data : embedded;

      if (!declaration || (!manifestFile && declaration.kind !== 'command')) continue;
      const manifest = parseCommandManifest(declaration);
      const folder = path.dirname(file);

      const readSchema = async (schemaPath: string) =>
        jsonObjectSchema.parse(await readResourceJson(path.resolve(folder, schemaPath), options));

      const schema = manifestFile ? await readSchema(manifest.schema) : parsed.data;

      const outcomeSchema = manifest.outcome?.schema
        ? await readSchema(manifest.outcome.schema)
        : undefined;

      const ref: ResourceRef<'command'> = {
        kind: 'command',
        namespace: manifest.domain ?? 'default',
        id: manifest.id,
        version: manifest.version,
      };

      const attributes = {
        schema,
        transport: manifest.transport,
        outcome: manifest.outcome ?? null,
        outcomeSchema: outcomeSchema ?? null,
      };

      const resource = {
        ...architectureResource(ref, attributes),
        title: manifest.name,
        summary: manifest.summary,
        owner: manifest.owner,
        tags: manifest.tags,
        source: { type: 'code' as const, file: relative },
        provenance: { default: 'declared' as const, fields: {} },
        needsReview: false,
      };

      const graph = emptyResourceGraph();
      graph.resources.push(resource);

      for (const service of [...manifest.senders, ...(manifest.handler ? [manifest.handler] : [])])
        graph.resources.push(architectureService(service));

      for (const sender of manifest.senders)
        graph.relationships.push({
          type: 'sends',
          from: { kind: 'service', id: sender },
          to: ref,
          provenance: 'declared',
          needsReview: false,
        });

      if (manifest.handler)
        graph.relationships.push({
          type: 'handles',
          from: { kind: 'service', id: manifest.handler },
          to: ref,
          provenance: 'declared',
          needsReview: false,
        });
      const replyTo = manifest.outcome?.replyTo;

      if (replyTo) {
        const queue: ResourceRef<'queue'> = {
          kind: 'queue',
          namespace: ref.namespace,
          id: replyTo,
        };

        graph.resources.push(architectureResource(queue));
        graph.relationships.push({
          type: 'repliesTo',
          from: ref,
          to: queue,
          provenance: 'declared',
          needsReview: false,
        });
      }

      fragments.push(graph);
    } catch (error) {
      // A read error already names its file.
      if (error instanceof ResourceReadError) errors.push(error.message);
      else errors.push(`${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    graph: errors.length ? emptyResourceGraph() : mergeArchitectureGraphs(...fragments),
    errors,
    skipped,
  };
}
