import type { APIContext } from 'astro';
import { type ResourceGraph, type ResourceRef, summarizeResourceGraph } from 'autocatalog-core';
import type { Doc } from 'autocatalog-docs-core';
import { z } from 'zod';
import type { DocsCatalog } from './catalog';

/** The name a reader nobody signed in as goes by, in the build's table and in dev. */
export const SIGNED_OUT = 'signed out';

/** A document as the rule sees it: its id and its frontmatter as written. */
export type AccessDoc = Pick<Doc, 'id' | 'data'>;

/**
 * What `access.module` in autocatalog.site.json default-exports. `reader`
 * reads your session from the request: a cookie, a token, a header your proxy
 * sets. Undefined is a reader nobody signed in as. What it returns is
 * `Astro.locals.reader` on every page.
 *
 * `canRead` decides one document. Without it a document opens when the reader's
 * `access` holds everything its frontmatter's `access` lists, and a document
 * that lists nothing opens for everyone.
 */
export interface SiteAccess<Reader = AccessReader> {
  reader(context: APIContext): Reader | undefined | Promise<Reader | undefined>;
  canRead?: ((doc: AccessDoc, reader: Reader | undefined) => boolean) | undefined;
  /**
   * Readers to try the rule as, by name. The build prints what each may open
   * and warns of a link one may follow to a document they may not open, and
   * `ac site dev` offers to view the site as each.
   */
  readers?: Readonly<Record<string, Reader>> | undefined;
  /**
   * Told each time a reader is refused a document, before the refusal is sent:
   * for analytics, such as which features readers try to open.
   */
  onDenied?:
    | ((doc: AccessDoc, reader: Reader | undefined, context: APIContext) => void | Promise<void>)
    | undefined;
}

const held = z.object({ access: z.array(z.string()).optional() });

/** `access: payments` or `access: [payments, invoicing]`. */
const needs = z.union([z.string().transform((one) => [one]), z.array(z.string())]).optional();

/** What the rule without a `canRead` reads of a reader. */
export interface AccessReader {
  access?: readonly string[] | undefined;
}

/** The rule without a `canRead`. Frontmatter it cannot read keeps the document closed. */
export function defaultCanRead(doc: AccessDoc, reader: AccessReader | undefined): boolean {
  const required = needs.safeParse(doc.data.access);

  if (!required.success) return false;

  const has = reader?.access ?? [];

  return (required.data ?? []).every((feature) => has.includes(feature));
}

/** The rule for one reader. A `canRead` that throws keeps the document closed. */
export function accessRule<Reader>(
  access: SiteAccess<Reader>,
  reader: Reader | undefined,
): (doc: AccessDoc) => boolean {
  return (doc) => {
    try {
      if (access.canRead) return access.canRead(doc, reader);

      // Without a `canRead`, only what the default rule reads of the reader.
      return defaultCanRead(doc, held.safeParse(reader).data);
    } catch (error) {
      console.error(`access: canRead threw for ${doc.id}, so it stays closed`, error);

      return false;
    }
  };
}

/** The catalog with only the documents this reader may open. */
export function readableCatalog(
  catalog: DocsCatalog,
  canRead: ((doc: AccessDoc) => boolean) | undefined,
): DocsCatalog {
  if (!canRead) return catalog;

  const docs = catalog.docs.filter(canRead);
  const ids = new Set(docs.map((doc) => doc.id));

  // A document in the graph is `document:<repository>/<path>`, as its id is.
  const closed = (ref: ResourceRef) =>
    ref.kind === 'document' && !ids.has(`${ref.namespace}/${ref.id}`);

  const graph: ResourceGraph = {
    ...catalog.graph,
    resources: catalog.graph.resources.filter((resource) => !closed(resource.ref)),
    relationships: catalog.graph.relationships.filter(
      (relationship) => !closed(relationship.from) && !closed(relationship.to),
    ),
  };

  return {
    ...catalog,
    docs,
    manifest: Object.fromEntries(Object.entries(catalog.manifest).filter(([id]) => ids.has(id))),
    flowNotes: catalog.flowNotes.filter((note) => ids.has(note.id)),
    graph,
    summary: summarizeResourceGraph(graph),
  };
}

/** A request or link path as `docHref` writes it: decoded, without a trailing slash. */
export function servedPath(pathname: string): string {
  try {
    return decodeURI(pathname).replace(/\/$/, '');
  } catch {
    return pathname.replace(/\/$/, '');
  }
}
