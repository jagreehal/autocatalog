import fs from 'node:fs';
import path from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { schemaTree } from './ui/lib/schema-tree';
import {
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
  type DeliveryReport,
  type EventFrontmatter,
  type LoadedExample,
  type ResourceGraph,
  type ResourceRef,
  type BehindReference,
} from 'autocatalog-core';
import { attentionSnapshot } from './attention';
import { buildChannels } from './channels';
import { fieldsByPath, withFieldLineage } from './field-lineage';
import { statusBanners } from './resource-status';
import { buildSystems, catalogSystemRows } from './systems';
import { z } from 'zod';
import { type RepositoryMeta, sourceUrl } from 'autocatalog-docs-core';
import { documentsAbout } from './about';
import { apiPath, apisForService, apiTitle, catalogServices } from './apis';
import { specificationPath, specificationsForService } from './specifications';
import { flowPath, flowRecords } from './flows';
import { failureSource, type CatalogEvent, type DocsCatalog } from './catalog';
import { docsSiteConfig } from './config';
import { eventCatalogEmbeds } from './eventcatalog';
import { architectureHref } from './eventcatalog-path';
import { eventPath, eventsForService, fieldCarriers } from './event-path';
import { eventVersions, versionLinks, versionPath } from './event-versions';
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
import { buildComponents, type ComponentRow } from './components';
import { buildMcpServers } from './mcp-servers';
import type { EventCatalogDiagramProps } from './ui/components/EventCatalogDiagram';
import type { DeliveryView } from './ui/components/DeliveryFacts';
import type { DeliveryPathProps } from './ui/components/DeliveryPath';
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
  ServicesPageProps,
} from './ui/pages';
import { catalogAnchor, docHref, groupByRepo, groupByTag, type DocListItem } from './view';
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

// What a catalog is asked about first; the rest follow by how many it holds.
const LEADING_COUNTS = ['service', 'event', 'domain', 'document'];

const HOME_COUNTS = 6;

/**
 * The counts the home page leads with: the site's own choice, in its order, or
 * six, services, events, domains and documents first, then the kinds the
 * catalog holds most of, relationships last. Every kind stays a click away in
 * the catalog.
 */
export function homeCounts<Stat extends { label: string; value: number; kind?: string }>(
  all: Stat[],
  chosen?: readonly string[],
): Stat[] {
  const present = all.filter(({ value }) => value > 0);

  const key = (stat: Stat) => stat.kind ?? stat.label;

  if (chosen) {
    return chosen.flatMap((name) =>
      present.filter((stat) => key(stat) === name || stat.label === name),
    );
  }

  const rank = (stat: Stat) => {
    const leading = LEADING_COUNTS.indexOf(key(stat));

    if (leading >= 0) return leading;

    return key(stat) === 'relationship' ? Number.MAX_SAFE_INTEGER : LEADING_COUNTS.length;
  };

  return [...present].sort((a, b) => rank(a) - rank(b) || b.value - a.value).slice(0, HOME_COUNTS);
}

export function homePageProps(
  catalog: DocsCatalog,
  items: DocListItem[],
  base: string,
  metas: ReadonlyMap<string, RepositoryMeta> = new Map(),
  {
    counts,
    outside = false,
  }: {
    /** The kinds the home page counts, in order: `homeCounts`. */
    counts?: readonly string[] | undefined;
    /** A site for readers outside the company, which draws no map of its systems. */
    outside?: boolean;
  } = {},
): HomePageProps {
  const domains = buildDomains(catalog.events, catalog.graph).length;

  const all = [
    ...Object.entries(catalog.summary.resourcesByKind).map(([kind, count]) => ({
      // A card names the kind, as a heading would: always plural.
      label: label(kind, 2),
      value: count,
      kind,
      // Services have a page listing them all; every other kind is the graph, filtered.
      href:
        kind === 'service'
          ? `${base}services/`
          : `${base}catalog/?kind=${encodeURIComponent(kind)}`,
    })),
    // Decisions, runbooks and incidents are documents too, counted again here
    // because "how many incidents" is a question the index is asked.
    ...[...kindCounts(catalog)].map(([kind, count]) => ({
      label: kindNoun(kind, 2),
      value: count,
      kind: kind.id,
      href: kindHref(base, kind),
    })),
    {
      label: label('domain', 2),
      value: domains,
      kind: 'domain',
      href: `${base}domains/`,
    },
    {
      label: label('relationship', 2),
      value: catalog.summary.relationships,
      kind: 'relationship',
    },
  ];

  const stats = homeCounts(all, counts);

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
    ...(catalog.graph.resources.some(({ ref }) => ref.kind === 'component')
      ? [
          {
            title: 'Components',
            text: 'Every UI component teams publish, who owns it, and where to see it.',
            href: `${base}components/`,
            icon: 'component' as const,
          },
        ]
      : []),
    ...(catalog.graph.resources.some(({ ref }) => ref.kind === 'mcp-server')
      ? [
          {
            title: 'MCP servers',
            text: 'Every server the company builds or uses, who depends on it, and what changed.',
            href: `${base}mcp-servers/`,
            icon: 'mcp-server' as const,
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
    ...(catalogServices(catalog).size > 0
      ? [
          {
            title: 'Services',
            text: 'Every service with its owner, the APIs it serves, and what it sends and receives.',
            href: `${base}services/`,
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
    ...(buildChannels(catalog.graph, catalog.designs, base).length > 0
      ? [
          {
            title: 'Channels',
            text: 'Topics and queues observed at runtime, and channels drawn in designs.',
            href: `${base}channels/`,
            icon: 'channel' as const,
            kind: 'channel',
          },
        ]
      : []),
    ...(buildSystems(catalog.designs, base).length > 0
      ? [
          {
            title: 'Systems',
            text: 'Systems and external systems named in designs.',
            href: `${base}systems/`,
            icon: 'architecture' as const,
            kind: 'system',
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

  const attention = attentionSnapshot(catalog, base);

  const map = outside
    ? undefined
    : catalogGraph(catalog.graph, base, {
        servicePages: servicePages(catalog),
        eventPages: eventPages(catalog),
        ...mapEvidence(catalog),
      });

  return {
    stats,
    explore,
    repos: groupByRepo(items)
      .map(([name, docs]) => {
        const meta = metas.get(name);
        const index = docs.find(({ id }) => id === `${name}/index`);

        return {
          name,
          label: meta?.label ?? name,
          description: meta?.description,
          // A repository with no index page still has a first page to open.
          href: docHref((index ?? docs[0]!).id),
          docs,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    tags: groupByTag(items),
    attention,
    ...(map && { map, catalogHref: `${base}catalog/` }),
  };
}

export function channelsPageProps(catalog: DocsCatalog, base: string) {
  return { channels: buildChannels(catalog.graph, catalog.designs, base) };
}

export function channelPageProps(catalog: DocsCatalog, id: string, base: string) {
  const channel = buildChannels(catalog.graph, catalog.designs, base).find(
    (entry) => entry.id === id,
  );

  return channel ? { channel } : null;
}

/** Every component in the catalog, with its owner's page when it has one. */
export function componentRows(catalog: DocsCatalog, base: string): ComponentRow[] {
  return buildComponents(catalog.graph, base, graphOwners(catalog.graph));
}

export function mcpServersPageProps(catalog: DocsCatalog, base: string) {
  return { servers: buildMcpServers(catalog.graph, base) };
}

export function mcpServerPageProps(catalog: DocsCatalog, id: string, base: string) {
  const server = buildMcpServers(catalog.graph, base).find((entry) => entry.id === id);

  return server ? { server } : null;
}

/** Every system a design names or a service in the graph declares. */
export function catalogSystems(catalog: DocsCatalog, base: string) {
  return catalogSystemRows(catalog, base);
}

export function systemsPageProps(catalog: DocsCatalog, base: string) {
  return { systems: catalogSystems(catalog, base) };
}

export function systemPageProps(catalog: DocsCatalog, id: string, base: string) {
  const system = catalogSystems(catalog, base).find((entry) => entry.id === id);

  return system ? { system } : null;
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
    domains: buildDomains(catalog.events, catalog.graph).map((domain) => ({
      name: domain.name,
      href: domainHref(base, domain.name),
      events: domain.events.length,
      services: domain.services.length,
      owners: domain.owners.length,
    })),
  };
}

/** A domain page's props, every section filled, and its overview's Markdown for the page to render. */
export type DomainPageModel = DomainPageProps &
  Required<
    Pick<
      DomainPageProps,
      'title' | 'subdomains' | 'systems' | 'contracts' | 'entities' | 'flows' | 'documents'
    >
  > & { overview?: string | undefined };

export function domainPageProps(
  catalog: DocsCatalog,
  domain: Domain,
  base: string,
): DomainPageModel {
  const owners = graphOwners(catalog.graph);

  const role = (name: string, side: 'producers' | 'consumers') =>
    domain.events.filter(({ event }) => event.frontmatter[side].includes(name)).length;

  const overview = catalog.overviews.find(
    ({ kind, target }) => kind === 'domain' && target === domain.name,
  );

  const inDomain = new Set(domain.services);

  const apis = [
    ...new Map(
      domain.services.flatMap((name) =>
        apisForService(catalog.apis, catalog.events, name).map(
          (api) => [apiPath(api), api] as const,
        ),
      ),
    ).values(),
  ];

  // A flow is the domain's when a step names one of its events or services.
  const flows = catalog.flows.filter((flow) =>
    flow.steps.some(
      ({ ref }) =>
        (ref?.kind === 'event' && ref.namespace?.split('/').at(-1) === domain.name) ||
        (ref?.kind === 'service' && inDomain.has(ref.id)),
    ),
  );

  return {
    title: overview?.name ?? domain.name,
    summary:
      overview?.summary ??
      catalog.graph.resources.find(
        (resource) => resource.ref.kind === 'domain' && resource.ref.id === domain.name,
      )?.summary,
    overview: overview?.body || undefined,
    subdomains: catalog.overviews
      .filter(({ kind, parent }) => kind === 'domain' && parent === domain.name)
      .map((sub) => ({
        name: sub.name ?? sub.target,
        href: domainHref(base, sub.target),
        summary: sub.summary,
      })),
    systems: catalogSystems(catalog, base)
      .filter((system) => system.members.some((member) => inDomain.has(member)))
      .map(({ name, href, summary, members }) => ({
        name,
        href,
        summary,
        members: members.length,
      })),
    contracts: apis.map((api) => ({ name: apiTitle(api), href: `${base}${apiPath(api)}` })),
    entities: catalog.model.entities
      .filter((entity) => entity.domains.includes(domain.name))
      .map((entity) => ({
        name: entity.name,
        href: `${base}entities/${entity.repository}/${entity.id}/`,
        summary: entity.summary,
      })),
    flows: flows.map((flow) => ({
      name: flow.title,
      href: `${base}${flowPath(flow)}`,
      summary: flow.summary,
    })),
    documents: documentsAbout(catalog.graph, { kind: 'domain', id: domain.name }).map(
      ({ href, title, kind }) => ({ name: title, href, kind }),
    ),
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
export const servicePages = (catalog: Pick<DocsCatalog, 'events' | 'apis'>) =>
  new Set(catalogServices(catalog).keys());

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

/**
 * Every service, one row each, from its events and the OpenAPI specs it serves:
 * its owner, what it serves, what it receives, and what it sends or calls.
 */
export function servicesPageProps(catalog: DocsCatalog, base: string): ServicesPageProps {
  const services = catalogServices(catalog);
  const { graph, events } = catalog;

  const endpoints = (name: string) =>
    graph.relationships.filter(
      ({ type, to }) => type === 'exposedBy' && to.kind === 'service' && to.id === name,
    ).length;

  // Calls between services, each way: a call to an endpoint names its service too.
  const serviceCalls = graph.relationships.flatMap(({ type, from, to }) =>
    type === 'calls' && from.kind === 'service' && to.kind === 'service'
      ? [{ caller: from.id, called: to.id }]
      : [],
  );

  const calls = (name: string) => [
    ...new Set(serviceCalls.flatMap(({ caller, called }) => (caller === name ? [called] : []))),
  ];

  const callers = (name: string) => [
    ...new Set(serviceCalls.flatMap(({ caller, called }) => (called === name ? [caller] : []))),
  ];

  const serviceLinks = (names: string[]) =>
    names.flatMap((name) =>
      services.has(name) ? [{ label: name, href: `${base}services/${name}/` }] : [],
    );

  const eventLinks = (list: CatalogEvent[]) =>
    list.map((entry) => ({
      label: entry.event.frontmatter.name,
      href: `${base}${eventPath(entry)}`,
    }));

  return {
    services: [...services.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((service) => {
        const facts = serviceFacts(graph, service.name);

        return {
          name: service.name,
          href: `${base}services/${service.name}/`,
          summary: facts.summary,
          owner: facts.owner,
          domains: service.domains,
          apis: apisForService(catalog.apis, events, service.name).map((api) => ({
            label: apiTitle(api),
            href: `${base}${apiPath(api)}`,
          })),
          endpoints: endpoints(service.name),
          receives: eventLinks(eventsForService(events, service.name, 'consumers')),
          sends: eventLinks(eventsForService(events, service.name, 'producers')),
          calls: serviceLinks(calls(service.name)),
          calledBy: serviceLinks(callers(service.name)),
        };
      }),
  };
}

/** How the catalog came to know a service: from events, from OpenAPI specs, or both. */
export interface ServiceBasis {
  /** After "Inferred", on the page's evidence rule. */
  evidence: string;
  /** What the page is, for its description and its Markdown twin. */
  description: string;
}

export function serviceBasis(
  catalog: Pick<DocsCatalog, 'events' | 'apis'>,
  name: string,
): ServiceBasis {
  const events =
    eventsForService(catalog.events, name, 'producers').length +
      eventsForService(catalog.events, name, 'consumers').length >
    0;

  const specs = apisForService(catalog.apis, catalog.events, name).length > 0;

  if (events && specs) {
    return {
      evidence: 'from the events that name it and the OpenAPI specs it serves',
      description:
        'Inferred from the events it produces and consumes and the OpenAPI specs it serves. Nobody writes this page; change a contract and it changes.',
    };
  }

  if (specs) {
    return {
      evidence: 'from the OpenAPI specs it serves',
      description:
        'Inferred from the OpenAPI specs it serves. Nobody writes this page; change a spec and it changes.',
    };
  }

  if (events) {
    return {
      evidence: 'from the events that name it as a producer or consumer',
      description:
        "Inferred from the producers and consumers that each event declares. Nobody writes this page; change an event's contract and it changes.",
    };
  }

  return {
    evidence: 'from the resource graph its repository commits',
    description:
      'Declared in the resource graph its repository commits: the commands it handles and the data it reads and writes.',
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
    basis: serviceBasis(catalog, service.name).evidence,
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

  const fieldIndex = indexFields(catalog.events.map(({ event: other }) => other));

  const schema = withFieldLineage(
    schemaTree(event.schema),
    fieldsByPath(fieldIndex),
    (field) => describeFieldConflict(field) ?? undefined,
  );

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
    banners: statusBanners({
      status: fm.status,
      deprecation,
      needsReview: fm.needsReview,
    }),
    narrativeHtml,
    flow,
    visualiser: flowGraph(flow, seen && { event: fm.id, seen, live: docsSiteConfig().live }),
    schema,
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
    versions: await versionLinks(versions, entry, base, catalog.behind),
    documents,
    records,
    facts,
    transport: fm.transport,
    delivery: deliveryView(fm.delivery, correlationPath(event)),
    deliveryPath: deliveryPathView(
      catalog.delivery,
      `${fm.domain}/${fm.id}`,
      base,
      servicePages(catalog),
    ),
    source,
    edit,
    diagram: diagramProps(base, eventCatalogEmbeds()?.events[fm.id], `${fm.name} in EventCatalog`),
  };
}

const where = (source: { file?: string; line?: number } | undefined) =>
  source?.file ? `${source.file}${source.line ? `:${source.line}` : ''}` : undefined;

/** One event's routes and findings from the company's delivery report, as the page draws them. */
export function deliveryPathView(
  report: DeliveryReport | undefined,
  event: string,
  base: string,
  /** Services with a page; one declared only in another repository has none. */
  pages: ReadonlySet<string>,
): DeliveryPathProps | undefined {
  const routes = report?.routes.filter((route) => route.event === event) ?? [];
  const findings = report?.findings.filter((finding) => finding.event === event) ?? [];

  if (!report || (routes.length === 0 && findings.length === 0)) return undefined;

  const service = (name: string) => ({
    name,
    entity: 'service' as const,
    ...(pages.has(name) && { href: `${base}services/${name}/` }),
  });

  return {
    complete: !findings.some((finding) => finding.confidence === 'unknown'),
    findings: findings.map((finding) => ({
      confidence: finding.confidence,
      message: finding.message,
      source: where(finding.source),
    })),
    routes: routes.map((route) => {
      const path = route.examples.find((example) => example.reaches)?.path ?? [];

      return {
        consumer: route.consumer,
        environment: report.environment,
        hops: [
          ...route.producers.map(service),
          ...(path.length
            ? path.map((hop) => ({
                name: hop.ref.id,
                entity: hop.entity ?? 'queue',
                rule: hop.rule,
                source: where(hop.source),
              }))
            : [{ name: route.exchange, entity: 'destination' }]),
          ...(path.length ? [service(route.consumer)] : []),
        ],
        examples: route.examples.map((example) => ({
          name: example.name,
          headers: Object.entries(example.headers)
            .map(([key, value]) => `${key} = ${String(value)}`)
            .join(', '),
          outcome:
            example.reaches === undefined
              ? ('not evaluated' as const)
              : example.reaches
                ? ('reaches' as const)
                : ('excluded' as const),
        })),
        facts: route.facts,
        deadLetter: route.deadLetter && {
          exchange: route.deadLetter.exchange,
          queues: route.deadLetter.queues,
        },
      };
    }),
  };
}

export async function eventVersionPageProps(
  entry: CatalogEvent,
  versions: CatalogEvent[],
  base: string,
  behind: BehindReference[],
): Promise<EventVersionPageProps> {
  const { event } = entry;

  const current = versions.find(({ event: other }) => !other.folder.isVersioned);
  const links = await versionLinks(versions, entry, base, behind);
  const active = links.find((version) => version.active);

  return {
    version: event.frontmatter.version,
    current: current && {
      href: `${base}${versionPath(current)}`,
      version: current.event.frontmatter.version,
    },
    changesHtml: active?.changesHtml ?? null,
    banners: current
      ? statusBanners({
          newer: {
            version: current.event.frontmatter.version,
            href: `${base}${versionPath(current)}`,
          },
        })
      : [],
    schema: schemaTree(event.schema),
    schemaHref: `${base}${versionPath(entry)}schema.json`,
    examples: exampleViews(event.examples),
    versions: links,
  };
}
