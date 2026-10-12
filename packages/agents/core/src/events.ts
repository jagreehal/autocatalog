import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { closestMatch, loadCatalog as loadEventCatalog, type LoadedEvent } from 'autocatalog-core';
import { entitiesOf, loadCatalog, type Catalog } from './loader.js';
import { DIR_BY_KIND } from './schemas.js';

export type EventDirection = 'produces' | 'consumes';

/** An event as the event catalog identifies it. */
export type EventKey = { domain: string; id: string };

/** Only Agents and Tools name events. */
export type EventParticipant = { kind: 'agent' | 'tool'; id: string };

export type EventLink = {
  from: EventParticipant;
  direction: EventDirection;
  /** The reference exactly as the catalog wrote it. */
  ref: string;
  /** `domain/id`, once resolved against an event catalog. */
  event?: string;
  /** Payload paths a consumer declares it reads; absent when it did not say. */
  fields?: string[];
};

export type EventLinkIssue = {
  from: EventParticipant;
  direction: EventDirection;
  ref: string;
  message: string;
};

export type EventLinks = { links: EventLink[]; issues: EventLinkIssue[] };

/** Who publishes and who reacts to one event, as `agent/<id>` and `tool/<id>` labels. */
export type EventParticipants = {
  producers: string[];
  consumers: string[];
  /** Payload paths each consumer declares it reads, by label. */
  consumerFields?: Record<string, string[]>;
};

const LABEL = { agent: 'Agent', tool: 'Tool' } as const;

/** Every event reference an Agent or Tool declares, unresolved. */
export const declaredEventLinks = (cat: Catalog): EventLink[] => {
  const links: EventLink[] = [];

  for (const entity of [...entitiesOf(cat, 'agent'), ...entitiesOf(cat, 'tool')]) {
    const declared = {
      produces: (entity.produces ?? []).map((event) => ({ event, fields: undefined })),
      consumes: entity.consumes ?? [],
    };

    for (const direction of ['produces', 'consumes'] as const) {
      const fieldsByRef = new Map<string, string[] | undefined>(
        declared[direction].map(({ event, fields }) => [event, fields]),
      );

      for (const [ref, fields] of [...fieldsByRef].sort(([a], [b]) => a.localeCompare(b))) {
        links.push({
          from: { kind: entity.kind, id: entity.id },
          direction,
          ref,
          ...(fields && { fields }),
        });
      }
    }
  }

  return links;
};

export type EventResolution =
  | { event: string }
  | { reason: 'unknown'; hint?: string }
  | { reason: 'ambiguous'; matches: string[] };

/**
 * Resolve one reference, `domain/id` or a bare id, against an event catalog. A
 * bare id resolves only when exactly one domain has it, so adding a second
 * `payment.completed` elsewhere turns a silent guess into an error naming both.
 */
export const resolveEventRef = (ref: string, events: EventKey[]): EventResolution => {
  const keys = [...new Set(events.map((e) => `${e.domain}/${e.id}`))].sort();

  if (ref.includes('/')) {
    return keys.includes(ref)
      ? { event: ref }
      : { reason: 'unknown', hint: closestMatch(ref, keys) };
  }

  const matches = keys.filter((key) => key.slice(key.indexOf('/') + 1) === ref);

  if (matches.length === 1) return { event: matches[0]! };

  if (matches.length > 1) return { reason: 'ambiguous', matches };

  const ids = [...new Set(keys.map((key) => key.slice(key.indexOf('/') + 1)))];

  return { reason: 'unknown', hint: closestMatch(ref, ids) };
};

/** Why a reference did not resolve, in words a person can act on. */
export const describeUnresolved = (
  ref: string,
  resolution: Exclude<EventResolution, { event: string }>,
): string =>
  resolution.reason === 'ambiguous'
    ? `"${ref}", which more than one domain defines (${resolution.matches.join(', ')}) — write it as domain/id`
    : `unknown event "${ref}"${resolution.hint ? ` — did you mean "${resolution.hint}"?` : ''}`;

/** Resolve every declared event reference against an event catalog. */
export const linkEvents = (cat: Catalog, events: EventKey[]): EventLinks => {
  const links: EventLink[] = [];
  const issues: EventLinkIssue[] = [];

  for (const link of declaredEventLinks(cat)) {
    const resolution = resolveEventRef(link.ref, events);

    if ('event' in resolution) {
      links.push({ ...link, event: resolution.event });
      continue;
    }

    const subject = `${LABEL[link.from.kind]} "${link.from.id}" ${link.direction}`;

    issues.push({ ...link, message: `${subject} ${describeUnresolved(link.ref, resolution)}` });
  }

  return { links, issues };
};

/** Resolved links grouped by event, keyed `domain/id`. */
export const eventParticipants = (links: EventLink[]): Map<string, EventParticipants> => {
  const out = new Map<string, EventParticipants>();

  for (const link of links) {
    if (!link.event) continue;
    const entry = out.get(link.event) ?? { producers: [], consumers: [] };
    const label = `${link.from.kind}/${link.from.id}`;
    const list = link.direction === 'produces' ? entry.producers : entry.consumers;

    if (!list.includes(label)) list.push(label);

    if (link.direction === 'consumes' && link.fields) {
      entry.consumerFields = { ...entry.consumerFields, [label]: link.fields };
    }

    out.set(link.event, entry);
  }

  for (const entry of out.values()) {
    entry.producers.sort();
    entry.consumers.sort();
  }

  return out;
};

/**
 * Events with the Agents and Tools that declare them folded into `producers`
 * and `consumers`, so every tool that already answers "who does this reach"
 * (drift, impact, check_change, search) names them without knowing agents exist.
 */
export const withEventParticipants = (
  events: LoadedEvent[],
  participants: Map<string, EventParticipants>,
): LoadedEvent[] =>
  events.map((event) => {
    const extra = participants.get(`${event.frontmatter.domain}/${event.frontmatter.id}`);

    if (!extra) return event;

    const merge = (own: string[], added: string[]) => [...new Set([...own, ...added])];

    return {
      ...event,
      frontmatter: {
        ...event.frontmatter,
        producers: merge(event.frontmatter.producers, extra.producers),
        consumers: merge(event.frontmatter.consumers, extra.consumers),
        observed: event.frontmatter.observed
          ? {
              ...event.frontmatter.observed,
              declaredConsumers: merge(
                event.frontmatter.observed.declaredConsumers ?? event.frontmatter.consumers,
                extra.consumers,
              ),
            }
          : undefined,
        ...(extra.consumerFields && {
          consumerFields: { ...event.frontmatter.consumerFields, ...extra.consumerFields },
        }),
      },
    };
  });

/** The current events in an event catalog, as `{ domain, id }`. */
export const loadEventKeys = async (eventsRoot: string): Promise<EventKey[]> =>
  (await loadEventCatalog(eventsRoot, { skipVersioned: true })).map((e) => ({
    domain: e.frontmatter.domain,
    id: e.frontmatter.id,
  }));

/** Whether a directory holds an agent catalog worth loading. */
export const hasAgentCatalog = (root: string): boolean =>
  (['agent', 'tool'] as const).some((kind) => existsSync(join(root, DIR_BY_KIND[kind])));

/**
 * Link the agent catalog at `agentsRoot` to an event catalog, read from
 * `eventsRoot` or passed in already loaded.
 * Undefined when there is no agent catalog, so a repository without one pays
 * for a directory check and nothing else.
 */
export const linkAgentsToEvents = async (
  opts: { agentsRoot: string } & ({ eventsRoot: string } | { events: EventKey[] }),
): Promise<(EventLinks & { participants: Map<string, EventParticipants> }) | undefined> => {
  if (!hasAgentCatalog(opts.agentsRoot)) return undefined;

  const [cat, events] = await Promise.all([
    loadCatalog(opts.agentsRoot),
    'events' in opts ? opts.events : loadEventKeys(opts.eventsRoot),
  ]);

  const linked = linkEvents(cat, events);

  return { ...linked, participants: eventParticipants(linked.links) };
};
