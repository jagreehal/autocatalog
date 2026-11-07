import type { GatewayFile } from 'autocatalog-core';

/**
 * Each route as method × matcher, so two configurations compare whatever their
 * route names. One matcher two routes cover keeps both: either can serve it.
 */
function atoms(file: GatewayFile): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const route of file.routes) {
    const matchers = [
      ...(route.paths ?? []).map((path) => `${path}*`),
      ...(route.patterns ?? []).map((pattern) => `~${pattern}`),
    ];

    const how = [
      route.auth?.length
        ? `auth ${route.auth.join('+')}`
        : route.auth
          ? 'no auth'
          : 'auth not said',
      route.stripPath ? 'strips the path' : '',
      route.upstreamPath ? `to ${route.upstreamPath}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    for (const method of route.methods ?? ['ANY'])
      for (const matcher of matchers) {
        const key = `${route.service} ${method} ${matcher}`;

        out.set(key, (out.get(key) ?? new Set()).add(how));
      }
  }

  return out;
}

const shown = (hows: Set<string>) => [...hows].sort().join(' | ');

const same = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((how) => b.has(how));

/**
 * Where two configurations of one gateway disagree: a route one lets through
 * and the other does not, or the same route with other authentication, path
 * stripping or upstream path. Written the same but spelt differently, such as a
 * prefix in one and a pattern in the other, reads as a difference.
 */
export function compareGateways(
  first: GatewayFile,
  second: GatewayFile,
  names: [string, string],
): string[] {
  const [a, b] = [atoms(first), atoms(second)];
  const differences: string[] = [];

  for (const [key, how] of a) {
    const other = b.get(key);

    if (other === undefined)
      differences.push(`only ${names[0]} lets through ${key} (${shown(how)})`);
    else if (!same(how, other))
      differences.push(`${key}: ${shown(how)} in ${names[0]}, ${shown(other)} in ${names[1]}`);
  }

  for (const [key, how] of b)
    if (!a.has(key)) differences.push(`only ${names[1]} lets through ${key} (${shown(how)})`);

  return differences.sort();
}
