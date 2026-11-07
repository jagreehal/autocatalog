import { declaredApiService, publishedApis } from './api-resources';
import { loadRepositoryEvents } from './repository-events';

/**
 * The services a repository says are its own: those its events name as
 * producer, and those its OpenAPI specs name in `x-autocatalog.service`. A
 * claim is only a claim: `ac federation lock` decides who owns each service.
 */
export async function serviceClaims(repository: string, dir: string): Promise<string[]> {
  // A repository whose events cannot be read claims nothing it can be held to: the caller decides.
  const events = await loadRepositoryEvents(dir);
  const apis = await publishedApis(repository, dir, () => undefined);

  return [
    ...new Set([
      ...events.flatMap((event) => (event.folder.isVersioned ? [] : event.frontmatter.producers)),
      ...apis.flatMap((api) => declaredApiService(api.document) ?? []),
    ]),
  ].sort();
}

export interface ResolvedOwners {
  /** Each service, and the one repository that owns it. */
  services: Record<string, string>;
  /** Services more than one repository claims that nothing settles, in words. */
  conflicts: string[];
  /** A pin kept although another repository now claims the service too, in words. */
  contested: string[];
}

/**
 * Who owns each service. A pin already in the lock stands while its repository
 * still claims the service, so a newcomer cannot take one over by claiming it;
 * `chosen` moves a pin, and settles a service several repositories claim.
 * `refreshed` are the repositories whose claims were read this time; a pin to
 * any other repository is kept as it was.
 */
export function resolveServiceOwners(input: {
  claims: Map<string, string[]>;
  previous: Record<string, string>;
  chosen: Record<string, string>;
}): ResolvedOwners {
  const { claims, previous, chosen } = input;
  const claimants = new Map<string, Set<string>>();

  for (const [repository, services] of claims)
    for (const service of services)
      claimants.set(service, (claimants.get(service) ?? new Set()).add(repository));

  const services: Record<string, string> = {};
  const conflicts: string[] = [];
  const contested: string[] = [];

  // A pin to a repository not read this time stays as it was.
  for (const [service, repository] of Object.entries(previous))
    if (!claims.has(repository)) services[service] = repository;

  for (const [service, by] of [...claimants].sort(([a], [b]) => a.localeCompare(b))) {
    const pinned = previous[service];
    const others = [...by].filter((repository) => repository !== pinned).sort();

    if (chosen[service]) services[service] = chosen[service];
    else if (pinned && claims.has(pinned) && !by.has(pinned))
      // The owner stopped claiming it while another repository claims it: a person moves it.
      conflicts.push(
        `${service} is pinned to ${pinned}, which no longer claims it, and ${[...by].sort().join(' and ')} does. Pass --service ${service}=<repository> to move it`,
      );
    else if (pinned && (by.has(pinned) || !claims.has(pinned))) {
      services[service] = pinned;

      if (others.length)
        contested.push(
          `${service} is also claimed by ${others.join(' and ')}; it stays with ${pinned}. Pass --service ${service}=<repository> to move it`,
        );
    } else if (by.size === 1) services[service] = [...by][0] ?? '';
    else
      conflicts.push(
        `${service} is claimed by ${[...by].sort().join(' and ')}. Remove one claim, or pass --service ${service}=<repository>`,
      );
  }

  for (const [service, repository] of Object.entries(chosen)) services[service] = repository;

  return {
    services: Object.fromEntries(Object.entries(services).sort(([a], [b]) => a.localeCompare(b))),
    conflicts,
    contested,
  };
}
