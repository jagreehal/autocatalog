import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { scanModelResources, type ModelScanOptions } from './model-resources';
import { scanCommandResources } from './command-resources';
import {
  combineEvidence,
  discoverTraceResources,
  emptyResourceGraph,
  architectureConflicts,
  mergeArchitectureGraphs,
  promoteRelationship,
  type OtlpArchitectureInput,
} from './architecture';
import {
  importBackstageYaml,
  resolveResourceOwnership,
  type OwnershipImport,
  type OwnershipOptions,
} from './ownership-sources';
import { readResourceGraph, writeResourceGraph, parseResourceGraph } from './resource-store';
import {
  readOptionalResourceJson,
  readResourceJson,
  ResourceReadError,
  readResourceSource,
  resourceFiles,
} from './resource-files';
import { jsonValueSchema } from './json';
import {
  isArchitectureCatalogResource,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
} from './resource-graph';
import { loadCodeowners } from './enrich-event';

export const architectureConfig = z.object({
  service: z.string().optional(),
  datastore: z.string().optional(),
  database: z.string().optional(),
  environment: z.string().optional(),
  ownership: z
    .object({
      precedence: z.array(z.enum(['backstage', 'datadog', 'codeowners'])).optional(),
      teamAliases: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export interface ArchitectureScanOptions extends ModelScanOptions {
  traces?: OtlpArchitectureInput;
  environment?: string;
  ownership?: OwnershipOptions;
  publish?: boolean;
}

const ownershipClaim = z.object({
  resource: z.object({
    kind: z.string(),
    id: z.string(),
    namespace: z.string().optional(),
    version: z.string().optional(),
  }),
  team: z.string(),
  source: z.enum(['backstage', 'datadog', 'codeowners']),
  location: z.string(),
});

const importRecord = z.object({
  graph: jsonValueSchema,
  claims: z.array(ownershipClaim).default([]),
});

/** A saved import, with errors that name the file and what is wrong in it. */
async function readImportRecord(file: string, root: string): Promise<OwnershipImport> {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const record = importRecord.safeParse(await readResourceJson(file, { root }));

  if (!record.success) {
    const [issue] = record.error.issues;

    throw new ResourceReadError(
      'invalid',
      `${relative}: not an import record (${issue?.path.length ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'invalid'})`,
    );
  }

  try {
    return { graph: parseResourceGraph(record.data.graph), claims: record.data.claims };
  } catch (error) {
    throw new ResourceReadError(
      'invalid',
      `${relative}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function saveResourceImport(
  root: string,
  id: string,
  imported: OwnershipImport,
): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === '.' || id === '..')
    throw new Error('Import identity must be a filename-safe identifier');
  const content = JSON.stringify(imported, null, 2);
  const parsed = importRecord.parse(JSON.parse(content));
  parseResourceGraph(parsed.graph);
  const directory = path.join(root, '.autocatalog', 'imports');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${id}.json`);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporary, `${content}\n`, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

const reviewed = (edge: CatalogRelationship) => edge.attributes?.reviewed === true;

/**
 * Keep what the saved graph knows that this scan cannot re-derive: runtime evidence and promotions.
 * Evidence always merges (combineEvidence counts an export once). An edge no longer extracted from
 * code survives only as an observation, or as a promotion, and never keeps its stale source.
 */
function carryForward(previous: ResourceGraph, current: ResourceGraph): ResourceGraph {
  const previousEdges = new Map(
    previous.relationships.map((edge) => [relationshipKey(edge), edge]),
  );

  const currentEdges = new Set(current.relationships.map(relationshipKey));

  const relationships: CatalogRelationship[] = current.relationships.map((edge) => ({
    ...edge,
    evidence: combineEvidence(previousEdges.get(relationshipKey(edge))?.evidence, edge.evidence),
  }));

  for (const edge of previous.relationships) {
    if (currentEdges.has(relationshipKey(edge)) || !(edge.evidence || reviewed(edge))) continue;
    const { source: _source, attributes, ...rest } = edge;

    relationships.push(
      reviewed(edge)
        ? { ...rest, attributes }
        : { ...rest, provenance: 'observed', needsReview: true },
    );
  }

  const endpoints = new Set(
    relationships.flatMap((edge) => [resourceKey(edge.from), resourceKey(edge.to)]),
  );

  const previousResources = new Map(
    previous.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const currentKeys = new Set(current.resources.map((resource) => resourceKey(resource.ref)));

  const resources: CatalogResource[] = current.resources.map((resource) => ({
    ...resource,
    evidence: combineEvidence(
      previousResources.get(resourceKey(resource.ref))?.evidence,
      resource.evidence,
    ),
  }));

  for (const [key, resource] of previousResources) {
    if (currentKeys.has(key) || !(resource.evidence || endpoints.has(key))) continue;

    if (!isArchitectureCatalogResource(resource)) {
      resources.push(resource);
      continue;
    }

    const { source: _source, ...rest } = resource;

    const {
      schema: _schema,
      adapter: _adapter,
      fieldAliases: _aliases,
      fields: _fields,
      indexes: _indexes,
      ...attributes
    } = rest.attributes;

    resources.push({
      ...rest,
      attributes,
      provenance: { default: 'inferred', fields: {} },
      needsReview: true,
    });
  }

  let graph = mergeArchitectureGraphs({ spec: current.spec, resources, relationships });

  for (const edge of previous.relationships.filter(reviewed))
    graph = promoteRelationship(graph, edge);

  return graph;
}

/** A single scan pipeline for brownfield resources; no event contract is required. */
export async function scanArchitecture(options: ArchitectureScanOptions) {
  const errors: string[] = [];
  const skipped: string[] = [];
  const conflicts: ReturnType<typeof resolveResourceOwnership>['conflicts'] = [];
  let graph = emptyResourceGraph();

  try {
    const config = architectureConfig.parse(
      (await readOptionalResourceJson(path.join(options.root, '.autocatalog', 'config.json'), {
        root: options.root,
      })) ?? {},
    );

    const effective = {
      ...options,
      service: options.service ?? config.service,
      datastore: options.datastore ?? config.datastore,
      database: options.database ?? config.database,
      environment: options.environment ?? config.environment,
    };

    const models = await scanModelResources(effective);
    const commands = await scanCommandResources(effective);
    errors.push(...models.errors, ...commands.errors);
    skipped.push(...models.skipped, ...commands.skipped);

    if (errors.length) return { graph, errors, skipped, conflicts };
    const imports: OwnershipImport[] = [];

    const ownershipFiles = await resourceFiles(effective, {
      include: (file) => /catalog-info\.ya?ml$/.test(file),
      skipped,
    });

    for (const file of ownershipFiles) {
      imports.push(
        importBackstageYaml(
          await readResourceSource(file, effective),
          path.relative(options.root, file).split(path.sep).join('/'),
        ),
      );
    }

    const directory = path.join(options.root, '.autocatalog', 'imports');
    let importedFiles: string[] = [];

    try {
      importedFiles = await fs.readdir(directory);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    for (const file of importedFiles.sort()) {
      if (!file.endsWith('.json')) continue;

      imports.push(await readImportRecord(path.join(directory, file), options.root));
    }

    const sources = [
      models.graph,
      commands.graph,
      ...imports.map((entry) => entry.graph),
      options.traces ? discoverTraceResources(options.traces, effective) : emptyResourceGraph(),
    ];

    skipped.push(...architectureConflicts(...sources));
    graph = mergeArchitectureGraphs(...sources);
    const previous = await readResourceGraph(options.root);

    if (previous) graph = carryForward(previous, graph);

    const resolved = resolveResourceOwnership(graph, {
      ...config.ownership,
      ...options.ownership,
      claims: [...imports.flatMap((entry) => entry.claims), ...(options.ownership?.claims ?? [])],
      codeowners: await loadCodeowners(options.root),
    });

    graph = resolved.graph;
    conflicts.push(...resolved.conflicts);

    if (options.publish !== false) await writeResourceGraph(options.root, graph);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { graph: errors.length ? emptyResourceGraph() : graph, errors, skipped, conflicts };
}
