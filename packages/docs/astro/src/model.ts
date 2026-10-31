import { resourceKey, type ResourceRef } from 'autocatalog-core';
import {
  dataProductDiagram,
  entityDiagram,
  entityReferences,
  portName,
  type DataProduct,
  type DataProductPort,
  type DomainModel,
  type Entity,
  type Person,
} from 'autocatalog-docs-core';
import type { DocsCatalog } from './catalog';
import { githubDirectoryEnrichment } from './directory';
import { domainHref } from './domains';
import { renderNarrative } from './flows';
import { ownerKey, type Owner } from './owners';
import type {
  DataProductPageProps,
  DataProductsPageProps,
  EntitiesPageProps,
  EntityPageProps,
  GlossaryPageProps,
  OwnerProfile,
} from './ui/pages';
import { pageOf, type CatalogGraphOptions } from './visualiser';

type Pages = Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>;

export const entityPath = (entity: Pick<Entity, 'repository' | 'id'>) =>
  `entities/${entity.repository}/${entity.id}/`;

export const dataProductPath = (product: Pick<DataProduct, 'repository' | 'id'>) =>
  `data-products/${product.repository}/${product.id}/`;

/** A term's anchor on the glossary page, so a document can link straight to it. */
export const termAnchor = (domain: string, term: string) => `${domain}-${term}`;

/** The domains with a page of their own: those events name. */
const domainPages = (catalog: Pick<DocsCatalog, 'events'>) =>
  new Set(catalog.events.map(({ event }) => event.frontmatter.domain));

export function glossaryPageProps(
  catalog: Pick<DocsCatalog, 'events' | 'graph' | 'model'>,
  base: string,
  pages: Pages,
): GlossaryPageProps {
  const domains = domainPages(catalog);

  return {
    domains: catalog.model.glossaries.map((glossary) => ({
      domain: glossary.domain,
      href: domains.has(glossary.domain) ? domainHref(base, glossary.domain) : undefined,
      repository: glossary.repository,
      file: glossary.file,
      terms: glossary.terms.map((term) => ({
        anchor: termAnchor(glossary.domain, term.id),
        name: term.name,
        summary: term.summary,
        description: term.description,
        aliases: term.aliases ?? [],
        about: term.refs.map((ref) => resourceLink(ref, catalog, base, pages)),
      })),
    })),
  };
}

function resourceLink(
  ref: ResourceRef,
  catalog: Pick<DocsCatalog, 'graph'>,
  base: string,
  pages: Pages,
) {
  const resource = catalog.graph.resources.find(
    (candidate) => resourceKey(candidate.ref) === resourceKey(ref),
  );

  return { name: resource?.title ?? ref.id, href: resource && pageOf(resource, base, pages) };
}

export function entitiesPageProps(model: DomainModel, base: string): EntitiesPageProps {
  return {
    diagram: entityDiagram(model.entities),
    entities: model.entities.map((entity) => ({
      name: entity.name,
      summary: entity.summary,
      repository: entity.repository,
      domains: entity.domains,
      aggregateRoot: entity.aggregateRoot,
      properties: entity.properties.length,
      href: `${base}${entityPath(entity)}`,
    })),
  };
}

export async function entityPageProps(
  entity: Entity,
  catalog: Pick<DocsCatalog, 'events' | 'graph' | 'model'>,
  base: string,
  pages: Pages,
): Promise<EntityPageProps> {
  const domains = domainPages(catalog);

  const related = catalog.model.entities.filter(
    (other) =>
      other === entity ||
      entityReferences(other).includes(entity.id) ||
      entityReferences(entity).includes(other.id),
  );

  const entities = new Map(
    catalog.model.entities.map((other) => [other.id, `${base}${entityPath(other)}`]),
  );

  return {
    repository: entity.repository,
    file: entity.file,
    aggregateRoot: entity.aggregateRoot,
    identifier: entity.identifier,
    domains: entity.domains.map((name) => ({
      name,
      href: domains.has(name) ? domainHref(base, name) : undefined,
    })),
    services: entity.services.map((service) =>
      service.ref
        ? resourceLink(service.ref, catalog, base, pages)
        : { name: service.name, href: undefined },
    ),
    properties: entity.properties.map(
      function row(property): EntityPageProps['properties'][number] {
        return {
          name: property.name,
          type: property.type,
          required: property.required === true,
          description: property.description,
          enum: property.enum,
          references: property.references
            ? {
                name: property.references,
                href: entities.get(property.references),
              }
            : undefined,
          properties: (property.properties ?? []).map(row),
        };
      },
    ),
    carriedBy: entity.carriedBy.map((ref) => resourceLink(ref, catalog, base, pages)),
    diagram: related.length > 1 ? entityDiagram(related) : null,
    narrativeHtml: entity.body ? await renderNarrative(entity.body) : null,
  };
}

export function dataProductsPageProps(model: DomainModel, base: string): DataProductsPageProps {
  return {
    products: model.dataProducts.map((product) => ({
      name: product.name,
      summary: product.summary,
      repository: product.repository,
      domain: product.domain,
      inputs: product.inputs.length,
      outputs: product.outputs.length,
      href: `${base}${dataProductPath(product)}`,
    })),
  };
}

export async function dataProductPageProps(
  product: DataProduct,
  catalog: Pick<DocsCatalog, 'events' | 'graph' | 'model'>,
  base: string,
  pages: Pages,
): Promise<DataProductPageProps> {
  const products = new Map(
    catalog.model.dataProducts.map((other) => [
      `data-product/${other.id}`,
      { name: other.name, href: `${base}${dataProductPath(other)}` },
    ]),
  );

  const port = ({ reference, ref, contract }: DataProductPort) => {
    const link = ref
      ? resourceLink(ref, catalog, base, pages)
      : (products.get(reference) ?? {
          name: portName({ reference }, catalog.graph),
          href: undefined,
        });

    return { ...link, reference, contract };
  };

  const { nodes, edges } = dataProductDiagram(product, catalog.graph);

  const hrefs: Record<string, string> = {};

  for (const node of nodes) {
    const found = catalog.graph.resources.find((resource) => resourceKey(resource.ref) === node.id);
    const href = found ? pageOf(found, base, pages) : products.get(node.id)?.href;

    if (href && node.id !== `data-product/${product.id}`) hrefs[node.id] = href;
  }

  return {
    repository: product.repository,
    file: product.file,
    domain: product.domain
      ? {
          name: product.domain,
          href: domainPages(catalog).has(product.domain)
            ? domainHref(base, product.domain)
            : undefined,
        }
      : undefined,
    visualiser: { graph: { nodes, edges, options: { legend: true } }, hrefs },
    inputs: product.inputs.map(port),
    outputs: product.outputs.map(port),
    narrativeHtml: product.body ? await renderNarrative(product.body) : null,
  };
}

/**
 * The directory's word on one owner: the team or person whose id or name is
 * the owner as CODEOWNERS or frontmatter writes it, `@acme/payments` matching
 * `teams/payments.md`.
 */
export function ownerProfile(owner: Owner, people: Person[]): OwnerProfile | undefined {
  const person = people.find((candidate) =>
    [ownerKey(candidate.id), ownerKey(candidate.name)].some(
      (key) => owner.key === key || owner.key.endsWith(`/${key}`),
    ),
  );

  const users = new Map(
    people.flatMap((candidate) =>
      candidate.kind === 'user' ? [[candidate.id, candidate] as const] : [],
    ),
  );

  const handle = owner.name ?? owner.key;
  const enrichment = githubDirectoryEnrichment(handle);

  if (!person) {
    // A bare login without a directory file is not a profile; only org/team
    // handles are rich enough to invent one from GitHub's public URLs.
    if (!handle.includes('/') || !enrichment) return undefined;

    return {
      kind: 'team',
      avatarUrl: enrichment.avatarUrl,
      members: [],
      memberOf: [],
    };
  }

  return {
    kind: person.kind,
    summary: person.summary,
    role: person.role,
    avatarUrl: person.avatarUrl ?? enrichment?.avatarUrl,
    email: person.email,
    slack: person.slackDirectMessageUrl,
    teams: person.msTeamsDirectMessageUrl,
    members: person.members.map((id) => ({
      name: users.get(id)?.name ?? id,
      role: users.get(id)?.role,
    })),
    memberOf: people.flatMap((team) =>
      team.kind === 'team' && team.members.includes(person.id) ? [team.name] : [],
    ),
  };
}
