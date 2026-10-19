import type { CatalogEvent, DocsCatalog } from './catalog';
import { eventPath } from './event-path';
import { graphOwners, ownerFor, ownerHref } from './owners';
import type { SchemasPageProps } from './ui/pages';

/**
 * What the contract was written in, by the file it was read from. Every schema
 * is published as JSON Schema; this is what its owners edit.
 */
export function schemaFormat({ repository, event }: CatalogEvent, catalog: DocsCatalog): string {
  const file = event.frontmatter.source?.file ?? '';

  if (/\.avsc$/i.test(file)) return 'Avro';

  if (/\.proto$/i.test(file)) return 'Protobuf';

  if (catalog.apis.some((api) => api.repository === repository && api.file === file)) {
    return 'OpenAPI';
  }

  return 'JSON Schema';
}

export function schemasPageProps(catalog: DocsCatalog, base: string): SchemasPageProps {
  const owners = graphOwners(catalog.graph);

  return {
    schemas: catalog.events.map((entry) => {
      const { name, id, version, domain, owner } = entry.event.frontmatter;
      const team = owner && ownerFor(owners, owner.team);
      const format = schemaFormat(entry, catalog);

      return {
        name,
        id,
        version,
        domain,
        repository: entry.repository,
        format,
        owner: owner && { team: team?.name ?? owner.team, href: team && ownerHref(team) },
        href: `${base}${eventPath(entry)}`,
        schemaHref: `${base}${eventPath(entry)}schema.json`,
        search: [name, id, domain, entry.repository, format, owner?.team].join(' ').toLowerCase(),
      };
    }),
  };
}
