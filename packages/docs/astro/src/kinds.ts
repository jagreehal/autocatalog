import {
  buildServices,
  isJsonObject,
  resourceKey,
  type JsonObject,
  type JsonValue,
  type ResourceRef,
} from 'autocatalog-core';
import {
  type DocKind,
  type DocsManifest,
  SUPERSEDE_FIELDS,
  supersession,
} from 'autocatalog-docs-core';
import { z } from 'astro/zod';
import type { ResourceLink } from './about';
import type { DocsCatalog } from './catalog';
import type { IconName } from './icons';
import { graphOwners, ownerFor, ownerHref } from './owners';
import type { ResourceLinksProps } from './ui/components/ResourceLinks';
import { fieldHeading } from './ui/lib/status';
import type { KindCell, KindChainLink, KindIndexPageProps, KindRow } from './ui/pages';
import type { TitleFact } from './ui/overrides/PageTitleChrome';
import { catalogHref, day, docHref } from './view';

/**
 * The first path segment of every page this plugin injects. A kind's index
 * page sits at `/<path>/`, so a path in this list would lose to the page
 * already there. routes.test.ts keeps the two in step.
 */
export const RESERVED_SEGMENTS = new Set([
  'apis',
  'architecture',
  'catalog',
  'catalog.json',
  'channels',
  'contracts',
  'data',
  'data-products',
  'domains',
  'entities',
  'events',
  'fields',
  'flows',
  'designs',
  'glossary',
  'llms-full.txt',
  'llms.txt',
  'owners',
  'retirements',
  'schemas',
  'services',
  'specs',
  'systems',
]);

/**
 * The kinds that get an index page: those with at least one document. A
 * kind's path shares the site's first URL segment with every repository's
 * documents, so one naming an enrolled repository or a page the site already
 * publishes is refused with the file to change, before any page is built.
 */
export function publishedKinds(
  kinds: DocKind[],
  manifest: DocsManifest,
  repositories: Set<string>,
): DocKind[] {
  const used = new Set(Object.values(manifest).map((entry) => entry.kind));
  const published = kinds.filter((kind) => used.has(kind.id));

  for (const kind of published) {
    const clash = repositories.has(kind.path)
      ? `the ${kind.path} repository's documents`
      : RESERVED_SEGMENTS.has(kind.path)
        ? `the site's own /${kind.path}/ page`
        : undefined;

    if (clash) {
      throw new Error(
        `The ${kind.id} kind's index page /${kind.path}/ would share its address with ${clash}. Set "path" for ${kind.id} in contracts/autocatalog.conventions.json.`,
      );
    }
  }

  return published;
}

/** Each kind's icon; a kind an organisation adds is drawn as a document. */
export function docKindIcon(kind: DocKind): IconName {
  switch (kind.id) {
    case 'adr':
      return 'decision';
    case 'runbook':
      return 'runbook';
    case 'incident':
      return 'incident';
    default:
      return 'doc';
  }
}

/** How many documents of each published kind there are. */
export function kindCounts(catalog: Pick<DocsCatalog, 'kinds' | 'manifest'>): Map<DocKind, number> {
  const counts = new Map(catalog.kinds.map((kind) => [kind.id, 0]));

  for (const entry of Object.values(catalog.manifest)) {
    if (entry.kind && counts.has(entry.kind)) counts.set(entry.kind, counts.get(entry.kind)! + 1);
  }

  return new Map(catalog.kinds.map((kind) => [kind, counts.get(kind.id) ?? 0]));
}

/**
 * The kind as a count says it: "3 decisions", "1 decision".
 * The singular drops a final "s"; a label with an irregular plural can add its
 * own singular to the conventions file when one needs it.
 */
export function kindNoun(kind: DocKind, count: number): string {
  const many = kind.label.toLowerCase();

  return count === 1 ? many.replace(/s$/, '') : many;
}

/** `decisions` for one kind's index page, under the site's base. */
export const kindHref = (base: string, kind: DocKind) => `${base}${kind.path}/`;

/** A field's heading: its schema `title` when the organisation wrote one. */
function heading(kind: DocKind, field: string): string {
  const declared = text.safeParse(propertyOf(kind, field)?.title);

  return declared.success ? declared.data : fieldHeading(field);
}

function propertyOf(kind: DocKind, field: string): JsonObject | undefined {
  const properties = kind.schema?.properties;
  const property = isJsonObject(properties) ? properties[field] : undefined;

  return isJsonObject(property) ? property : undefined;
}

const isDateField = (kind: DocKind, field: string) =>
  field === kind.dateField || propertyOf(kind, field)?.format === 'date';

const text = z.string().min(1);

// A value a column or a fact can show as written.
const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** A frontmatter value as one line of text, dates in the site's one format. */
function valueText(kind: DocKind, field: string, value: JsonValue | undefined): string | null {
  const list = z.array(scalar).safeParse(value);

  if (list.success) return list.data.map(String).join(', ') || null;

  const single = scalar.safeParse(value);

  if (!single.success || single.data === '') return null;

  const written = String(single.data);

  return isDateField(kind, field) ? (day(written) ?? written) : written;
}

/** One kind's documents for its index page, newest first by the kind's date. */
export function kindIndexProps(catalog: DocsCatalog, kind: DocKind): KindIndexPageProps {
  const owners = graphOwners(catalog.graph);

  const cell = (field: string, data: JsonObject): KindCell | null => {
    const text = valueText(kind, field, data[field]);

    if (text === null) return null;

    if (field === kind.statusField) return { text, status: true };

    if (field === 'owner') {
      const owner = ownerFor(owners, text);

      return owner ? { text, href: ownerHref(owner) } : { text };
    }

    return { text };
  };

  const rows: Array<KindRow & { sortDate: string }> = catalog.docs.flatMap((doc) => {
    const entry = catalog.manifest[doc.id];

    if (entry?.kind !== kind.id) return [];

    const summary = text.optional().catch(undefined).parse(doc.data.summary);

    return [
      {
        id: doc.id,
        title: entry.title,
        href: docHref(doc.id),
        repository: doc.repo,
        ...(summary && { summary }),
        ...(entry.status && { status: entry.status }),
        cells: Object.fromEntries(kind.columns.map((field) => [field, cell(field, doc.data)])),
        sortDate: entry.date ?? '',
      },
    ];
  });

  // Newest first; undated after dated, then by title.
  rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.title.localeCompare(b.title));

  const declared = propertyOf(kind, kind.statusField ?? '')?.enum;
  const present = new Set(rows.flatMap((row) => (row.status ? [row.status] : [])));

  // The schema's order when it has one, which is the order a state moves in.
  const order = Array.isArray(declared) ? declared.map(String) : [];

  const statuses = [
    ...order.filter((status) => present.has(status)),
    ...[...present].filter((status) => !order.includes(status)).sort(),
  ];

  return {
    columns: kind.columns.map((field) => ({ field, heading: heading(kind, field) })),
    rows: rows.map(({ sortDate: _sortDate, ...row }) => row),
    statuses,
    repositories: [...new Set(rows.map((row) => row.repository))].sort(),
    chains: supersedeChains(catalog, kind),
  };
}

/**
 * Each line of succession among one kind's documents, oldest first: the
 * decision that was replaced, then each one that replaced it. Either side may
 * declare the edge, so a chain holds when only the newer document says so.
 */
export function supersedeChains(catalog: DocsCatalog, kind: DocKind): KindChainLink[][] {
  const next = new Map<string, string[]>();
  const replaced = new Set<string>();

  const link = (older: string, newer: string) => {
    if (!Object.hasOwn(catalog.manifest, older) || !Object.hasOwn(catalog.manifest, newer)) return;

    const after = next.get(older) ?? [];

    if (!after.includes(newer)) after.push(newer);
    next.set(older, after.sort());
    replaced.add(newer);
  };

  for (const doc of catalog.docs) {
    if (catalog.manifest[doc.id]?.kind !== kind.id) continue;

    for (const older of supersession(doc.data).supersedes) link(older, doc.id);

    for (const newer of supersession(doc.data).supersededBy) link(doc.id, newer);
  }

  const toLink = (id: string): KindChainLink => {
    const entry = catalog.manifest[id]!;

    return { title: entry.title, href: docHref(id), ...(entry.status && { status: entry.status }) };
  };

  // A decision replaced by two follows the first by id, which keeps each chain
  // a single line.
  return [...next.keys()].sort().flatMap((start) => {
    if (replaced.has(start)) return [];

    const chain = [start];

    for (let id = next.get(start)?.[0]; id && !chain.includes(id); id = next.get(id)?.[0]) {
      chain.push(id);
    }

    return [chain.map(toLink)];
  });
}

/** What a document of a kind shows in its title block. */
export interface KindHeader {
  kind: DocKind;
  status?: string;
  facts: TitleFact[];
}

/**
 * The title block of a decision, runbook or incident: its state as a badge,
 * then its kind, date, the kind's other fields, what it applies to and what
 * it replaced, each linked to its page.
 */
export function kindHeader(catalog: DocsCatalog, id: string, base: string): KindHeader | undefined {
  const entry = catalog.manifest[id];
  const kind = catalog.kinds.find((candidate) => candidate.id === entry?.kind);
  const doc = catalog.docs.find((candidate) => candidate.id === id);

  if (!entry || !kind || !doc) return undefined;

  const facts: TitleFact[] = [
    { term: 'Kind', links: [{ label: kind.label, href: kindHref(base, kind) }] },
  ];

  // The date first, then the rest of the kind's fields in the order its schema
  // declares them. The state is the badge, and succession is links below.
  const fields = [
    ...(kind.dateField ? [kind.dateField] : []),
    ...Object.keys(isJsonObject(kind.schema?.properties) ? kind.schema.properties : {}),
  ];

  const skip = new Set<string>([
    ...SUPERSEDE_FIELDS,
    ...(kind.statusField ? [kind.statusField] : []),
  ]);

  for (const field of new Set(fields)) {
    const text = skip.has(field) ? null : valueText(kind, field, doc.data[field]);

    if (text !== null) facts.push({ term: heading(kind, field), text });
  }

  const applies = appliesTo(catalog, id, base);

  if (applies.length > 0) facts.push({ term: 'Applies to', links: applies });

  for (const field of SUPERSEDE_FIELDS) {
    // Only ids the manifest knows become links, so a link always lands on a
    // page of this site; `ac docs check` names the ones that do not resolve.
    const links = supersession(doc.data)[field].flatMap((target) => {
      const entry = Object.hasOwn(catalog.manifest, target) ? catalog.manifest[target] : undefined;

      return entry ? [{ label: entry.title, href: docHref(target) }] : [];
    });

    if (links.length > 0) facts.push({ term: heading(kind, field), links });
  }

  return { kind, ...(entry.status && { status: entry.status }), facts };
}

/**
 * The resources a document's `about:` names, each linked to its own page:
 * a service's or event's page when the site has one, else its catalog entry.
 */
function appliesTo(
  catalog: DocsCatalog,
  id: string,
  base: string,
): NonNullable<TitleFact['links']> {
  const [namespace, ...rest] = id.split('/');
  const from: ResourceRef = { kind: 'document', namespace, id: rest.join('/') };

  const byKey = new Map(
    catalog.graph.resources.map((resource) => [resourceKey(resource.ref), resource]),
  );

  const services = buildServices(catalog.events.map(({ event }) => event));

  return catalog.graph.relationships.flatMap(({ type, from: source, to }) => {
    if (type !== 'describes' || resourceKey(source) !== resourceKey(from)) return [];

    const resource = byKey.get(resourceKey(to));

    if (!resource) return [];

    const href =
      to.kind === 'service' && services.has(to.id)
        ? `${base}services/${to.id}/`
        : to.kind === 'event' && to.namespace
          ? `${base}events/${to.namespace}/${to.id}/`
          : catalogHref(to);

    return [{ label: resource.title, href }];
  });
}

/** Plain documents, and one card of links per kind. */
export interface DocumentsByKind {
  documents: ResourceLink[];
  records: ResourceLinksProps[];
}

/**
 * The documents about one resource, split the way its page lists them: plain
 * documents together, and one card per kind ("Decisions", "Runbooks"), each
 * only when it has any.
 */
export function documentsByKind(kinds: DocKind[], links: ResourceLink[]): DocumentsByKind {
  const known = new Set(kinds.map((kind) => kind.id));

  const records = kinds.flatMap((kind) => {
    const own = links.filter((link) => link.kind === kind.id);

    return own.length > 0 ? [{ id: kind.path, heading: kind.label, links: own }] : [];
  });

  return { documents: links.filter((link) => !link.kind || !known.has(link.kind)), records };
}
