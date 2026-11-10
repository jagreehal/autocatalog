import {
  closestMatch,
  isDocumentCatalogResource,
  isEventCatalogResource,
  isServiceCatalogResource,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceRef,
} from 'autocatalog-core';
import { frontmatterSchema } from './frontmatter';
import type { Doc } from './read-docs';
import { documentRef } from './resource-graph';

/**
 * How `about:` names a resource: `kind/id`, the form Agent-system references
 * already take, and `event/<domain>/<id>` for an Event, because an event id is
 * unique inside a domain and an Agent's `consumes` names it as `domain/id`.
 * A command is `command/<domain>/<id>` for the same reason: its namespace is
 * its domain.
 * Documents have none — `related:` is how one document names another.
 */
export function aboutReference(resource: CatalogResource): string | undefined {
  if (isDocumentCatalogResource(resource)) return undefined;

  if (isEventCatalogResource(resource)) {
    return `event/${resource.attributes.domain}/${resource.ref.id}`;
  }

  if (resource.ref.kind === 'command' && resource.ref.namespace) {
    return `command/${resource.ref.namespace}/${resource.ref.id}`;
  }

  return `${resource.ref.kind}/${resource.ref.id}`;
}

export type AboutResolution = { ref: ResourceRef } | { failure: string };

/**
 * Resolve one `about:` entry against the resources a graph holds. Two
 * repositories may publish the same event, so the document's own repository
 * wins, and with no local copy the reference is ambiguous rather than guessed.
 */
export function resolveAbout(
  reference: string,
  resources: CatalogResource[],
  repository?: string,
): AboutResolution {
  const named = resources.filter((resource) => aboutReference(resource) === reference);

  const local = named.filter(
    (resource) => repository && resource.ref.namespace?.startsWith(`${repository}/`),
  );

  const pick = local.length > 0 ? local : named;

  if (pick.length === 1) return { ref: pick[0]!.ref };

  // A domain is what its events and services name; no resource stands for it.
  const domain = /^domain\/(.+)$/.exec(reference)?.[1];

  if (
    domain &&
    pick.length === 0 &&
    resources.some(
      (resource) =>
        (isEventCatalogResource(resource) && resource.attributes.domain === domain) ||
        (isServiceCatalogResource(resource) && resource.attributes.domains.includes(domain)),
    )
  ) {
    return { ref: { kind: 'domain', id: domain } };
  }

  if (pick.length > 1) {
    return {
      failure: `about '${reference}' names ${pick.length} resources (${pick.map((resource) => resourceKey(resource.ref)).join(', ')}) — document it from the repository that owns it`,
    };
  }

  const hint = closestMatch(
    reference,
    resources.flatMap((resource) => aboutReference(resource) ?? []),
  );

  return {
    failure: `about '${reference}' does not resolve${hint ? ` — did you mean '${hint}'?` : ''}`,
  };
}

export interface DescribesRelationships {
  relationships: Array<CatalogRelationship<'describes'>>;
  /** One line per `about:` entry that did not resolve, naming the document. */
  failures: string[];
}

/**
 * The `describes` edges validated documents declare in `about:`, resolved
 * against a composed graph. Drawn after composition because the targets come
 * from other Adapters; an entry that does not resolve is reported rather than
 * drawn as an edge to nothing.
 */
export function createDescribesRelationships(
  docs: Doc[],
  resources: CatalogResource[],
  options: { repositories?: ReadonlyMap<string, string> } = {},
): DescribesRelationships {
  const relationships = new Map<string, CatalogRelationship<'describes'>>();
  const failures: string[] = [];

  for (const doc of docs) {
    const repository = options.repositories?.get(doc.repo) ?? doc.repo;

    for (const target of [...new Set(frontmatterSchema.parse(doc.data).about ?? [])].sort()) {
      const resolution = resolveAbout(target, resources, repository);

      if ('failure' in resolution) {
        failures.push(`${doc.file}: ${resolution.failure}`);
        continue;
      }

      const describes: CatalogRelationship<'describes'> = {
        type: 'describes',
        from: documentRef(doc.id),
        to: resolution.ref,
        provenance: 'declared',
        needsReview: false,
        source: { file: doc.file, repo: repository },
      };

      relationships.set(relationshipKey(describes), describes);
    }
  }

  return {
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, relationship]) => relationship),
    failures,
  };
}
