import { z } from 'astro/zod';
import { resourceKey, type ResourceGraph, type ResourceRef } from 'autocatalog-core';
import { aboutReference } from 'autocatalog-docs-core';
import { catalogHref, docHref } from './view';

/** One end of a `describes` edge, as a page lists it. */
export interface ResourceLink {
  href: string;
  title: string;
  /** The repository a document sits in, or the `kind/id` a resource is named by. */
  label: string;
  /** A document's kind, such as `adr`, when it is one the organisation keeps. */
  kind?: string;
  /** Its kind's state, such as `accepted`. */
  status?: string;
}

// What the docs Adapter records about a document's kind; free-form in the graph.
const documentKind = z
  .object({ kind: z.string().optional(), status: z.string().optional() })
  .catch({});

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

      if (!doc) return [];

      const { kind, status } = documentKind.parse(doc.attributes);

      return [
        {
          href: docHref(`${from.namespace}/${from.id}`),
          title: doc.title,
          label: from.namespace ?? '',
          ...(kind && { kind }),
          ...(status && { status }),
        },
      ];
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
