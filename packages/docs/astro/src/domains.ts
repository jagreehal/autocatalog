import type { CatalogEvent } from './catalog';
import { ownerKey } from './owners';

/** A domain as its events name it: one per name, across every repository. */
export interface Domain {
  name: string;
  /** Its events in name order. */
  events: CatalogEvent[];
  /** Every service that produces or consumes one of its events, in name order. */
  services: string[];
  /** Owner teams its events declare, in name order. */
  owners: string[];
}

/** Every domain an event names, in name order. */
export function buildDomains(events: CatalogEvent[]): Domain[] {
  const byName = new Map<string, CatalogEvent[]>();

  for (const entry of events) {
    const { domain } = entry.event.frontmatter;
    byName.set(domain, [...(byName.get(domain) ?? []), entry]);
  }

  const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

  return [...byName]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => {
      const fms = list.map(({ event }) => event.frontmatter);

      return {
        name,
        events: list.sort((a, b) =>
          a.event.frontmatter.name.localeCompare(b.event.frontmatter.name),
        ),
        services: sorted(fms.flatMap((fm) => [...fm.producers, ...fm.consumers])),
        // One entry per team however each event wrote it, kept as first written.
        owners: [
          ...new Map(
            fms.flatMap((fm) =>
              fm.owner ? [[ownerKey(fm.owner.team), fm.owner.team] as const] : [],
            ),
          ).values(),
        ].sort(),
      };
    });
}

/** Root-relative link to a domain's page, under the site's base. */
export function domainHref(base: string, name: string): string {
  return `${base}domains/${name}/`;
}
