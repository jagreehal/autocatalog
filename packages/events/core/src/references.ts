import { z } from 'zod';
import { architectureService } from './architecture';
import { CONSUMES_FILE, type CatalogReference } from './consumes';
import {
  AUTOCATALOG_GRAPH_SPEC,
  relationshipKey,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';

/**
 * References across catalogs: a service in one repository receiving or
 * sending a resource another repository owns, named the way EventCatalog
 * names it, by id with an optional version. Resolved once every repository
 * has composed, so each team declares only its own side.
 */

/** One repository's references, as its declarations file says them. */
export interface RepositoryReferences {
  repository: string;
  receives: CatalogReference[];
  sends: CatalogReference[];
}

/** A service receiving an earlier release than the newest its publisher has. */
export interface BehindReference {
  /** The repository that declared the reference. */
  repository: string;
  service: string;
  /** The release the service reads. */
  resource: ResourceRef;
  /** The newest release, which a prerelease never is. */
  current: string;
}

export interface ResolvedReferences {
  graph: ResourceGraph;
  /** References that name nothing, more than one thing, or no matching version: said, never guessed. */
  unresolved: string[];
  behind: BehindReference[];
}

// ---------------------------------------------------------------------------
// Versions

type Triple = [number, number, number];

interface Version {
  parts: Triple;
  /** How many leading parts are given: 3 for `1.2.3`, 1 for `1` or `1.x`. */
  open: number;
  /** `beta.1` in `1.0.0-beta.1`: a prerelease, ordered before `1.0.0`. */
  pre?: string;
}

/** `1`, `1.2` and `1.2.3`, with `x` or `*` for a part left open, and a prerelease kept. */
function parseVersion(text: string): Version | undefined {
  const match =
    /^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/i.exec(
      text.trim(),
    );

  if (!match) return undefined;

  const raw = [match[1], match[2], match[3]];
  const open = raw.findIndex((part) => part === undefined || /^[x*]$/i.test(part));
  const fixed = open === -1 ? 3 : open;
  const part = (i: number) => (i < fixed ? Number(raw[i]) : 0);
  const parts: Triple = [part(0), part(1), part(2)];

  return { parts, open: fixed, ...(match[4] && { pre: match[4] }) };
}

/** Prerelease order, as semver has it: identifiers left to right, numbers numerically, before letters. */
function comparePre(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;

  if (a === undefined) return 1;

  if (b === undefined) return -1;

  const left = a.split('.');
  const right = b.split('.');

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];

    if (x === undefined) return -1;

    if (y === undefined) return 1;

    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);

    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y);

    if (nx !== ny) return nx ? -1 : 1;

    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

const compare = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether a version satisfies one comparator, such as `^1.2.0`, `~1.2`, `>=1 <2` or `1.x`. */
function satisfiesComparator(version: Version, comparator: string): boolean | undefined {
  const op = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comparator.trim());

  if (!op) return undefined;

  const [, operator = '', rest = ''] = op;
  const bound = parseVersion(rest);

  if (!bound) return undefined;

  const { parts, open } = bound;
  const at = (v: Triple, pre?: string) => compare(version.parts, v) || comparePre(version.pre, pre);
  const below = (v: Triple) => compare(version.parts, v) < 0;
  const from = () => at(parts, bound.pre) >= 0;

  const upper = (index: number): Triple =>
    index === 0
      ? [parts[0] + 1, 0, 0]
      : index === 1
        ? [parts[0], parts[1] + 1, 0]
        : [parts[0], parts[1], parts[2] + 1];

  switch (operator) {
    case '^': {
      // The leftmost non-zero part is fixed.
      const fixed = parts[0] > 0 || open <= 1 ? 0 : parts[1] > 0 || open <= 2 ? 1 : 2;

      return from() && below(upper(fixed));
    }

    case '~':
      return from() && below(upper(open <= 1 ? 0 : 1));
    case '>=':
      return from();
    case '>':
      return open < 3 ? !below(upper(open - 1)) : at(parts, bound.pre) > 0;
    case '<=':
      return open < 3 ? below(upper(open - 1)) : at(parts, bound.pre) <= 0;
    case '<':
      return at(parts, bound.pre) < 0;
    default:
      // `1.2.3` and `1.2.3-beta.1` are exact; `1` and `1.2` are the versions they leave open.
      return open === 3 ? at(parts, bound.pre) === 0 : from() && below(upper(open - 1));
  }
}

/**
 * Whether a published version satisfies what a reference asks for: none,
 * `latest` or `*` takes any; otherwise an exact version or a range, with `||`
 * between alternatives and spaces between comparators that must all hold.
 */
export function versionSatisfies(version: string, wanted: string | undefined): boolean {
  if (wanted === undefined || ['', '*', 'latest', 'x'].includes(wanted.trim())) return true;

  // A version is always itself, semver or not.
  if (version === wanted.trim()) return true;

  const parsed = parseVersion(version);

  if (!parsed || parsed.open !== 3) return false;

  return wanted.split('||').some((alternative) => {
    const comparators = alternative
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
      .split(/\s+/);

    // As semver has it: a prerelease satisfies a range only when the range
    // names a prerelease of the same version, so `^1.0.0` never picks a beta.
    if (
      parsed.pre !== undefined &&
      !comparators.some((comparator) => {
        const bound = parseVersion(comparator.replace(/^(\^|~|>=|<=|>|<|=)/, ''));

        return bound?.pre !== undefined && compare(bound.parts, parsed.parts) === 0;
      })
    )
      return false;

    return comparators.every((comparator) => satisfiesComparator(parsed, comparator) === true);
  });
}

// ---------------------------------------------------------------------------
// Resolution

interface Candidate {
  ref: ResourceRef;
  kind: 'event' | 'command';
  domain: string;
  /** The repository that publishes it, when the graph says. */
  repository?: string;
}

const domainAttribute = z.object({ domain: z.string() });

const domainOf = (resource: CatalogResource): string => {
  const parsed = domainAttribute.safeParse(resource.attributes);

  return parsed.success ? parsed.data.domain : (resource.ref.namespace ?? '');
};

/** Who publishes each event, from the composed graph's `defines` edges. */
function publishers(graph: ResourceGraph): Map<string, string> {
  const byEvent = new Map<string, string>();

  for (const edge of graph.relationships)
    if (edge.type === 'defines' && edge.from.kind === 'repository')
      byEvent.set(resourceKey(edge.to), edge.from.id);

  return byEvent;
}

/**
 * Each repository's references as graph edges onto the exact events and
 * commands the composed graph holds. A received event is consumed, a received
 * command handled, a sent command sent and a sent event produced. Several
 * versions of one resource are one target: the reference picks the highest
 * that satisfies its version, and fails to resolve when none does.
 */
export function resolveReferences(
  composed: ResourceGraph,
  repositories: RepositoryReferences[],
  /**
   * Earlier versions of what `composed` holds, from each repository's history,
   * so a range can pick a release behind the current one. Only a version a
   * reference picks joins the graph.
   */
  earlier?: ResourceGraph,
): ResolvedReferences {
  const owners = new Map([...publishers(earlier ?? composed), ...publishers(composed)]);
  const present = new Set(composed.resources.map((resource) => resourceKey(resource.ref)));

  const all = [
    ...composed.resources,
    ...(earlier?.resources ?? []).filter((resource) => !present.has(resourceKey(resource.ref))),
  ];

  const byKey = new Map(all.map((resource) => [resourceKey(resource.ref), resource]));

  const candidates: Candidate[] = all.flatMap((resource) => {
    if (resource.ref.kind !== 'event' && resource.ref.kind !== 'command') return [];

    const repository = owners.get(resourceKey(resource.ref));

    return [
      {
        ref: resource.ref,
        kind: resource.ref.kind,
        domain: resource.ref.kind === 'event' ? domainOf(resource) : (resource.ref.namespace ?? ''),
        ...(repository && { repository }),
      },
    ];
  });

  const services = new Map<string, CatalogResource>();
  const added = new Map<string, CatalogResource>();
  const relationships = new Map<string, CatalogRelationship>();
  const unresolved: string[] = [];
  const behind: BehindReference[] = [];

  for (const { repository, receives, sends } of repositories) {
    for (const [direction, list] of [
      ['receives', receives],
      ['sends', sends],
    ] as const) {
      for (const reference of list) {
        const [first, second] = reference.id.split('/');
        const domain = second === undefined ? undefined : first;
        const id = second ?? first ?? '';
        const named = candidates.filter((c) => c.ref.id === id && (!domain || c.domain === domain));
        const label = `${repository}: ${reference.service} ${direction} ${reference.id}${reference.version ? `@${reference.version}` : ''}`;

        if (named.length === 0) {
          unresolved.push(`${label}, which no repository publishes`);
          continue;
        }

        // One logical resource: one kind, one domain, one repository. Versions of it may differ.
        const identities = new Set(
          named.map((c) => `${c.kind}\0${c.domain}\0${c.repository ?? ''}`),
        );

        // The same domain/id from two repositories: naming the domain cannot settle it.
        const copies = [...new Set(named.map((c) => c.repository ?? '(unnamed)'))].sort();

        if (identities.size > 1 && new Set(named.map((c) => `${c.kind}\0${c.domain}`)).size === 1) {
          unresolved.push(
            `${label}, which ${copies.join(' and ')} both define. Each id has one owner: remove one copy`,
          );
          continue;
        }

        if (identities.size > 1) {
          const where = [
            ...new Set(
              named.map(
                (c) =>
                  `${c.kind} ${c.domain}/${c.ref.id}${c.repository ? ` in ${c.repository}` : ''}`,
              ),
            ),
          ].sort();

          unresolved.push(
            `${label}, which is ambiguous: ${where.join(', ')}. Name it as domain/id`,
          );
          continue;
        }

        const satisfying = named.filter((c) =>
          versionSatisfies(c.ref.version ?? '', reference.version),
        );
        // `latest`, or no version, means the newest stable release; a prerelease only when there is none.

        const stable = satisfying.filter(
          (c) => parseVersion(c.ref.version ?? '')?.pre === undefined,
        );

        const anyVersion = ['', '*', 'latest', 'x'].includes((reference.version ?? '').trim());

        const matching = (anyVersion && stable.length > 0 ? stable : satisfying).sort((a, b) =>
          compareVersions(b.ref.version ?? '', a.ref.version ?? ''),
        );

        const target = matching[0];

        if (!target) {
          const published = [...new Set(named.map((c) => c.ref.version ?? 'unversioned'))]
            .sort()
            .join(', ');

          unresolved.push(`${label}, but only ${published} is published`);
          continue;
        }

        const [newest] = named
          .filter((c) => parseVersion(c.ref.version ?? '')?.pre === undefined)
          .sort((a, b) => compareVersions(b.ref.version ?? '', a.ref.version ?? ''));

        const current = newest?.ref.version;

        if (
          direction === 'receives' &&
          current &&
          compareVersions(current, target.ref.version ?? '') > 0
        ) {
          behind.push({
            repository,
            service: reference.service,
            resource: target.ref,
            current,
          });
        }

        const service = architectureService(reference.service);
        services.set(resourceKey(service.ref), service);

        const key = resourceKey(target.ref);
        const version = present.has(key) ? undefined : byKey.get(key);

        // An earlier version joins the graph with its publisher, so the edge lands on a resource.
        if (version) {
          added.set(key, version);

          if (target.repository) {
            const defines: CatalogRelationship = {
              type: 'defines',
              from: { kind: 'repository', id: target.repository },
              to: target.ref,
              provenance: 'inferred',
              needsReview: false,
            };

            relationships.set(relationshipKey(defines), defines);
          }
        }

        const type =
          direction === 'receives'
            ? target.kind === 'event'
              ? 'consumes'
              : 'handles'
            : target.kind === 'event'
              ? 'produces'
              : 'sends';

        // A consumer edge runs from the event; the rest from the service.
        const relationship: CatalogRelationship = {
          type,
          from: type === 'consumes' ? target.ref : service.ref,
          to: type === 'consumes' ? service.ref : target.ref,
          provenance: 'declared',
          needsReview: false,
          source: { type: 'code', file: CONSUMES_FILE },
          attributes: { declaredBy: repository },
        };

        relationships.set(relationshipKey(relationship), relationship);
      }
    }
  }

  return {
    graph: {
      spec: AUTOCATALOG_GRAPH_SPEC,
      resources: [...added.values(), ...services.values()],
      relationships: [...relationships.values()],
    },
    unresolved: unresolved.sort(),
    behind,
  };
}

/** Highest first, as numbers part by part; anything unparseable last. */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  if (!pa || !pb) return pa ? 1 : pb ? -1 : a.localeCompare(b);

  return compare(pa.parts, pb.parts) || comparePre(pa.pre, pb.pre);
}
