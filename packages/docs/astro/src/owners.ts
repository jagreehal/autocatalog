import { z } from 'astro/zod';
import {
  isAgentSystemCatalogResource,
  resourceKey,
  type CatalogResource,
  type ResourceGraph,
} from 'autocatalog-core';
import { catalogHref } from './view';

/** Everything one owner owns, across every kind that carries ownership. */
export interface Owner {
  /** The page's URL segment, unique across the site. */
  slug: string;
  /** The owner however it was written, normalised: what {@link ownerFor} matches. */
  key: string;
  /**
   * How the owner is shown: the name every repository it spans declares, else
   * the first spelling, in sort order, of those that normalise alike.
   */
  name: string;
  /** A contact URL an owned event's manifest declares, when one does. */
  contact?: string;
  /** Owned resources in kind, then key, order. */
  resources: CatalogResource[];
  /** The repositories that publish or define anything this owner owns. */
  repositories: string[];
}

/**
 * One owner however it was written. CODEOWNERS handles lose their `@` when the
 * Scanner infers an owner from them, so a document declaring `@acme/payments`
 * and an event inferred as `acme/payments` are the same team.
 */
export function ownerKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^@/, '')
    .normalize('NFC')
    .toLocaleLowerCase('en-US');
}

// Agent-system entities name co-owners beyond the primary `owner`; the graph
// keeps that list in the entity's attributes.
const coOwners = z.array(z.string());

function ownersOf(resource: CatalogResource): string[] {
  const extra = isAgentSystemCatalogResource(resource)
    ? coOwners.safeParse(resource.attributes.owners)
    : undefined;

  return [...(resource.owner ? [resource.owner.team] : []), ...(extra?.success ? extra.data : [])];
}

const KIND_ORDER = ['document', 'event'];

const KIND_HEADINGS = new Map([
  ['service', 'Services'],
  ['collection', 'Collections'],
  ['table', 'Tables'],
  ['command', 'Commands'],
  ['queue', 'Queues'],
  ['document', 'Documents'],
  ['event', 'Events'],
  ['agent', 'Agents'],
  ['tool', 'Tools'],
  ['model', 'Models'],
  ['workflow', 'Workflows'],
  ['domain', 'Domains'],
  ['eval', 'Evals'],
  ['policy', 'Policies'],
]);

/** An owner's resources by kind, documents and events first, each under its heading. */
export function byKind(
  owner: Owner,
): Array<{ kind: string; heading: string; resources: CatalogResource[] }> {
  const groups = new Map<string, CatalogResource[]>();

  for (const resource of owner.resources) {
    const bucket = groups.get(resource.ref.kind);

    if (bucket) bucket.push(resource);
    else groups.set(resource.ref.kind, [resource]);
  }

  return [...groups].map(([kind, resources]) => ({
    kind,
    heading: KIND_HEADINGS.get(kind) ?? kind,
    resources,
  }));
}

const kindRank = (kind: string): number => {
  const rank = KIND_ORDER.indexOf(kind);

  return rank === -1 ? KIND_ORDER.length : rank;
};

/**
 * Every owner the graph names, in name order, including imported service ownership.
 */
export function buildOwners(graph: ResourceGraph): Owner[] {
  const byKey = new Map<
    string,
    { spellings: Set<string>; resources: Map<string, CatalogResource> }
  >();

  for (const resource of graph.resources) {
    for (const name of ownersOf(resource)) {
      const key = ownerKey(name);

      if (!key) continue;
      const entry = byKey.get(key) ?? { spellings: new Set(), resources: new Map() };
      entry.spellings.add(name.trim());
      entry.resources.set(resourceKey(resource.ref), resource);
      byKey.set(key, entry);
    }
  }

  const repositoryOf = new Map<string, string>();

  for (const { type, from, to } of graph.relationships) {
    if ((type === 'publishes' || type === 'defines') && from.kind === 'repository') {
      repositoryOf.set(resourceKey(to), from.id);
    }
  }

  // Keys in sort order, so when two owners slug alike the suffix always lands
  // on the same one.
  const taken = new Set<string>();

  return [...byKey]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => {
      const stem = key.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'owner';
      let slug = stem;

      for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`;
      taken.add(slug);

      const resources = [...entry.resources]
        .sort(
          ([a, ra], [b, rb]) =>
            kindRank(ra.ref.kind) - kindRank(rb.ref.kind) ||
            ra.ref.kind.localeCompare(rb.ref.kind) ||
            a.localeCompare(b),
        )
        .map(([, resource]) => resource);

      const repositories = new Set(
        resources.flatMap((resource) => repositoryOf.get(resourceKey(resource.ref)) ?? []),
      );

      return {
        slug,
        key,
        name:
          agreed(resources, repositoryOf, (owner) => owner.name) ??
          [...entry.spellings].sort()[0] ??
          key,
        contact: agreed(resources, repositoryOf, (owner) => owner.contact),
        resources,
        repositories: [...repositories].sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const built = new WeakMap<ResourceGraph, Owner[]>();

/** {@link buildOwners}, once per graph: every event and document page asks. */
export function graphOwners(graph: ResourceGraph): Owner[] {
  let owners = built.get(graph);

  if (!owners) {
    owners = buildOwners(graph);
    built.set(graph, owners);
  }

  return owners;
}

/** The owner page a name belongs on, if the graph knows that owner. */
export function ownerFor(owners: Owner[], name: string): Owner | undefined {
  const key = ownerKey(name);

  return owners.find((owner) => owner.key === key);
}

/** Root-relative link to an owner's page, honouring Astro's configured `base`. */
export function ownerHref(owner: Owner): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/owners/${owner.slug}/`;
}

/**
 * Where an owned resource is read: its own page for documents and events, its
 * row in the composed Catalog for everything else, which has no page yet.
 */
export function resourceHref(resource: CatalogResource): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const { kind, namespace, id } = resource.ref;

  if (kind === 'document' && resource.url) return `${base}${resource.url}`;

  if (kind === 'event' && namespace) return `${base}/events/${namespace}/${id}/`;

  return catalogHref(resource.ref);
}

/**
 * Where to reach an owner, from nothing but what the metadata already says: a
 * declared contact, an owner written as a URL or an email address, or a GitHub
 * team handle when the owner's repository is hosted on GitHub. Anything else
 * has no link rather than a guessed one.
 */
export function ownerContact(owner: Owner, onGitHub: boolean): string | undefined {
  if (owner.contact && SAFE_CONTACT.test(owner.contact)) return owner.contact;
  const name = owner.name.trim();

  if (/^https?:\/\/\S+$/.test(name)) return name;

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return `mailto:${name}`;

  const team = /^@?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(name);

  return team && onGitHub ? `https://github.com/orgs/${team[1]}/teams/${team[2]}` : undefined;
}

// A contact lands in an href, so only schemes a reader can safely follow.
const SAFE_CONTACT = /^(https?:\/\/|mailto:)\S+$/i;

/**
 * What every repository the owner spans declares about it, identically: its
 * name or contact. Owner pages span repositories, so no one repository may
 * name or link an owner others share: a repository that disagrees, or says
 * nothing, means nothing is shown.
 */
function agreed(
  resources: CatalogResource[],
  repositoryOf: Map<string, string>,
  pick: (owner: NonNullable<CatalogResource['owner']>) => string | undefined,
): string | undefined {
  const declared = new Map<string, Set<string>>();

  for (const resource of resources) {
    const repository = repositoryOf.get(resourceKey(resource.ref)) ?? '';
    const values = declared.get(repository) ?? new Set<string>();
    const value = resource.owner && pick(resource.owner);

    if (value) values.add(value);
    declared.set(repository, values);
  }

  const values = new Set([...declared.values()].flatMap((set) => [...set]));
  const everyRepositorySaysIt = [...declared.values()].every((set) => set.size === 1);

  return values.size === 1 && everyRepositorySaysIt ? [...values][0] : undefined;
}
