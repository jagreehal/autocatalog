import fs from 'node:fs';
import path from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { schemaTree } from './ui/lib/schema-tree';
import {
  buildServices,
  datastoreOwnership,
  correlationPath,
  describeFieldConflict,
  durationSeconds,
  EXAMPLE_CASE_MEANING,
  EXAMPLE_CASES,
  eventRuntimeEvidence,
  hasFieldConflict,
  indexFields,
  provenanceSummary,
  type EventFrontmatter,
  type LoadedExample,
  type ResourceGraph,
} from 'autocatalog-core';
import { z } from 'zod';
import { sourceUrl } from 'autocatalog-docs-core';
import { documentsAbout } from './about';
import { failureSource, type CatalogEvent, type DocsCatalog } from './catalog';
import { docsSiteConfig } from './config';
import { eventCatalogEmbeds } from './eventcatalog';
import { architectureHref } from './eventcatalog-path';
import { eventPath, eventsForService, fieldCarriers } from './event-path';
import { eventVersions, versionChangesHtml, versionLinks, versionPath } from './event-versions';
import {
  byKind,
  graphOwners,
  ownerContact,
  ownerFor,
  ownerHref,
  resourceHref,
  type Owner,
} from './owners';
import { type ShellLink, versionLabel } from './shell';
import { explorerModel } from './ui/components/catalog-explorer-model';
import type { EventCatalogDiagramProps } from './ui/components/EventCatalogDiagram';
import type { DeliveryView } from './ui/components/DeliveryFacts';
import type { ExampleView } from './ui/components/Examples';
import { runtimeEvidenceView } from './runtime-evidence-view';
import type {
  CatalogPageProps,
  EventPageProps,
  EventVersionPageProps,
  FieldsPageProps,
  HomePageProps,
  OwnerPageProps,
  OwnersPageProps,
  ServicePageProps,
} from './ui/pages';
import { catalogAnchor, groupByRepo, groupByTag, type DocListItem } from './view';
import { catalogGraph, flowGraph } from './visualiser';

// The view models the pages render. Everything that reads the catalog, the disk
// or the Markdown pipeline lives here, so what reaches a React page is plain,
// serialisable data and the page can be drawn from a fixture in Storybook.

const plurals = new Map<string, string>([
  ['repository', 'repositories'],
  ['relationship', 'relationships'],
]);

const label = (kind: string, count: number) =>
  count === 1 ? kind : (plurals.get(kind) ?? `${kind}s`);

export function homePageProps(
  catalog: DocsCatalog,
  items: DocListItem[],
  base: string,
): HomePageProps {
  const stats = [
    ...Object.entries(catalog.summary.resourcesByKind).map(([kind, count]) => ({
      label: label(kind, count),
      value: count,
      kind,
      href: `${base}catalog/?kind=${encodeURIComponent(kind)}`,
    })),
    {
      label: label('relationship', catalog.summary.relationships),
      value: catalog.summary.relationships,
    },
  ];

  // Every way into the catalog this build actually made, and nothing it did not.
  const explore: HomePageProps['explore'] = [
    {
      title: 'Knowledge graph',
      text: 'Every resource and relationship, with where each fact was read from.',
      href: `${base}catalog/`,
      icon: 'catalog',
    },
    ...(eventCatalogEmbeds()
      ? [
          {
            title: 'Architecture',
            text: 'Domains, services and events drawn as a map by EventCatalog.',
            href: `${base}architecture/`,
            icon: 'architecture' as const,
            kind: 'channel',
          },
        ]
      : []),
    ...(buildServices(catalog.events.map(({ event }) => event)).size > 0
      ? [
          {
            title: 'Services',
            text: 'What each service publishes and consumes, inferred from the events.',
            href: `${base}catalog/?kind=service`,
            icon: 'service' as const,
            kind: 'service',
          },
        ]
      : []),
    ...(catalog.events.length > 0
      ? [
          {
            title: 'Fields',
            text: 'Every field across every event, and who a change to it would reach.',
            href: `${base}fields/`,
            icon: 'fields' as const,
            kind: 'event',
          },
        ]
      : []),
    ...(graphOwners(catalog.graph).length > 0
      ? [
          {
            title: 'Owners',
            text: 'The teams the catalog names, and everything each one owns.',
            href: `${base}owners/`,
            icon: 'owners' as const,
            kind: 'owner',
          },
        ]
      : []),
    {
      title: 'For agents',
      text: 'llms.txt, a Markdown twin of every document, and the graph as JSON.',
      href: `${base}llms.txt`,
      icon: 'braces',
      kind: 'agent',
    },
  ];

  return { stats, explore, repos: groupByRepo(items), tags: groupByTag(items) };
}

export function catalogPageProps(catalog: DocsCatalog, base: string): CatalogPageProps {
  return {
    failures: catalog.failures.map((failure) => ({
      repository: failure.repository,
      source: failureSource(failure),
      message: failure.message,
    })),
    datastores: datastoreOwnership(catalog.graph).map((row) => ({
      anchor: catalogAnchor(row.ref),
      id: row.ref.id,
      namespace: row.ref.namespace,
      owner: row.owner,
      writers: row.writers,
      readers: row.readers,
      evidence: row.evidence
        ? { count: row.evidence.count, environment: row.evidence.environment }
        : null,
    })),
    map: catalogGraph(catalog.graph, base),
    explorer: explorerModel(catalog.graph),
  };
}

export function fieldsPageProps(catalog: DocsCatalog, base: string): FieldsPageProps {
  const fields = indexFields(catalog.events.map(({ event }) => event));

  const carriers = fieldCarriers(catalog.events);

  return {
    eventCount: catalog.events.length,
    conflicts: fields.filter(hasFieldConflict).length,
    eventsHref: `${base}catalog/?kind=event`,
    fields: fields.map((field) => ({
      path: field.path,
      conflict: describeFieldConflict(field),
      types: field.types,
      carriers: field.occurrences.map((occurrence, i) => {
        const entry = carriers.get(field.path)?.[i];

        const shared =
          field.occurrences.filter((other) => other.eventId === occurrence.eventId).length > 1;

        return {
          eventId: occurrence.eventId,
          href: entry && `${base}${eventPath(entry)}`,
          repository: entry && shared ? entry.repository : undefined,
          optional: !occurrence.required,
        };
      }),
      consumers: field.consumers.map((name) => ({ name, href: `${base}services/${name}/` })),
      search: [
        field.path,
        ...field.occurrences.map((occurrence) => occurrence.eventId),
        ...field.consumers,
        ...field.producers,
      ]
        .join(' ')
        .toLowerCase(),
    })),
  };
}

export function ownersPageProps(catalog: DocsCatalog): OwnersPageProps {
  const owners = graphOwners(catalog.graph);

  // One column per kind any team owns, in the order owners list them.
  const columns = [
    ...new Map(
      owners.flatMap((owner) => byKind(owner)).map(({ kind, heading }) => [kind, heading]),
    ),
  ].map(([kind, heading]) => ({ kind, heading }));

  return {
    columns,
    owners: owners.map((owner) => ({
      name: owner.name,
      href: ownerHref(owner),
      counts: Object.fromEntries(
        byKind(owner).map(({ kind, resources }) => [kind, resources.length]),
      ),
    })),
  };
}

export function ownerPageProps(owner: Owner): OwnerPageProps {
  const { root } = docsSiteConfig();

  // A team handle only names a GitHub team when what it owns lives on GitHub.
  const onGitHub = owner.repositories.some((repository) =>
    sourceUrl(root, repository, 'tree')?.startsWith('https://github.com/'),
  );

  return {
    contact: ownerContact(owner, onGitHub),
    sections: byKind(owner).map((section) => ({
      kind: section.kind,
      heading: section.heading,
      resources: section.resources.map((resource) => ({
        kind: resource.ref.kind,
        title: resource.title,
        href: resourceHref(resource),
        namespace: resource.ref.namespace,
        summary: resource.summary,
      })),
    })),
  };
}

/** EventCatalog's drawing of one resource, or undefined when `ac site --eventcatalog` made none. */
export function diagramProps(
  base: string,
  target: string | undefined,
  title: string,
): EventCatalogDiagramProps | undefined {
  if (target === undefined) return undefined;

  return {
    embed: eventCatalogEmbeds()?.embed ?? false,
    iframeSrc: `${base}${target}?embed=true`,
    openHref: architectureHref(base, target),
    title,
  };
}

export function servicePageProps(
  catalog: DocsCatalog,
  service: { name: string },
  base: string,
): ServicePageProps {
  const { events } = catalog;

  const produces = eventsForService(events, service.name, 'producers');

  const consumes = eventsForService(events, service.name, 'consumers');

  const documents = documentsAbout(catalog.graph, { kind: 'service', id: service.name });

  const { owner, system } = serviceFacts(catalog.graph, service.name);

  const nodes = (list: CatalogEvent[]): ShellLink[] =>
    list.map((entry) => ({
      label: entry.event.frontmatter.name,
      href: `${base}${eventPath(entry)}`,
      kind: 'event',
    }));

  const flow = {
    from: nodes(consumes),
    inbound: 'consumed by',
    centre: { label: service.name, kind: 'service' as const },
    outbound: 'produces',
    to: nodes(produces),
  };

  const sections = [
    { heading: 'Produces', slug: 'produces', events: produces },
    { heading: 'Consumes', slug: 'consumes', events: consumes },
  ].flatMap((section) => {
    if (section.events.length === 0) return [];

    return [
      {
        ...section,
        events: section.events.map((entry) => {
          const { name, id, domain } = entry.event.frontmatter;

          const shared =
            section.events.filter((other) => other.event.frontmatter.id === id).length > 1;

          return {
            name,
            id,
            domain,
            href: `${base}${eventPath(entry)}`,
            repository: shared ? entry.repository : undefined,
          };
        }),
      },
    ];
  });

  return {
    flow,
    visualiser: flowGraph(flow),
    sections,
    documents,
    ...(owner && { owner }),
    ...(system && { system }),
    diagram: diagramProps(
      base,
      eventCatalogEmbeds()?.services[service.name],
      `${service.name} in EventCatalog`,
    ),
  };
}

// Attributes are free-form in the graph; only a web address is a link to offer.
const serviceRecord = z
  .object({
    repository: z
      .url({ protocol: /^https?$/ })
      .optional()
      .catch(undefined),
    system: z
      .object({ id: z.string().min(1), name: z.string().min(1).optional() })
      .optional()
      .catch(undefined),
  })
  .catch({});

export interface ServiceFacts {
  summary?: string;
  owner?: { team: string; href?: string | undefined };
  repository?: string;
  /** The system it is part of, by name. */
  system?: string;
}

/**
 * What a service says about itself in the graph, as EventCatalog, Backstage or
 * Datadog described it, beside what its events say of it.
 */
export function serviceFacts(graph: ResourceGraph, name: string): ServiceFacts {
  const resource = graph.resources.find((r) => r.ref.kind === 'service' && r.ref.id === name);

  if (!resource) return {};

  const owner = resource.owner && ownerFor(graphOwners(graph), resource.owner.team);
  const { repository, system } = serviceRecord.parse(resource.attributes);

  return {
    ...(resource.summary && { summary: resource.summary }),
    ...(resource.owner && {
      owner: {
        team: owner?.name ?? resource.owner.team,
        href: owner ? ownerHref(owner) : undefined,
      },
    }),
    ...(repository && { repository }),
    ...(system && { system: system.name ?? system.id }),
  };
}

/** Each example's JSON, pretty-printed. */
const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const;

/** `PT90M` as "1 hour 30 minutes": whole units, largest first, fractions only of seconds. */
function durationWords(iso: string): string {
  let left = durationSeconds(iso) ?? 0;

  const words = UNITS.flatMap(([unit, size]) => {
    const count = unit === 'second' ? left : Math.floor(left / size);

    left -= count * size;

    return count ? [`${count} ${unit}${count === 1 ? '' : 's'}`] : [];
  }).join(' ');

  // No lateness at all is a promise too, and the strictest one.
  return words || '0 seconds';
}

/** An event's delivery promise as its page shows it. */
export function deliveryView(
  delivery: EventFrontmatter['delivery'],
  /** The field a journey is traced by, declared or found in the schema. */
  correlation?: string,
): DeliveryView | undefined {
  if (!delivery && !correlation) return undefined;

  const { maxLateness, correlationKey, ...rest } = delivery ?? {};
  const tracedBy = correlationKey ?? correlation;

  return {
    ...rest,
    ...(maxLateness && { maxLateness: durationWords(maxLateness) }),
    ...(tracedBy && { correlationKey: tracedBy }),
  };
}

/** The happy path first, then each case in the order EXAMPLE_CASES gives them. */
const exampleOrder = (example: LoadedExample) =>
  example.case ? EXAMPLE_CASES.indexOf(example.case) + 1 : 0;

export function exampleViews(examples: LoadedExample[]): ExampleView[] {
  return [...examples]
    .sort((a, b) => exampleOrder(a) - exampleOrder(b))
    .map((example) => {
      // What the author wrote, else what the case is for.
      const summary = example.summary ?? (example.case && EXAMPLE_CASE_MEANING[example.case]);

      return {
        name: example.name,
        code: JSON.stringify(example.data, null, 2),
        ...(example.title && { title: example.title }),
        ...(example.case && { case: example.case }),
        ...(summary && { summary }),
      };
    });
}

export async function eventPageProps(
  catalog: DocsCatalog,
  entry: CatalogEvent,
  agents: { producers: ShellLink[]; consumers: ShellLink[] },
  base: string,
): Promise<EventPageProps> {
  const { repository, event } = entry;

  const fm = event.frontmatter;

  // Earlier versions from versioned/, each with its own page under this one.
  const versions = eventVersions(catalog, entry);

  const documents = documentsAbout(catalog.graph, {
    kind: 'event',
    namespace: `${repository}/${fm.domain}`,
    id: fm.id,
  });

  // The folder is the generated contract, so it is linked to rather than edited;
  // the one file in it a person writes is the optional index.mdx narrative.
  const { root } = docsSiteConfig();

  const folder = path.relative(root, event.folder.path).split(path.sep).join('/');

  // A catalog the site discovered, rather than one committed, has no folder in
  // the repository to link to.
  const source = folder.startsWith('..') ? null : sourceUrl(root, folder, 'tree');

  const edit = fs.existsSync(path.join(event.folder.path, 'index.mdx'))
    ? sourceUrl(root, `${folder}/index.mdx`, 'edit')
    : null;

  // An event folder's optional index.mdx is the team's own words beside the
  // contract: a caveat, a runbook step. It renders as Markdown; regenerating the
  // catalog never touches it.
  const narrativeHtml = event.body.trim()
    ? (await (await createMarkdownProcessor()).render(event.body)).code
    : null;

  const owner = fm.owner && ownerFor(graphOwners(catalog.graph), fm.owner.team);

  const services = (names: string[]): ShellLink[] =>
    names.map((name) => ({ label: name, href: `${base}services/${name}/`, kind: 'service' }));

  const flow = {
    from: [...services(fm.producers), ...agents.producers],
    inbound: 'publishes',
    centre: { label: fm.name, detail: versionLabel(fm.version), kind: 'event' as const },
    outbound: 'subscribed by',
    to: [...services(fm.consumers), ...agents.consumers],
  };

  // The facts that identify the event, beyond the title and crumbs above.
  const facts: Array<[string, string]> = [
    ['Id', fm.id],
    ['Domain', fm.domain],
    ['Repository', repository],
  ];

  if (fm.tags.length) facts.push(['Tags', fm.tags.join(', ')]);

  const deprecation =
    fm.status === 'deprecated'
      ? fm.deprecation
        ? `Since ${fm.deprecation.since}.${fm.deprecation.replacedBy ? ` Use ${fm.deprecation.replacedBy.id}.` : ''} ${fm.deprecation.notes ?? ''}`
        : 'This event is deprecated.'
      : null;

  return {
    owner: fm.owner && {
      team: owner?.name ?? fm.owner.team,
      href: owner ? ownerHref(owner) : undefined,
    },
    provenance: {
      ...provenanceSummary(fm),
      method: fm.provenance.default,
      confidence: fm.confidence ?? null,
      needsReview: fm.needsReview,
    },
    deprecation,
    narrativeHtml,
    flow,
    visualiser: flowGraph(flow),
    schema: schemaTree(event.schema),
    schemaHref: `${base}${eventPath(entry)}schema.json`,
    evidence: runtimeEvidenceView(eventRuntimeEvidence(fm), `${fm.domain}/${fm.id}`),
    examples: exampleViews(event.examples),
    versions: versionLinks(versions, entry, base),
    changesHtml: await versionChangesHtml(versions, entry),
    documents,
    facts,
    transport: fm.transport,
    delivery: deliveryView(fm.delivery, correlationPath(event)),
    source,
    edit,
    diagram: diagramProps(base, eventCatalogEmbeds()?.events[fm.id], `${fm.name} in EventCatalog`),
  };
}

export async function eventVersionPageProps(
  entry: CatalogEvent,
  versions: CatalogEvent[],
  base: string,
): Promise<EventVersionPageProps> {
  const { event } = entry;

  const current = versions.find(({ event: other }) => !other.folder.isVersioned);

  return {
    version: event.frontmatter.version,
    current: current && {
      href: `${base}${versionPath(current)}`,
      version: current.event.frontmatter.version,
    },
    schema: schemaTree(event.schema),
    schemaHref: `${base}${versionPath(entry)}schema.json`,
    examples: exampleViews(event.examples),
    versions: versionLinks(versions, entry, base),
    changesHtml: await versionChangesHtml(versions, entry),
  };
}
