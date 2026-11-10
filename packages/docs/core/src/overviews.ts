import {
  type CatalogResource,
  isEventCatalogResource,
  isServiceCatalogResource,
} from 'autocatalog-core';
import { z } from 'zod';
import { type Authored, readFolder } from './model';

/**
 * Where each kind's overview files live. Under `overviews/`, never at the
 * root: `services/` and `systems/` are common source folders, and a
 * `services/README.md` must not become a service's page.
 */
export const OVERVIEW_DIRS = {
  domain: 'overviews/domains',
  service: 'overviews/services',
  system: 'overviews/systems',
} as const;

export type OverviewKind = keyof typeof OVERVIEW_DIRS;

const OVERVIEW_KINDS: OverviewKind[] = ['domain', 'service', 'system'];

const overviewSchema = z.object({
  name: z.string().min(1).optional(),
  summary: z.string().optional(),
  owner: z.string().min(1).optional(),
  /** A domain's parent domain, which makes it a subdomain. */
  parent: z.string().min(1).optional(),
});

/** The text at the top of a domain, service or system page: `overviews/<kind>s/<id>.md`. */
export interface Overview extends Authored {
  kind: OverviewKind;
  /** The catalog's name for what it describes: a domain's id, a service's or system's name. */
  target: string;
  name?: string | undefined;
  summary?: string | undefined;
  owner?: string | undefined;
  /** A subdomain's parent, resolved to the parent's id. */
  parent?: string | undefined;
}

/** The names the catalog has for each kind, which an overview's file name picks one of. */
export type OverviewTargets = Record<OverviewKind, Iterable<string>>;

/**
 * The domains, services and systems a catalog's resources name: a domain
 * from an event, a service or a domain resource; a system from the services
 * that say they are part of it. `extra` adds names found elsewhere, such as
 * the systems a design declares.
 */
export function overviewTargets(
  resources: CatalogResource[],
  extra: Partial<OverviewTargets> = {},
): OverviewTargets {
  const domain = new Set(extra.domain);
  const service = new Set(extra.service);
  const system = new Set(extra.system);

  for (const resource of resources) {
    if (isEventCatalogResource(resource)) domain.add(resource.attributes.domain);

    if (resource.ref.kind === 'domain') domain.add(resource.ref.id);

    if (isServiceCatalogResource(resource)) {
      service.add(resource.ref.id);

      for (const name of resource.attributes.domains) domain.add(name);

      if (resource.attributes.system) system.add(resource.attributes.system.id);
    }
  }

  return { domain, service, system };
}

export interface ReadOverviewsOptions {
  /**
   * Keep overviews for what the catalog does not have: `ac docs check` reads
   * one repository, and the domain or service may come from another.
   */
  deferMissing?: boolean;
}

export interface ReadOverviewsResult {
  overviews: Overview[];
  /** One line per file left out, naming it and the check it fails. */
  failures: string[];
  /** One line per file kept or left out that the site can decide only once composed. */
  warnings: string[];
}

/** A file name and a catalog name match ignoring case and punctuation: `payment-worker` is Payment Worker. */
export const overviewKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const LABEL: Record<OverviewKind, string> = {
  domain: 'domain',
  service: 'service',
  system: 'system',
};

/**
 * Every repository's overview files, matched to the domain, service or system
 * each names. Two files for one resource: the first, in repository order, is
 * kept and the second fails. A file for something the catalog lacks is kept
 * when `deferMissing` (another repository may have it), and left out with a
 * warning otherwise. A subdomain's `parent` follows the same rule, and a
 * cycle, or a parent the catalog has as a service or system, fails.
 */
export function readOverviews(
  repositories: Array<{ repository: string; dir: string }>,
  targets: OverviewTargets,
  options: ReadOverviewsOptions = {},
): ReadOverviewsResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const overviews: Overview[] = [];

  const byKey = (names: Iterable<string>) =>
    new Map([...names].map((name) => [overviewKey(name), name]));

  const known: Record<OverviewKind, Map<string, string>> = {
    domain: byKey(targets.domain),
    service: byKey(targets.service),
    system: byKey(targets.system),
  };

  for (const kind of OVERVIEW_KINDS) {
    const definedIn = new Map<string, string>();

    for (const { data, where } of readFolder(
      repositories,
      OVERVIEW_DIRS[kind],
      overviewSchema,
      failures,
    )) {
      const at = `${where.repository}/${where.file}`;
      const target = known[kind].get(overviewKey(where.id));

      if (!target && !options.deferMissing) {
        warnings.push(`${at}: no ${LABEL[kind]} '${where.id}' in the catalog, so it is left out`);
        continue;
      }

      const resolved = target ?? where.id;
      const first = definedIn.get(overviewKey(resolved));

      if (first) {
        failures.push(`${at}: ${LABEL[kind]} '${resolved}' already has an overview in ${first}`);
        continue;
      }

      definedIn.set(overviewKey(resolved), at);

      if (data.parent && kind !== 'domain') {
        failures.push(`${at}: only a domain takes a parent`);
        continue;
      }

      overviews.push({
        ...where,
        kind,
        target: resolved,
        name: data.name,
        summary: data.summary,
        owner: data.owner,
        parent: data.parent,
      });
    }
  }

  return {
    overviews: checkParents(overviews, known, options, failures, warnings),
    failures,
    warnings,
  };
}

/** Resolve each subdomain's parent, leaving out a cycle and a parent that is not a domain. */
function checkParents(
  overviews: Overview[],
  known: Record<OverviewKind, Map<string, string>>,
  options: ReadOverviewsOptions,
  failures: string[],
  warnings: string[],
): Overview[] {
  const domains = overviews.filter((overview) => overview.kind === 'domain');
  const parentOf = new Map<string, string>();

  // A domain with an overview here is a domain, even when its events are in
  // another repository: so a cycle between two of them fails this checkout.
  const described = new Map(domains.map(({ target }) => [overviewKey(target), target]));

  for (const domain of domains) {
    if (!domain.parent) continue;

    const at = `${domain.repository}/${domain.file}`;
    const key = overviewKey(domain.parent);
    const parent = known.domain.get(key) ?? described.get(key);

    if (parent) {
      domain.parent = parent;
      parentOf.set(overviewKey(domain.target), parent);
      continue;
    }

    if (known.service.has(key) || known.system.has(key)) {
      failures.push(`${at}: parent '${domain.parent}' is not a domain`);
      domain.parent = undefined;
      continue;
    }

    if (!options.deferMissing) {
      warnings.push(
        `${at}: no domain '${domain.parent}' to be its parent, so it is shown at the top`,
      );
      domain.parent = undefined;
    }
  }

  // A domain that reaches itself through its parents.
  const cyclic = new Set<string>();

  for (const domain of domains) {
    const seen = new Set<string>();
    let at: string | undefined = overviewKey(domain.target);

    while (at && !seen.has(at)) {
      seen.add(at);
      const next = parentOf.get(at);
      at = next === undefined ? undefined : overviewKey(next);
    }

    if (at === overviewKey(domain.target)) cyclic.add(at);
  }

  return overviews.filter((overview) => {
    if (overview.kind !== 'domain' || !cyclic.has(overviewKey(overview.target))) return true;

    failures.push(
      `${overview.repository}/${overview.file}: domain '${overview.target}' is its own ancestor through parent`,
    );

    return false;
  });
}
