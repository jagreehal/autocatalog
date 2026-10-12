import { parseAllDocuments } from 'yaml';
import { z } from 'zod';
import { architectureService, emptyResourceGraph, mergeArchitectureGraphs } from './architecture';
import { resourceKey, type ResourceGraph, type ResourceRef } from './resource-graph';
import { jsonValueSchema, type JsonValue } from './json';
import { ownerForPath, type CodeownersRule } from './codeowners';

export type OwnershipSource = 'backstage' | 'datadog' | 'codeowners';

export interface OwnershipClaim {
  resource: ResourceRef;
  team: string;
  source: OwnershipSource;
  location: string;
}

export interface OwnershipImport {
  graph: ResourceGraph;
  claims: OwnershipClaim[];
}

export interface OwnershipOptions {
  claims: OwnershipClaim[];
  codeowners?: CodeownersRule[];
  precedence?: OwnershipSource[];
  teamAliases?: Record<string, string>;
}

const backstageEntity = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string().min(1),
    namespace: z.string().default('default'),
    description: z.string().optional(),
    annotations: z.record(z.string(), z.string()).default({}),
  }),
  spec: z.object({ type: z.string().optional(), owner: z.string().optional() }).default({}),
  relations: z.array(z.object({ type: z.string(), targetRef: z.string() })).default([]),
});

export function importBackstageEntities(entities: JsonValue[], location: string): OwnershipImport {
  const graph = emptyResourceGraph();
  const claims: OwnershipClaim[] = [];

  for (const input of entities) {
    const entity = backstageEntity.parse(input);

    if (entity.kind.toLowerCase() !== 'component' || entity.spec.type !== 'service') continue;

    const id =
      entity.metadata.annotations['autocatalog.io/service'] ??
      (entity.metadata.namespace === 'default'
        ? entity.metadata.name
        : `${entity.metadata.namespace}/${entity.metadata.name}`);

    const resource = architectureService(id);
    resource.summary = entity.metadata.description;
    resource.source = { type: location.startsWith('http') ? 'url' : 'code', file: location };
    resource.provenance = { default: 'extracted', fields: {} };
    resource.needsReview = false;
    graph.resources.push(resource);

    const owner =
      entity.relations.find((relation) => relation.type === 'ownedBy')?.targetRef ??
      entity.spec.owner;

    if (owner) claims.push({ resource: resource.ref, team: owner, source: 'backstage', location });
  }

  return { graph: mergeArchitectureGraphs(graph), claims };
}

export function importBackstageYaml(content: string, location: string): OwnershipImport {
  const entities = parseAllDocuments(content).map((document) => {
    if (document.errors.length)
      throw new Error(`${location}: invalid Backstage YAML: ${document.errors[0]?.message}`);

    return jsonValueSchema.parse(document.toJSON());
  });

  return importBackstageEntities(entities, location);
}

/** Select ownership by configured source order, keeping every competing claim visible. */
export function resolveResourceOwnership(graph: ResourceGraph, options: OwnershipOptions) {
  const precedence = options.precedence ?? ['backstage', 'datadog', 'codeowners'];
  // A Map, not the object: a team named `constructor` must not resolve to Object.
  const aliases = new Map(Object.entries(options.teamAliases ?? {}));
  const normalize = (team: string) => aliases.get(team) ?? team.replace(/^@/, '');
  const conflicts: Array<{ resource: ResourceRef; selected: string; alternatives: string[] }> = [];

  const resources = graph.resources.map((resource) => {
    const key = resourceKey(resource.ref);

    const claims = options.claims
      .filter((claim) => resourceKey(claim.resource) === key)
      .map((claim) => ({ ...claim, team: normalize(claim.team) }));

    const codeowner = resource.source?.file
      ? ownerForPath(options.codeowners ?? [], resource.source.file)
      : undefined;

    if (codeowner)
      claims.push({
        resource: resource.ref,
        team: normalize(codeowner),
        source: 'codeowners',
        location: resource.source?.file ?? '',
      });
    claims.sort((a, b) => {
      const rank = (source: OwnershipSource) => {
        const index = precedence.indexOf(source);

        return index < 0 ? precedence.length : index;
      };

      return rank(a.source) - rank(b.source) || a.team.localeCompare(b.team);
    });
    const ownerProvenance = resource.provenance.fields.owner ?? resource.provenance.default;
    const explicit = resource.owner && ['declared', 'overridden'].includes(ownerProvenance);
    const owner = resource.owner && normalize(resource.owner.team);
    const selected = explicit ? owner : (claims[0]?.team ?? owner);

    if (!selected) return resource;

    const alternatives = [
      ...new Set([...claims.map((claim) => claim.team), ...(owner ? [owner] : [])]),
    ]
      .filter((team) => team !== selected)
      .sort();

    if (alternatives.length) conflicts.push({ resource: resource.ref, selected, alternatives });

    if (explicit || !claims.length) return resource;

    return {
      ...resource,
      owner: { team: selected },
      provenance: {
        ...resource.provenance,
        fields: {
          ...resource.provenance.fields,
          owner:
            claims[0]?.source === 'codeowners' ? ('inferred' as const) : ('extracted' as const),
        },
      },
    };
  });

  return { graph: { ...graph, resources }, conflicts };
}

export interface BackstageCatalogClient {
  getEntities(cursor?: string): Promise<JsonValue>;
}

export interface DatadogCatalogClient {
  getDefinitions(page: number): Promise<JsonValue>;
}

const backstagePage = z.object({
  items: z.array(jsonValueSchema),
  pageInfo: z.object({ nextCursor: z.string().optional() }).default({}),
});

export async function syncBackstageOwnership(
  client: BackstageCatalogClient,
  location: string,
): Promise<OwnershipImport> {
  const entities: JsonValue[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < 10000; page++) {
    const response = backstagePage.parse(await client.getEntities(cursor));
    entities.push(...response.items);
    cursor = response.pageInfo.nextCursor;

    if (!cursor) return importBackstageEntities(entities, location);

    if (seen.has(cursor)) throw new Error('Repeated Backstage cursor');
    seen.add(cursor);
  }

  throw new Error('Backstage page limit exceeded');
}

const datadogPage = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        schema: z.object({
          'dd-service': z.string().min(1),
          team: z.string().optional(),
          'dd-team': z.string().optional(),
          description: z.string().optional(),
        }),
      }),
    }),
  ),
});

export async function syncDatadogOwnership(
  client: DatadogCatalogClient,
  location: string,
  pageSize = 100,
): Promise<OwnershipImport> {
  const graph = emptyResourceGraph();
  const claims: OwnershipClaim[] = [];

  for (let page = 0; page < 10000; page++) {
    const response = datadogPage.parse(await client.getDefinitions(page));

    for (const definition of response.data) {
      const schema = definition.attributes.schema;
      const resource = architectureService(schema['dd-service']);
      resource.summary = schema.description;
      resource.source = { type: 'url', file: location };
      resource.provenance = { default: 'extracted', fields: {} };
      resource.needsReview = false;
      graph.resources.push(resource);
      const team = schema.team ?? schema['dd-team'];

      if (team) claims.push({ resource: resource.ref, team, source: 'datadog', location });
    }

    if (response.data.length < pageSize) return { graph: mergeArchitectureGraphs(graph), claims };
  }

  throw new Error('Datadog page limit exceeded');
}

/** One catalog page; Backstage pages are 500 entities, far below this. */
const MAX_CATALOG_RESPONSE_BYTES = 16 * 1024 * 1024;

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

export async function getCatalogJson(
  url: URL,
  headers: Record<string, string> = {},
): Promise<JsonValue> {
  const where = `${url.origin}${url.pathname}`;

  if (Object.keys(headers).length && url.protocol !== 'https:' && !isLoopback(url.hostname))
    throw new Error(
      `Refusing to send credentials over ${url.protocol} to ${url.hostname}; use https`,
    );

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });

  if (!response.ok) throw new Error(`Catalog request failed (${response.status}) at ${where}`);

  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;

    // Throwing out of the loop cancels the stream, so the rest is never downloaded.
    if (size > MAX_CATALOG_RESPONSE_BYTES) {
      throw new Error(
        `Catalog response from ${where} is larger than ${MAX_CATALOG_RESPONSE_BYTES} bytes`,
      );
    }

    chunks.push(chunk);
  }

  let value: JsonValue;

  try {
    value = jsonValueSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    // A parse error quotes the body, which may carry what the token unlocked.
    throw new Error(`Catalog response from ${where} is not JSON`);
  }

  return value;
}

export function backstageHttpClient(baseUrl: string, token?: string): BackstageCatalogClient {
  return {
    getEntities: async (cursor) => {
      const url = new URL(`${baseUrl.replace(/\/$/, '')}/entities/by-query`);
      url.searchParams.set('limit', '500');

      if (cursor) url.searchParams.set('cursor', cursor);

      return getCatalogJson(url, token ? { Authorization: `Bearer ${token}` } : {});
    },
  };
}

export function datadogHttpClient(
  baseUrl: string,
  apiKey: string,
  applicationKey: string,
): DatadogCatalogClient {
  return {
    getDefinitions: async (page) => {
      const url = new URL('/api/v2/services/definitions', baseUrl);
      url.searchParams.set('page[size]', '100');
      url.searchParams.set('page[number]', String(page));
      url.searchParams.set('schema_version', 'v2.2');

      return getCatalogJson(url, { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': applicationKey });
    },
  };
}
