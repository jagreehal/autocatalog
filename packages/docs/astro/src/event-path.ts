import { indexFields } from 'autocatalog-core';
import type { CatalogEvent } from './catalog';

/**
 * Where an event lives on the site, relative to its base. Namespaced by the
 * repository and domain that published it: an event id is unique inside one
 * catalog, not across a company, so two repositories can both publish
 * `payment.completed` and each keeps its own page.
 */
export function eventPath({ repository, event }: CatalogEvent): string {
  return `events/${repository}/${event.frontmatter.domain}/${event.frontmatter.id}/`;
}

/** Every published event with this id in this domain, from any repository. */
export function eventsNamed(events: CatalogEvent[], domain: string, id: string): CatalogEvent[] {
  return events.filter(
    ({ event }) => event.frontmatter.domain === domain && event.frontmatter.id === id,
  );
}

/**
 * The published events whose contract names this service as a producer or
 * consumer, one entry each. Built from the events rather than the merged
 * service summary, so the same id from two repositories stays two lines, each
 * with its own name.
 */
export function eventsForService(
  events: CatalogEvent[],
  service: string,
  role: 'producers' | 'consumers',
): CatalogEvent[] {
  return events.filter(({ event }) => event.frontmatter[role].includes(service));
}

/**
 * For each field path, the published event behind each occurrence, in the
 * order indexFields lists them. indexFields keeps event order within a field,
 * so indexing each event alone lines up with the combined index.
 */
export function fieldCarriers(events: CatalogEvent[]): Map<string, CatalogEvent[]> {
  const carriers = new Map<string, CatalogEvent[]>();

  for (const entry of events) {
    for (const field of indexFields([entry.event])) {
      const list = carriers.get(field.path) ?? [];

      for (const _ of field.occurrences) list.push(entry);
      carriers.set(field.path, list);
    }
  }

  return carriers;
}
