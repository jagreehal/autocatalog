import { resourceKey, type ResourceGraph, type ResourceRef } from 'autocatalog-core';
import { aboutReference } from 'autocatalog-docs-core';
import { catalogHref, docHref } from './view';

/** One end of a `describes` edge, as a page lists it. */
export interface ResourceLink {
  href: string;
  title: string;
  /** The repository a document sits in, or the `kind/id` a resource is named by. */
  label: string;
}

// Versions are left out: a page shows the current version, and the edge was
// drawn to it.
const sameResource = (a: ResourceRef, b: ResourceRef) =>
  a.kind === b.kind && a.namespace === b.namespace && a.id === b.id;

/** Documents that declare in `about:` that they describe one resource. */
export function documentsAbout(graph: ResourceGraph, target: ResourceRef): ResourceLink[] {
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));

  return graph.relationships
    .filter(({ type, to }) => type === 'describes' && sameResource(to, target))
    .flatMap(({ from }) => {
      const doc = byKey.get(resourceKey(from));

      return doc
        ? [
            {
              href: docHref(`${from.namespace}/${from.id}`),
              title: doc.title,
              label: from.namespace ?? '',
            },
          ]
        : [];
    });
}

/** The resources one document declares it is about, linked into the catalog. */
export function aboutDocument(graph: ResourceGraph, id: string): ResourceLink[] {
  const [namespace, ...path] = id.split('/');
  const from: ResourceRef = { kind: 'document', namespace, id: path.join('/') };
  const byKey = new Map(graph.resources.map((resource) => [resourceKey(resource.ref), resource]));

  return graph.relationships
    .filter(
      (relationship) => relationship.type === 'describes' && sameResource(relationship.from, from),
    )
    .flatMap(({ to }) => {
      const resource = byKey.get(resourceKey(to));

      return resource
        ? [{ href: catalogHref(to), title: resource.title, label: aboutReference(resource) ?? '' }]
        : [];
    });
}
