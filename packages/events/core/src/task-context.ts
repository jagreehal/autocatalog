import { z } from 'zod';
import {
  isDocumentCatalogResource,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';
import type { JsonObject } from './json';

/** One resource as a context bundle names it: enough to cite, not the whole record. */
export interface ContextItem {
  key: string;
  kind: string;
  title: string;
  summary?: string;
  url?: string;
  owner?: string;
  /** Where it is defined, `repository:file`, when the graph says. */
  source?: string;
  /** A document's kind (`adr`, `runbook`) or an event's status. */
  status?: string;
  /** A document's last change, as its repository's history records it. */
  updated?: string;
  needsReview?: true;
  /** Set when the catalog guessed this resource exists rather than anyone declaring it. */
  inferred?: true;
  /** A glossary term's other names. */
  aliases?: string[];
}

/**
 * How something is known. `declared` is what a team wrote down; `in code` is
 * what a scan read from source; `observed` is what supplied traces showed;
 * `reported` is a runtime source naming a consumer without anyone seeing a
 * delivery; `inferred` is the catalog's own guess, such as a service named
 * only because an event lists it.
 */
export type ContextEvidence = 'declared' | 'in code' | 'observed' | 'reported' | 'inferred';

export interface ContextRelationship {
  from: string;
  type: string;
  to: string;
  evidence: ContextEvidence[];
  /** What the edge records beyond its ends, such as the fields a consumer reads or its dead-letter queue. */
  details?: JsonObject;
}

/** What an agent needs before starting a task: connected, cited, and honest about gaps. */
export interface TaskContext {
  task: string;
  /** The words the task was matched on, after dropping filler. */
  terms: string[];
  /** Resources the task's words name directly, best first, by key; each is listed in full below. */
  matches: Array<{ key: string; matched: string[] }>;
  /** Glossary terms the task used, by their name or an alias, and what they mean. */
  vocabulary: ContextItem[];
  services: ContextItem[];
  /** Events, commands, endpoints, queues and datastores: what a change could break. */
  contracts: ContextItem[];
  /** Decision records about the matches. A superseded one is listed with its status. */
  decisions: ContextItem[];
  /** Runbooks and incidents about the matches. */
  operations: ContextItem[];
  /** Other documents about the matches. */
  documents: ContextItem[];
  /** Who to ask, with what of the bundle they own. */
  owners: Array<{ team: string; owns: string[] }>;
  relationships: ContextRelationship[];
  /** What the catalog could not establish. An answer should say these out loud. */
  gaps: string[];
  /**
   * How many of each list were left out by the limit. Present only when
   * something was: call again with a higher `limit` for the rest.
   */
  omitted?: Partial<Record<OmittedList, number>>;
}

type OmittedList =
  'matches' | 'services' | 'contracts' | 'decisions' | 'operations' | 'documents' | 'relationships';

export interface TaskContextOptions {
  /** The most of each list to return. Relationships get twice this. Default 12. */
  limit?: number;
}

const STOP = new Set(
  'the and for with from into that this what which who how why our their its are was were add make change new use using need needs want can should would could does when where there them they have has about over under than then also only just more most some any all each every task build fix update support'.split(
    ' ',
  ),
);

/** `Partial refunds` → `partial`, `refunds`; `payment.completed` → `payment`, `completed`. */
function words(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
}

/** `refunds`, `refunded` → `refund`; `retried`, `retries` → `retry`. */
const stem = (word: string): string =>
  word.length <= 4
    ? word
    : word
        .replace(/ie[sd]$/, 'y')
        .replace(/(ing|ed)$/, '')
        .replace(/([^s])s$/, '$1');

/**
 * Whether two words name the same thing: the same stem, or one stem starting
 * the other once the shorter has four letters. Below that only the same word
 * counts, or `pay` would match `payroll`.
 */
const sameWord = (a: string, b: string): boolean => {
  const [x, y] = [stem(a), stem(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];

  return short === long || (short.length >= 4 && long.startsWith(short));
};

const DEFAULT_LIMIT = 12;

// Relationships name an event with or without its version; the bundle is about the current one.
const keyOf = (ref: ResourceRef): string => resourceKey({ ...ref, version: undefined });

const CONTRACT_KINDS = new Set(['event', 'command', 'endpoint', 'queue', 'collection', 'table']);

const KNOWN_BY: Record<CatalogRelationship['provenance'], ContextEvidence> = {
  declared: 'declared',
  overridden: 'declared',
  extracted: 'in code',
  observed: 'observed',
  inferred: 'inferred',
};

/**
 * A snapshot consumer is observed only when the snapshot says it saw delivery;
 * a subscriber that reported itself, or an unknown source, is `reported`.
 */
const reportedOnly = (edge: CatalogRelationship): boolean =>
  edge.provenance === 'observed' &&
  ['reported', 'unknown'].includes(String(edge.attributes?.['attribution']));

/** A declared edge that traces also carried is known both ways. */
const evidenceOf = (edge: CatalogRelationship): ContextEvidence[] =>
  reportedOnly(edge)
    ? ['reported']
    : edge.evidence && edge.provenance !== 'observed'
      ? [KNOWN_BY[edge.provenance], 'observed']
      : [KNOWN_BY[edge.provenance]];

/** What an edge records beyond its ends, less the attribution `evidence` already says. */
function detailsOf(edge: CatalogRelationship): JsonObject | undefined {
  const { attribution: _, ...rest } = edge.attributes ?? {};

  return Object.keys(rest).length > 0 ? rest : undefined;
}

const optionalText = z.string().optional().catch(undefined);

/** The attributes a bundle item reads, ignoring any of another shape. */
const resourceText = z.object({
  kind: optionalText,
  status: optionalText,
  updated: optionalText,
  aliases: z.array(z.string()).optional().catch(undefined),
});

/** A glossary term's `aliases`, as the site's graph carries them. */
const aliasesOf = (resource: CatalogResource): string[] =>
  resourceText.parse(resource.attributes ?? {}).aliases ?? [];

function item(resource: CatalogResource): ContextItem {
  const attributes = resourceText.parse(resource.attributes ?? {});
  const aliases = attributes.aliases ?? [];
  const status = [attributes.kind, attributes.status].filter(Boolean);
  const { source } = resource;
  // An inferred resource's summary is the catalog's own wording, not anyone's description.
  const inferred = resource.provenance.default === 'inferred';

  return {
    key: keyOf(resource.ref),
    kind: resource.ref.kind,
    title: resource.title,
    ...(resource.summary && !inferred && { summary: resource.summary }),
    ...(resource.url && { url: resource.url }),
    ...(resource.owner?.team && { owner: resource.owner.team }),
    ...(source?.file && { source: source.repo ? `${source.repo}:${source.file}` : source.file }),
    ...(status.length > 0 && { status: status.join(' ') }),
    ...(attributes.updated && { updated: attributes.updated }),
    ...(resource.needsReview && { needsReview: true as const }),
    ...(inferred && { inferred: true as const }),
    ...(aliases.length > 0 && { aliases }),
  };
}

/** Score a resource by the task words in its names (weighted) and its summary. */
function score(resource: CatalogResource, terms: Set<string>) {
  const named = words(
    [
      resource.ref.id,
      resource.ref.namespace ?? '',
      resource.title,
      ...resource.tags,
      ...aliasesOf(resource),
    ].join(' '),
  );

  const described = words(resource.summary ?? '');
  const inName = (term: string) => named.some((word) => sameWord(term, word));

  const matched = [...terms].filter(
    (term) => inName(term) || described.some((word) => sameWord(term, word)),
  );

  return {
    score: matched.reduce((total, term) => total + (inName(term) ? 3 : 1), 0),
    matched,
  };
}

/**
 * The connected material an agent needs before starting `task`: the resources
 * its words name, their neighbours one hop out, the decisions, runbooks and
 * documents about them, who owns them, and how each relationship is known.
 *
 * Matching is by words, so it finds what the catalog calls things, not what a
 * team calls them; the gaps say when nothing matched rather than guessing.
 */
export function taskContext(
  graph: ResourceGraph,
  task: string,
  options: TaskContextOptions = {},
): TaskContext {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const omitted: Partial<Record<OmittedList, number>> = {};

  const capped = <T>(name: OmittedList, items: T[], max = limit): T[] => {
    if (items.length > max) omitted[name] = items.length - max;

    return items.slice(0, max);
  };

  const terms = [...new Set(words(task))];
  const termSet = new Set(terms);
  const byKey = new Map(graph.resources.map((resource) => [keyOf(resource.ref), resource]));

  const scored = graph.resources
    .filter((resource) => resource.ref.kind !== 'repository')
    .map((resource) => ({ resource, ...score(resource, termSet) }))
    .filter((entry) => entry.score > 0);

  // Once something is named for the task, a word that only turns up in a
  // summary is noise: "card" in a refund's description is not about cards.
  const named = scored.some((entry) => entry.score >= 3);

  const allRanked = scored
    .filter((entry) => !named || entry.score >= 3)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // On a tie, the system before the page about it.
        Number(isDocumentCatalogResource(a.resource)) -
          Number(isDocumentCatalogResource(b.resource)) ||
        a.resource.title.localeCompare(b.resource.title),
    );

  const ranked = capped('matches', allRanked);

  const seeds = new Set(ranked.map((entry) => keyOf(entry.resource.ref)));
  const matchedTerms = ranked.filter((entry) => entry.resource.ref.kind === 'term');

  // A term stands for what implements it, so those are matches too, with their neighbours.
  for (const edge of graph.relationships) {
    if (edge.type === 'describes' && edge.from.kind === 'term' && seeds.has(keyOf(edge.from))) {
      seeds.add(keyOf(edge.to));
    }
  }

  // One hop out: what produces, consumes, handles or describes a match.
  const edges = graph.relationships.filter(
    (edge) =>
      edge.type !== 'publishes' &&
      edge.type !== 'defines' &&
      (seeds.has(keyOf(edge.from)) || seeds.has(keyOf(edge.to))),
  );

  const included = new Set(seeds);

  for (const edge of edges) {
    included.add(keyOf(edge.from));
    included.add(keyOf(edge.to));
  }

  const resources = [...included].flatMap((key) => byKey.get(key) ?? []);
  const docs = resources.filter(isDocumentCatalogResource);
  const kindOf = (kind: string) => docs.filter((doc) => doc.attributes.kind === kind);
  const list = (name: OmittedList, items: CatalogResource[]) => capped(name, items).map(item);

  const decisions = kindOf('adr');
  const operations = [...kindOf('runbook'), ...kindOf('incident')];

  const otherDocs = docs.filter(
    (doc) => !['adr', 'runbook', 'incident'].includes(doc.attributes.kind ?? ''),
  );

  const services = resources.filter((resource) => resource.ref.kind === 'service');
  const contracts = resources.filter((resource) => CONTRACT_KINDS.has(resource.ref.kind));

  const owners = new Map<string, string[]>();

  for (const resource of resources) {
    if (!resource.owner?.team || isDocumentCatalogResource(resource)) continue;
    owners.set(resource.owner.team, [...(owners.get(resource.owner.team) ?? []), resource.title]);
  }

  // How the systems connect. A document's `about:` is listed under decisions and documents.
  const runtime = edges.filter((edge) => edge.type !== 'describes' && edge.type !== 'relatesTo');

  const relationships = capped('relationships', runtime, limit * 2).map((edge) => {
    const details = detailsOf(edge);

    return {
      from: keyOf(edge.from),
      type: edge.type,
      to: keyOf(edge.to),
      evidence: evidenceOf(edge),
      ...(details && { details }),
    };
  });

  const nameOf = (key: string) => byKey.get(key)?.title ?? key.slice(key.indexOf(':') + 1);

  // A consumes edge runs event → service; a reader says the service consumes the event.
  const said = (edge: ContextRelationship) =>
    edge.type === 'consumes'
      ? `${nameOf(edge.to)} consumes ${nameOf(edge.from)}`
      : `${nameOf(edge.from)} ${edge.type} ${nameOf(edge.to)}`;

  const gaps: string[] = [];

  if (ranked.length === 0) {
    gaps.push(
      `Nothing in the catalog is named for ${terms.length > 0 ? terms.join(', ') : 'this task'}. It may be new, or the catalog may use other words for it: ask what the team calls it before assuming nothing exists.`,
    );
  }

  const matchedSystems = [...seeds]
    .flatMap((key) => byKey.get(key) ?? [])
    .filter((resource) => !isDocumentCatalogResource(resource) && resource.ref.kind !== 'term');

  const unlinked = matchedTerms.filter(
    (entry) =>
      !graph.relationships.some(
        (edge) => edge.type === 'describes' && keyOf(edge.from) === keyOf(entry.resource.ref),
      ),
  );

  if (unlinked.length > 0) {
    gaps.push(
      `${unlinked.map((entry) => entry.resource.title).join(', ')}: in the glossary, but its about: names nothing that implements it.`,
    );
  }

  const unowned = matchedSystems.filter((resource) => !resource.owner?.team);

  if (unowned.length > 0)
    gaps.push(`No owner recorded for ${unowned.map((r) => r.title).join(', ')}.`);

  if (matchedSystems.length > 0 && decisions.length === 0) {
    gaps.push(
      'No decision record is about these resources: the reasons behind the current design are not in the catalog.',
    );
  }

  const superseded = decisions.filter((doc) => doc.attributes.status === 'superseded');

  if (superseded.length > 0) {
    gaps.push(
      `${superseded.map((doc) => doc.title).join(', ')}: superseded, so check what replaced it before relying on it.`,
    );
  }

  const undeclared = relationships.filter((edge) => edge.evidence.join() === 'observed');

  for (const edge of undeclared) {
    gaps.push(`${said(edge)} was seen in traces, but nobody declared it.`);
  }

  for (const edge of relationships.filter((edge) => edge.evidence.join() === 'reported')) {
    gaps.push(
      `${said(edge)} was reported by a runtime source, but no delivery was observed and nobody declared it.`,
    );
  }

  // Declared but unseen means something only when traces were supplied at all.
  const traced = graph.relationships.some(
    (edge) => edge.evidence || (edge.provenance === 'observed' && !reportedOnly(edge)),
  );

  const written = (edge: ContextRelationship) =>
    (edge.evidence.includes('declared') || edge.evidence.includes('in code')) &&
    !edge.evidence.includes('observed');

  if (traced) {
    for (const edge of relationships.filter(written)) {
      gaps.push(
        `${said(edge)} is declared but was not in the supplied traces; they do not establish whether it still happens.`,
      );
    }
  } else if (relationships.some(written)) {
    gaps.push(
      'No runtime traces were supplied, so every relationship here is as written down or read from code, not as observed in production.',
    );
  }

  const review = resources.filter((resource) => resource.needsReview);

  if (review.length > 0) {
    gaps.push(
      `${review.map((r) => r.title).join(', ')}: marked for review; some of what is recorded was guessed.`,
    );
  }

  const lists = {
    services: list('services', services),
    contracts: list('contracts', contracts),
    decisions: list('decisions', decisions),
    operations: list('operations', operations),
    documents: list('documents', otherDocs),
  };

  const cut = Object.entries(omitted);

  if (cut.length > 0) {
    gaps.push(
      `Not everything fits: ${cut.map(([name, count]) => `${count} more ${name}`).join(', ')} left out. Call again with a higher limit before treating these lists as complete.`,
    );
  }

  return {
    task,
    terms,
    matches: ranked.map(({ resource, matched }) => ({ key: keyOf(resource.ref), matched })),
    vocabulary: matchedTerms.map((entry) => item(entry.resource)),
    ...lists,
    owners: [...owners].map(([team, owns]) => ({ team, owns })),
    relationships,
    gaps,
    ...(cut.length > 0 && { omitted }),
  };
}
