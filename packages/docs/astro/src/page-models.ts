import fs from 'node:fs';
import path from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { schemaTree } from './ui/lib/schema-tree';
import {
  buildServices,
  datastoreOwnership,
  correlationPath,
  deadLetterOf,
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
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { sourceUrl } from 'autocatalog-docs-core';
import { documentsAbout } from './about';
import { apiPath, apisForService, apiTitle } from './apis';
import { specificationPath, specificationsForService } from './specifications';
import { flowRecords } from './flows';
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
import { remarkMermaid } from './mermaid';
import { docKindIcon, documentsByKind, kindCounts, kindHref, kindNoun } from './kinds';
import { explorerModel } from './ui/components/catalog-explorer-model';
import type { EventCatalogDiagramProps } from './ui/components/EventCatalogDiagram';
import type { DeliveryView } from './ui/components/DeliveryFacts';
import type { DeadLetterView } from './ui/components/RuntimeEvidence';
import type { ExampleView } from './ui/components/Examples';
import { runtimeEvidenceView } from './runtime-evidence-view';
import type {
  CatalogPageProps,
  DomainPageProps,
  DomainsPageProps,
  EventPageProps,
  EventVersionPageProps,
  FieldsPageProps,
  HomePageProps,
  OwnerPageProps,
  OwnersPageProps,
  ServicePageProps,
} from './ui/pages';
import { catalogAnchor, groupByRepo, groupByTag, type DocListItem } from './view';
import { buildDomains, domainHref, type Domain } from './domains';
import {
  catalogGraph,
  domainNeighbourhood,
  flowGraph,
  runtimeByEvent,
  serviceNeighbourhood,
} from './visualiser';

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
  const domains = buildDomains(catalog.events).length;

  const stats = [
    ...Object.entries(catalog.summary.resourcesByKind).map(([kind, count]) => ({
      label: label(kind, count),
      value: count,
      kind,
      href: `${base}catalog/?kind=${encodeURIComponent(kind)}`,
    })),
    // Decisions, runbooks and incidents are documents too, counted again here
    // because "how many incidents" is a question the index is asked.
    ...[...kindCounts(catalog)].map(([kind, count]) => ({
      label: kindNoun(kind, count),
      value: count,
      href: kindHref(base, kind),
    })),
    {
      label: label('domain', domains),
      value: domains,
      href: `${base}domains/`,
    },
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
    ...(domains > 0
      ? [
          {
            title: 'Domains',
            text: 'Each domain’s events, the services around them, and a map of how they connect.',
            href: `${base}domains/`,
            icon: 'domain' as const,
            kind: 'domain',
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
    ...(catalog.events.length > 0
      ? [
          {
            title: 'Schemas',
            text: 'Every event schema, what it was written in, and who owns it.',
            href: `${base}schemas/`,
            icon: 'braces' as const,
            kind: 'event',
          },
        ]
      : []),
    ...(catalog.apis.length > 0
      ? [
          {
            title: 'APIs',
            text: 'The OpenAPI specs repositories commit, each with its reference.',
            href: `${base}apis/`,
            icon: 'api' as const,
            kind: 'service',
          },
        ]
      : []),
    ...(catalog.flows.length > 0
      ? [
          {
            title: 'Flows',
            text: 'Business processes step by step, grouped by domain or team.',
            href: `${base}flows/`,
            icon: 'flow' as const,
            kind: 'service',
          },
        ]
      : []),
    ...(catalog.specifications.length > 0
      ? [
          {
            title: 'Specifications',
            text: 'WSDL, XML Schema, GraphQL, AsyncAPI and other specifications, as written.',
            href: `${base}specs/`,
            icon: 'braces' as const,
            kind: 'service',
          },
        ]
      : []),
    ...catalog.kinds.map((kind) => ({
      title: kind.label,
      text: kind.description ?? `Every document under docs/${kind.folder}/, newest first.`,
      href: kindHref(base, kind),
      icon: docKindIcon(kind),
      kind: 'doc',
    })),
    ...(catalog.models.length > 0
      ? [
          {
            title: 'Data models',
            text: 'Every table and collection, its fields and relations, and who reads and writes it.',
            href: `${base}data/`,
            icon: 'data' as const,
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
    map: catalogGraph(catalog.graph, base, {
      servicePages: servicePages(catalog),
      eventPages: eventPages(catalog),
      ...mapEvidence(catalog),
    }),
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

export function domainsPageProps(catalog: DocsCatalog, base: string): DomainsPageProps {
  return {
    domains: buildDomains(catalog.events).map((domain) => ({
      name: domain.name,
      href: domainHref(base, domain.name),
      events: domain.events.length,
      services: domain.services.length,
      owners: domain.owners.length,
    })),
  };
}

export function domainPageProps(
  catalog: DocsCatalog,
  domain: Domain,
  base: string,
): DomainPageProps {
  const owners = graphOwners(catalog.graph);

  const role = (name: string, side: 'producers' | 'consumers') =>
    domain.events.filter(({ event }) => event.frontmatter[side].includes(name)).length;

  return {
    summary: catalog.graph.resources.find(
      (resource) => resource.ref.kind === 'domain' && resource.ref.id === domain.name,
    )?.summary,
    events: domain.events.map((entry) => {
      const { name, id, summary } = entry.event.frontmatter;

      const shared = domain.events.filter((other) => other.event.frontmatter.id === id).length > 1;

      return {
        name,
        id,
        href: `${base}${eventPath(entry)}`,
        summary,
        repository: shared ? entry.repository : undefined,
      };
    }),
    services: domain.services.map((name) => ({
      name,
      href: `${base}services/${name}/`,
      produces: role(name, 'producers'),
      consumes: role(name, 'consumers'),
    })),
    owners: domain.owners.map((team) => {
      const owner = ownerFor(owners, team);

      return { team: owner?.name ?? team, href: owner ? ownerHref(owner) : undefined };
    }),
    visualiser: catalogGraph(catalog.graph, base, {
      only: domainNeighbourhood(catalog.graph, domain.name),
      servicePages: servicePages(catalog),
      eventPages: eventPages(catalog),
      ...mapEvidence(catalog),
    }),
  };
}

/** The events with a page: every current event a repository publishes. */
export const eventPages = (catalog: Pick<DocsCatalog, 'events'>) =>
  new Set(catalog.events.map(eventPath));

/** What every map drawn from the catalog shows of runtime: snapshot evidence, and the live feed. */
const mapEvidence = (catalog: DocsCatalog) => ({
  runtime: runtimeByEvent(catalog.events, catalog.snapshots),
  live: docsSiteConfig().live,
});

/** The services with a page: every one an event names as producer or consumer. */
export const servicePages = (catalog: Pick<DocsCatalog, 'events'>) =>
  new Set(buildServices(catalog.events.map(({ event }) => event)).keys());

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

  const { documents, records: kindRecords } = documentsByKind(
    catalog.kinds,
    documentsAbout(catalog.graph, { kind: 'service', id: service.name }),
  );

  const records = [
    ...kindRecords,
    ...flowRecords(catalog.flows, { kind: 'service', id: service.name }, base),
  ];

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

  const apis = [
    ...apisForService(catalog.apis, events, service.name).map((api) => ({
      title: apiTitle(api),
      file: api.file,
      href: `${base}${apiPath(api)}`,
    })),
    ...specificationsForService(catalog.specifications, events, service.name).map((spec) => ({
      title: spec.title,
      file: spec.file,
      href: `${base}${specificationPath(spec)}`,
    })),
  ];

  return {
    flow,
    visualiser: catalogGraph(catalog.graph, base, {
      only: serviceNeighbourhood(catalog.graph, service.name),
      servicePages: servicePages(catalog),
      eventPages: eventPages(catalog),
      ...mapEvidence(catalog),
    }),
    sections,
    apis,
    documents,
    records,
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

/** The dead-letter queues consumers declare for one event, in `autocatalog.consumes.json`. */
function deadLetters(graph: ResourceGraph, event: ResourceRef): DeadLetterView[] {
  return graph.relationships.flatMap((edge) => {
    const queue = deadLetterOf(edge);

    const about =
      edge.type === 'consumes' &&
      edge.from.kind === event.kind &&
      edge.from.namespace === event.namespace &&
      edge.from.id === event.id;

    return about && queue ? [{ consumer: edge.to.id, ...queue }] : [];
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

  const { documents, records: kindRecords } = documentsByKind(
    catalog.kinds,
    documentsAbout(catalog.graph, {
      kind: 'event',
      namespace: `${repository}/${fm.domain}`,
      id: fm.id,
    }),
  );

  const records = [
    ...kindRecords,
    ...flowRecords(
      catalog.flows,
      { kind: 'event', namespace: `${repository}/${fm.domain}`, id: fm.id },
      base,
    ),
  ];

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
    ? (await (await createMarkdownProcessor({ remarkPlugins: [remarkMermaid] })).render(event.body))
        .code
    : null;

  const owner = fm.owner && ownerFor(graphOwners(catalog.graph), fm.owner.team);

  const services = (names: string[]): ShellLink[] =>
    names.map((name) => ({ label: name, href: `${base}services/${name}/`, kind: 'service' }));

  const seen = runtimeByEvent(catalog.events, catalog.snapshots).get(
    `${repository}/${fm.domain}/${fm.id}`,
  );

  // A producer only the snapshot names is drawn too, marked as undocumented.
  const unlisted = (seen?.observed?.producers ?? []).filter((name) => !fm.producers.includes(name));

  const flow = {
    from: [
      ...services(fm.producers),
      // No page of its own: nothing in the catalog names it.
      ...unlisted.map((name): ShellLink => ({ label: name, kind: 'service' })),
      ...agents.producers,
    ],
    inbound: 'publishes',
    centre: { label: fm.name, detail: versionLabel(fm.version), kind: 'event' as const },
    outbound: 'subscribed by',
    to: [...services(fm.consumers), ...agents.consumers],
  };

  // The facts that identify the event, beyond the title and crumbs above.
  const facts: EventPageProps['facts'] = [
    ['Id', fm.id],
    ['Domain', fm.domain, domainHref(base, fm.domain)],
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
    draft: fm.status === 'draft',
    narrativeHtml,
    flow,
    visualiser: flowGraph(flow, seen && { event: fm.id, seen, live: docsSiteConfig().live }),
    schema: schemaTree(event.schema),
    schemaHref: `${base}${eventPath(entry)}schema.json`,
    evidence: runtimeEvidenceView(
      eventRuntimeEvidence(fm),
      `${fm.domain}/${fm.id}`,
      deadLetters(catalog.graph, {
        kind: 'event',
        namespace: `${repository}/${fm.domain}`,
        id: fm.id,
      }),
    ),
    examples: exampleViews(event.examples),
    versions: versionLinks(versions, entry, base),
    changesHtml: await versionChangesHtml(versions, entry),
    documents,
    records,
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
