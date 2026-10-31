import {
  relationshipKey,
  resourceKey,
  resourceSchema,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
} from 'autocatalog-core';
import { catalogAnchor } from '../../view';

// Built where autocatalog-core can run: the explorer is hydrated in the
// browser, which cannot load core, so the page hands it this model instead of
// the graph.

/** One edge of a resource, as seen from that resource. */
export interface Connection {
  key: string;
  direction: 'in' | 'out';
  type: string;
  provenance: string;
  /** The resource at the other end, when the graph holds it. */
  target: { title: string; anchor: string } | null;
  /** The other end's key, shown for an end the graph does not hold. */
  targetKey: string;
  evidence: string | null;
}

export interface ExplorerRow {
  key: string;
  anchor: string;
  kind: string;
  title: string;
  href: string;
  summary: string | null;
  evidence: string | null;
  owner: string | null;
  provenance: string;
  at: string | null;
  commit: string | null;
  needsReview: boolean;
  /** Only the fields that disagree with the resource's own default. */
  notableFields: Array<[string, string]>;
  schemaJson: string | null;
  connections: Connection[];
  searchText: string;
}

export interface ExplorerModel {
  rows: ExplorerRow[];
  kinds: string[];
  /** How many resources of each kind the graph holds. */
  countByKind: Record<string, number>;
  relationships: number;
  review: number;
}

const baseUrl = () => import.meta.env.BASE_URL.replace(/\/?$/, '/');

function hrefOf(resource: CatalogResource): string {
  if (!resource.url) return `#${catalogAnchor(resource.ref)}`;

  return `${baseUrl()}${resource.url.replace(/^\//, '')}`;
}

function searchText(resource: CatalogResource): string {
  return [
    resource.ref.kind,
    resource.ref.namespace,
    resource.ref.id,
    // `payments/payment.completed`, as an abbreviated wiki link searches for it.
    resource.ref.namespace && `${resource.ref.namespace}/${resource.ref.id}`,
    resource.title,
    resource.summary,
    resource.owner?.team,
    ...resource.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function locationOf(resource: CatalogResource): string | null {
  if (!resource.source?.file) return null;

  return `${resource.source.file}${resource.source.line ? `:${resource.source.line}` : ''}`;
}

/** The whole graph, ready to draw: adjacency built once, rows in key order. */
export function explorerModel(graph: ResourceGraph): ExplorerModel {
  const resources = [...graph.resources].sort((a, b) =>
    resourceKey(a.ref).localeCompare(resourceKey(b.ref)),
  );

  const byKey = new Map(resources.map((resource) => [resourceKey(resource.ref), resource]));

  const countByKind = new Map<string, number>();

  for (const resource of resources) {
    countByKind.set(resource.ref.kind, (countByKind.get(resource.ref.kind) ?? 0) + 1);
  }

  // Filtering the relationship list per resource is resources × relationships
  // string comparisons: fine for a demo and minutes for a company-sized graph.
  const adjacency = new Map<string, CatalogRelationship[]>();

  for (const relationship of graph.relationships) {
    for (const key of new Set([resourceKey(relationship.from), resourceKey(relationship.to)])) {
      const bucket = adjacency.get(key);

      if (bucket) bucket.push(relationship);
      else adjacency.set(key, [relationship]);
    }
  }

  const connectionsOf = (resource: CatalogResource): Connection[] => {
    const current = resourceKey(resource.ref);

    return (adjacency.get(current) ?? []).map((relationship): Connection => {
      const outbound = resourceKey(relationship.from) === current;

      const otherKey = resourceKey(outbound ? relationship.to : relationship.from);

      const other = byKey.get(otherKey);

      const traces = relationship.evidence?.sampleTraceIds ?? [];

      return {
        key: relationshipKey(relationship),
        direction: outbound ? 'out' : 'in',
        type: relationship.type,
        provenance: relationship.provenance,
        target: other ? { title: other.title, anchor: catalogAnchor(other.ref) } : null,
        targetKey: otherKey,
        evidence: relationship.evidence
          ? `${relationship.evidence.count} observations${traces.length > 0 ? `; traces ${traces.slice(0, 3).join(', ')}` : ''}`
          : null,
      };
    });
  };

  const rows = resources.map((resource): ExplorerRow => {
    const key = resourceKey(resource.ref);

    const schema = resourceSchema(resource);

    return {
      key,
      anchor: catalogAnchor(resource.ref),
      kind: resource.ref.kind,
      title: resource.title,
      href: hrefOf(resource),
      summary: resource.summary ?? null,
      evidence: resource.evidence
        ? `${resource.evidence.count} observed accesses${resource.evidence.lastSeen ? `; last seen ${resource.evidence.lastSeen}` : ''}. Coverage unknown.`
        : null,
      owner: resource.owner?.team ?? null,
      provenance: resource.needsReview ? 'inferred' : resource.provenance.default,
      at: locationOf(resource),
      commit: resource.source?.ref ?? null,
      needsReview: resource.needsReview,
      // A row of twelve identical tags says nothing about where to look.
      notableFields: Object.entries(resource.provenance.fields)
        .filter(([, value]) => value !== resource.provenance.default)
        .sort(([a], [b]) => a.localeCompare(b)),
      schemaJson: schema ? JSON.stringify(schema, null, 2) : null,
      connections: connectionsOf(resource),
      searchText: searchText(resource),
    };
  });

  return {
    rows,
    kinds: [...countByKind.keys()].sort(),
    countByKind: Object.fromEntries(countByKind),
    relationships: graph.relationships.length,
    review: resources.filter((resource) => resource.needsReview).length,
  };
}
