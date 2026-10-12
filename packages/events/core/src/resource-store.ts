import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import contract from '../contracts/graph-v1.schema.json' with { type: 'json' };
import { jsonValueSchema, type JsonValue } from './json';
import { readOptionalResourceJson, ResourceReadError } from './resource-files';
import { resourceKey, relationshipKey, type ResourceGraph } from './resource-graph';

export const RESOURCE_GRAPH_FILE = '.autocatalog/resources.json';

// The published JSON Schema is the boundary validator, including provenance and evidence.
const validateGraph = new Ajv2020({ strict: false, allErrors: true }).compile<ResourceGraph>(
  contract,
);

export function parseResourceGraph(input: JsonValue): ResourceGraph {
  if (!validateGraph(input)) {
    const [first] = validateGraph.errors ?? [];

    const where = first?.instancePath ? `${first.instancePath}: ` : '';

    throw new Error(
      `does not match the resource graph contract (${where}${first?.message ?? 'invalid'})`,
    );
  }

  const resources = new Set<string>();

  for (const resource of input.resources) {
    const key = resourceKey(resource.ref);

    if (resources.has(key)) throw new Error(`Duplicate resource: ${key}`);
    resources.add(key);
  }

  const relationships = new Set<string>();

  for (const edge of input.relationships) {
    const key = relationshipKey(edge);

    if (relationships.has(key)) throw new Error(`Duplicate relationship: ${key}`);

    if (!resources.has(resourceKey(edge.from)) || !resources.has(resourceKey(edge.to)))
      throw new Error(`Unresolved relationship: ${key}`);
    relationships.add(key);
  }

  return input;
}

export async function readResourceGraph(root: string): Promise<ResourceGraph | undefined> {
  const value = await readOptionalResourceJson(path.join(root, RESOURCE_GRAPH_FILE), { root });

  if (value === undefined) return undefined;

  try {
    return parseResourceGraph(value);
  } catch (error) {
    throw new ResourceReadError(
      'invalid',
      `${RESOURCE_GRAPH_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function writeResourceGraph(root: string, graph: ResourceGraph): Promise<void> {
  const serialized = `${JSON.stringify(graph, null, 2)}\n`;
  parseResourceGraph(jsonValueSchema.parse(JSON.parse(serialized)));
  const destination = path.join(root, RESOURCE_GRAPH_FILE);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporary, serialized, { flag: 'wx' });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
