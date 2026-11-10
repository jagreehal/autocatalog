import { isServiceCatalogResource, type ResourceGraph } from 'autocatalog-core';
import type { CatalogEvent } from './catalog';
import { ownerKey } from './owners';

/** A domain as the catalog names it: one per name, across every repository. */
export interface Domain {
  name: string;
  /** Its events in name order. */
  events: CatalogEvent[];
  /**
   * Every service that produces or consumes one of its events, or that the
   * resource graph places in it, in name order.
   */
  services: string[];
  /** Owner teams its events and services declare, in name order. */
  owners: string[];
}

/**
 * Every domain the catalog names, in name order: an event's domain, a domain a
 * service in the resource graph says it is in, and a domain resource. A team
 * whose services publish no events still has its domain's page, sidebar entry
 * and overview, as `about:` and `overviews/` already accept it.
 */
export function buildDomains(events: CatalogEvent[], graph?: ResourceGraph): Domain[] {
  const byName = new Map<
    string,
    { events: CatalogEvent[]; services: string[]; owners: string[] }
  >();

  const entry = (name: string) => {
    const found = byName.get(name) ?? { events: [], services: [], owners: [] };

    byName.set(name, found);

    return found;
  };

  for (const event of events) {
    const { domain, producers, consumers, owner } = event.event.frontmatter;
    const domainEntry = entry(domain);

    domainEntry.events.push(event);
    domainEntry.services.push(...producers, ...consumers);

    if (owner) domainEntry.owners.push(owner.team);
  }

  for (const resource of graph?.resources ?? []) {
    if (resource.ref.kind === 'domain') entry(resource.ref.id);

    if (!isServiceCatalogResource(resource)) continue;

    for (const name of resource.attributes.domains) {
      const domainEntry = entry(name);

      domainEntry.services.push(resource.ref.id);

      if (resource.owner?.team) domainEntry.owners.push(resource.owner.team);
    }
  }

  return [...byName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, found]) => ({
      name,
      events: found.events.sort((a, b) =>
        a.event.frontmatter.name.localeCompare(b.event.frontmatter.name),
      ),
      services: [...new Set(found.services)].sort(),
      // One entry per team however each wrote it, kept as first written.
      owners: [
        ...new Map(found.owners.map((team) => [ownerKey(team), team] as const)).values(),
      ].sort(),
    }));
}

/** Root-relative link to a domain's page, under the site's base. */
export function domainHref(base: string, name: string): string {
  return `${base}domains/${name}/`;
}
