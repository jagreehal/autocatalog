import {
  loadCodeowners,
  ownerForPath,
  resolveResourceOwnership,
  resourceKey,
} from 'autocatalog-core';
import type {
  CatalogResource,
  CodeownersRule,
  OwnershipClaim,
  ResourceGraph,
} from 'autocatalog-core';
import { readRepositoryMeta } from 'autocatalog-docs-core';

/** A repository the site composes, and where its checkout is. */
export interface OwnedRepository {
  name: string;
  root: string;
}

/** An API spec and the services it names, so a service is owned where its spec is. */
export interface OwnedApi {
  repository: string;
  file: string;
  services?: Array<string> | undefined;
}

// Owners are compared as the resolver writes them, without CODEOWNERS' @.
const bare = (team: string | undefined) => team?.replace(/^@/, '');

const only = (teams: ReadonlySet<string> = new Set()) =>
  teams.size === 1 ? [...teams][0] : undefined;

const isData = ({ kind }: { kind: string }) => kind === 'collection' || kind === 'table';

// Who owns a repository as a whole: the rule matching a path no narrower rule
// names, so `*` or a rule for the package's folder does, and `/README.md` does not.
const ANY_PATH = '\0/\0';

/**
 * Each resource's owner from the CODEOWNERS of the repository it came from:
 * an endpoint, gateway or anything else by the file it was read from; a
 * service by the spec that defines it, when every spec naming it agrees; a
 * repository by its catch-all. A contract, and the service it defines, fall back
 * to the owner in `docs/meta.json`, as does a collection or table that only the
 * owner's services use. An owner a resource declares is kept.
 */
export async function withCodeowners(
  graph: ResourceGraph,
  repositories: ReadonlyArray<OwnedRepository>,
  apis: ReadonlyArray<OwnedApi>,
  within: string,
  /** The repository each table and collection is read from, whose source names none. */
  models: ReadonlyMap<string, { repository: string }> = new Map(),
): Promise<ResourceGraph> {
  const rules = new Map<string, Array<CodeownersRule>>();

  for (const { name, root } of repositories) {
    rules.set(name, await loadCodeowners(root, within));
  }

  const ownerIn = (repository: string, file: string) => {
    const found = rules.get(repository);

    return found && found.length > 0 ? ownerForPath(found, file) : undefined;
  };

  // A contract no CODEOWNERS rule covers is owned as the repository's documents are.
  const metaOwners = new Map(
    repositories.map(({ name, root }) => [name, readRepositoryMeta(root).meta.owner]),
  );

  const contracts = new Set(apis.map(({ repository, file }) => `${repository} ${file}`));

  /** Each service's owners, by whatever says who owns the specs that define it. */
  const serviceTeams = (ownerOf: (api: OwnedApi) => string | undefined) => {
    const found = new Map<string, Set<string>>();

    for (const api of apis) {
      const team = ownerOf(api);

      if (team === undefined) {
        continue;
      }

      for (const service of api.services ?? []) {
        found.set(service, (found.get(service) ?? new Set<string>()).add(team));
      }
    }

    return found;
  };

  const byRule = serviceTeams((api) => ownerIn(api.repository, api.file));
  const byMeta = serviceTeams((api) => metaOwners.get(api.repository));

  /** The owner a service takes: by the rules for its specs, else, for one without an owner, its documents'. */
  const serviceTeam = ({ ref, owner }: CatalogResource) =>
    byRule.has(ref.id) || owner ? only(byRule.get(ref.id)) : only(byMeta.get(ref.id));

  const dataTeam = soleDataTeam(graph, (service) => {
    const source = service.provenance.fields.owner ?? service.provenance.default;
    const declared = source === 'declared' || source === 'overridden';

    const own = service.owner?.team;
    const taken = serviceTeam(service);

    return declared ? (own ?? taken) : (taken ?? own);
  });

  const ownerOfFile = ({ source }: CatalogResource) =>
    source?.repo === undefined || source.file === undefined
      ? undefined
      : ownerIn(source.repo, source.file);

  // A repository may hold another team's model, so its own documents' owner is
  // not enough: that team's services must be the only ones using the data.
  const metaDataOwner = (key: string) => {
    const repository = models.get(key)?.repository;
    const team = repository === undefined ? undefined : bare(metaOwners.get(repository));

    return dataTeam.get(key) === team ? team : undefined;
  };

  const claims = graph.resources.flatMap((resource): Array<OwnershipClaim> => {
    const claim = (team: string | undefined, location: string): Array<OwnershipClaim> =>
      team ? [{ resource: resource.ref, team, source: 'codeowners', location }] : [];

    if (resource.ref.kind === 'service') {
      return claim(serviceTeam(resource), 'the OpenAPI spec that defines it');
    }

    if (resource.ref.kind === 'repository') {
      return claim(ownerIn(resource.ref.id, ANY_PATH), 'CODEOWNERS');
    }

    const { repo, file } = resource.source ?? {};
    const ruled = ownerOfFile(resource);

    if (ruled !== undefined) {
      return claim(ruled, file ?? 'CODEOWNERS');
    }

    // The documents' owner stands in for an owner; it takes the place of none.
    if (resource.owner) {
      return [];
    }

    if (isData(resource.ref)) {
      return claim(metaDataOwner(resourceKey(resource.ref)), 'docs/meta.json');
    }

    return repo !== undefined && contracts.has(`${repo} ${file}`)
      ? claim(metaOwners.get(repo), 'docs/meta.json')
      : [];
  });

  if (claims.length === 0) {
    return graph;
  }

  const keys = new Set(claims.map(({ resource }) => resourceKey(resource)));

  // Only the claimed resources go through: the rest keep exactly what they had.
  const { graph: owned } = resolveResourceOwnership(
    { ...graph, resources: graph.resources.filter(({ ref }) => keys.has(resourceKey(ref))) },
    { claims, codeowners: [] },
  );

  const byKey = new Map(owned.resources.map((resource) => [resourceKey(resource.ref), resource]));

  return {
    ...graph,
    resources: graph.resources.map((resource) => byKey.get(resourceKey(resource.ref)) ?? resource),
  };
}

/**
 * The one team whose services use each collection or table, writing to it at
 * least once. Data an unowned service or a second team's uses has none, so an
 * inferred owner can never turn access across teams into a team's own.
 */
function soleDataTeam(
  graph: ResourceGraph,
  teamOf: (service: CatalogResource) => string | undefined,
): Map<string, string> {
  const services = new Map(
    graph.resources.flatMap((resource) =>
      resource.ref.kind === 'service' ? [[resourceKey(resource.ref), resource]] : [],
    ),
  );

  const users = new Map<string, Set<string | undefined>>();
  const written = new Set<string>();

  for (const { type, from, to } of graph.relationships) {
    if (
      (type !== 'reads' && type !== 'writes') ||
      (to.kind !== 'collection' && to.kind !== 'table')
    ) {
      continue;
    }

    const key = resourceKey(to);
    const service = services.get(resourceKey(from));

    users.set(key, (users.get(key) ?? new Set()).add(service && bare(teamOf(service))));

    if (type === 'writes') {
      written.add(key);
    }
  }

  return new Map(
    [...users].flatMap(([key, teams]) => {
      const [team] = teams;

      return teams.size === 1 && team !== undefined && written.has(key) ? [[key, team]] : [];
    }),
  );
}
