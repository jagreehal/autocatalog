import {
  loadCodeowners,
  ownerForPath,
  resolveResourceOwnership,
  resourceKey,
  type CodeownersRule,
  type OwnershipClaim,
  type ResourceGraph,
} from 'autocatalog-core';

/** A repository the site composes, and where its checkout is. */
export interface OwnedRepository {
  name: string;
  root: string;
}

/** An API spec and the services it names, so a service is owned where its spec is. */
export interface OwnedApi {
  repository: string;
  file: string;
  services?: string[] | undefined;
}

// Who owns a repository as a whole: the rule matching a path no narrower rule
// names, so `*` or a rule for the package's folder does, and `/README.md` does not.
const ANY_PATH = '\0/\0';

/**
 * Each resource's owner from the CODEOWNERS of the repository it came from:
 * an endpoint, gateway or anything else by the file it was read from; a
 * service by the spec that defines it, when every spec naming it agrees; a
 * repository by its catch-all. An owner a resource declares is kept.
 */
export async function withCodeowners(
  graph: ResourceGraph,
  repositories: readonly OwnedRepository[],
  apis: readonly OwnedApi[],
  within: string,
): Promise<ResourceGraph> {
  const rules = new Map<string, CodeownersRule[]>();

  for (const { name, root } of repositories) rules.set(name, await loadCodeowners(root, within));

  const ownerIn = (repository: string, file: string) => {
    const found = rules.get(repository);

    return found && found.length > 0 ? ownerForPath(found, file) : undefined;
  };

  const specOwners = new Map<string, Set<string>>();

  for (const api of apis) {
    const team = ownerIn(api.repository, api.file);

    for (const service of api.services ?? []) {
      const teams = specOwners.get(service) ?? new Set<string>();

      if (team) teams.add(team);
      specOwners.set(service, teams);
    }
  }

  const claims = graph.resources.flatMap((resource): OwnershipClaim[] => {
    const claim = (team: string | undefined, location: string): OwnershipClaim[] =>
      team ? [{ resource: resource.ref, team, source: 'codeowners', location }] : [];

    if (resource.ref.kind === 'service') {
      const teams = [...(specOwners.get(resource.ref.id) ?? [])];

      return teams.length === 1 ? claim(teams[0], 'the OpenAPI spec that defines it') : [];
    }

    if (resource.ref.kind === 'repository') {
      return claim(ownerIn(resource.ref.id, ANY_PATH), 'CODEOWNERS');
    }

    const { repo, file } = resource.source ?? {};

    return repo && file ? claim(ownerIn(repo, file), file) : [];
  });

  if (claims.length === 0) return graph;

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
