import {
  AUTOCATALOG_GRAPH_SPEC,
  createRepositoryResource,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type DocumentCatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import { frontmatterSchema } from './frontmatter';
import type { DocsManifest } from './manifest';
import type { Doc } from './read-docs';

export class DocsResourceGraphError extends Error {
  constructor(readonly documentId: string) {
    super(`document '${documentId}' is missing from the validated docs manifest`);
    this.name = 'DocsResourceGraphError';
  }
}

export function documentRef(id: string): ResourceRef<'document'> {
  const [repository, ...path] = id.split('/');

  if (!repository || path.length === 0) {
    throw new Error(`invalid document id '${id}'`);
  }

  return { kind: 'document', namespace: repository, id: path.join('/') };
}

function documentUrl(id: string): string {
  return `/${id.split('/').map(encodeURIComponent).join('/')}`;
}

export interface CreateDocsResourceGraphOptions {
  /**
   * Repository identity, when the id namespace is not the repository's name.
   *
   * A document's id is its address, and a site already served from `/<repo>/`
   * usually shortens that namespace. Events and Agents join on the repository's
   * real name, so the two are allowed to differ and only this one is identity.
   */
  repository?: string;
}

/**
 * Adapt validated, repository-owned documentation into the shared resource
 * graph. Repository resources intentionally contain only structural facts so
 * another Adapter can emit the same repository without creating a conflict.
 *
 * A Document's `ref.namespace` stays the id namespace, because that is how
 * every other document addresses it in `related`; the Repository it belongs to
 * is the edge, not the name.
 */
export function createDocsResourceGraph(
  docs: Doc[],
  manifest: DocsManifest,
  options: CreateDocsResourceGraphOptions = {},
): ResourceGraph {
  const resources = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();

  for (const doc of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const indexed = manifest[doc.id];

    if (!indexed) throw new DocsResourceGraphError(doc.id);

    // Every document here is in the validated manifest, which already
    // refused any document these fields do not parse for.
    const front = frontmatterSchema.parse(doc.data);
    const ref = documentRef(doc.id);
    const repositoryName = options.repository ?? doc.repo;
    const repository = createRepositoryResource(repositoryName);

    const resource: DocumentCatalogResource = {
      ref,
      title: indexed.title,
      summary: front.summary,
      url: documentUrl(doc.id),
      owner: { team: indexed.owner },
      tags: [...(front.tags ?? [])].sort(),
      provenance: {
        default: 'declared',
        fields: {
          id: 'extracted',
          repository: 'extracted',
          url: 'extracted',
        },
      },
      needsReview: false,
      source: { file: doc.file, repo: repositoryName },
      // A decision, runbook or incident says so, with its state, so a reader
      // of the graph can find every ADR about a service without the site.
      attributes: {
        repository: repositoryName,
        updated: indexed.updated,
        ...(indexed.kind && { kind: indexed.kind }),
        ...(indexed.status && { status: indexed.status }),
        ...(indexed.date && { date: indexed.date }),
      },
    };

    resources.set(resourceKey(repository.ref), repository);
    resources.set(resourceKey(ref), resource);

    const publishes: CatalogRelationship<'publishes'> = {
      type: 'publishes',
      from: repository.ref,
      to: ref,
      provenance: 'extracted',
      needsReview: false,
      source: resource.source,
    };

    relationships.set(relationshipKey(publishes), publishes);

    for (const target of [...new Set(front.related ?? [])].sort()) {
      const relatesTo: CatalogRelationship<'relatesTo'> = {
        type: 'relatesTo',
        from: ref,
        to: documentRef(target),
        provenance: 'declared',
        needsReview: false,
        source: resource.source,
      };

      relationships.set(relationshipKey(relatesTo), relatesTo);
    }
  }

  return {
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources: [...resources.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, resource]) => resource),
    relationships: [...relationships.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, relationship]) => relationship),
  };
}
