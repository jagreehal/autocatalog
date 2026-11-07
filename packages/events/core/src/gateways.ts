import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { emptyResourceGraph } from './architecture';
import { endpointsByService, endpointFacts } from './api-resources';
import { mergeConsumerGraph, shownName } from './consumes';
import { readOptionalResourceJson, writeResourceFile } from './resource-files';
import { compileRoutePattern, matchesRoutePattern, type RoutePattern } from './route-pattern';
import type { CatalogRelationship, CatalogResource, ResourceGraph } from './resource-graph';

/**
 * What a repository's gateway sends where, written by a plugin such as
 * `autocatalog-plugin-kong` from the gateway's own configuration and committed,
 * so the site reads it without the gateway or the plugin.
 */
export const GATEWAY_FILE = 'autocatalog.gateway.json';

const NAME = /^[A-Za-z0-9][\w.:-]{0,199}$/;

// Printable ASCII only: paths are printed in build output.
const URL_PATH = /^\/[!-~]{0,400}$/;

const route = z.strictObject({
  name: z.string().regex(NAME, 'use letters, digits and . _ : -'),
  /** The catalog service the route forwards to. */
  service: z.string().regex(/^[A-Za-z0-9][\w.-]{0,199}$/, 'a service name'),
  /** Path prefixes the route matches. */
  paths: z.array(z.string().regex(URL_PATH, 'a path such as /users')).optional(),
  /** Regular expressions the route matches, anchored at the start of the path. */
  patterns: z.array(z.string().regex(/^[!-~]{1,400}$/, 'a regular expression')).optional(),
  /** The methods it accepts; without them, any. */
  methods: z
    .array(z.enum(['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'TRACE']))
    .optional(),
  /** Whether the matched prefix is removed before the request is forwarded. */
  stripPath: z.boolean().default(false),
  /** The path the service is forwarded to, below which the rest of the request goes. */
  upstreamPath: z.string().regex(URL_PATH, 'a path such as /').optional(),
  /** What authenticates a request on this route; empty when nothing does. */
  auth: z.array(z.string().regex(NAME)).optional(),
});

export type GatewayRoute = z.infer<typeof route>;

const routeWithPath = route.refine(
  ({ paths, patterns }) => (paths?.length ?? 0) + (patterns?.length ?? 0) > 0,
  'a route needs paths or patterns',
);

export const gatewayFileSchema = z.strictObject({
  $schema: z.string().optional(),
  /** The gateway's name in the catalog, such as `kong`. */
  gateway: z.string().regex(NAME, 'use letters, digits and . _ : -'),
  /** The configuration it was read from, from the repository's root. */
  source: z.string().optional(),
  routes: z.array(routeWithPath),
});

export type GatewayFile = z.infer<typeof gatewayFileSchema>;

/** The repository's {@link GATEWAY_FILE}, or nothing when it has none. */
export async function readGatewayFile(root: string): Promise<GatewayFile | undefined> {
  const value = await readOptionalResourceJson(path.join(root, GATEWAY_FILE), { root });

  if (value === undefined) return undefined;

  const parsed = gatewayFileSchema.safeParse(value);

  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];

  throw new Error(
    `${GATEWAY_FILE}: ${issue?.path.length ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'invalid'}`,
  );
}

/**
 * Writes the file a plugin read, routes in name order, so reading the same
 * configuration twice commits nothing new. `check` compares instead of writing.
 */
export async function writeGatewayFile(
  root: string,
  input: GatewayFile,
  options: { check?: boolean | undefined } = {},
): Promise<'written' | 'current' | 'stale'> {
  const committed = await readGatewayFile(root).catch(() => undefined);

  const file = gatewayFileSchema.parse({
    ...(committed?.$schema && { $schema: committed.$schema }),
    ...input,
    routes: [...input.routes].sort((a, b) => a.name.localeCompare(b.name)),
  });

  const text = `${JSON.stringify(file, null, 2)}\n`;
  const out = path.join(root, GATEWAY_FILE);

  if (options.check)
    return (await fs.readFile(out, 'utf8').catch(() => undefined)) === text ? 'current' : 'stale';

  await writeResourceFile(out, text);

  return 'written';
}

const withoutTrailingSlash = (value: string) => value.replace(/(?<=.)\/+$/, '');

/**
 * Where a client reaches an operation the service serves at `servedAt`, through
 * one route, or nothing when the route does not send it there.
 */
export function publicPath(gatewayRoute: GatewayRoute, servedAt: string): string | undefined {
  const upstream = withoutTrailingSlash(gatewayRoute.upstreamPath ?? '/');

  const below =
    upstream === '/'
      ? servedAt
      : servedAt.startsWith(`${upstream}/`)
        ? servedAt.slice(upstream.length)
        : undefined;

  if (below === undefined) return undefined;

  for (const prefix of gatewayRoute.paths ?? []) {
    if (gatewayRoute.stripPath)
      return `${withoutTrailingSlash(prefix)}${below === '/' ? '' : below}` || '/';

    if (below.startsWith(prefix)) return below;
  }

  // What a pattern stripped cannot be put back, so only an unstripped one is compared.
  if (gatewayRoute.stripPath) return undefined;

  // A template parameter stands for a segment: try a number and a word.
  const samples = ['1', 'a'].map((value) => below.replace(/\{[^}]*\}/g, value).slice(0, 400));

  return (gatewayRoute.patterns ?? []).some((pattern) => {
    const expression = compiled(pattern);

    return (
      expression !== undefined && samples.some((sample) => matchesRoutePattern(expression, sample))
    );
  })
    ? below
    : undefined;
}

/** A route's pattern, or nothing when it uses what the catalog does not match. */
const compiled = (pattern: string): RoutePattern | undefined => compileRoutePattern(pattern);

/**
 * One repository's gateway in the graph: each operation a route reaches is
 * exposed by the gateway, at the path a client uses. Where the gateway and the
 * contracts disagree goes to `onFinding`: a route that reaches no operation, an
 * operation of a routed service that no route reaches, and a route with no
 * authentication in front of an operation its spec secures.
 */
export function linkGateway(
  composed: ResourceGraph,
  { repository, file }: { repository: string; file: GatewayFile },
  onFinding: (message: string) => void,
): ResourceGraph {
  const gateway: CatalogResource = {
    ref: { kind: 'gateway', namespace: repository, id: file.gateway },
    title: file.gateway,
    tags: [],
    provenance: { default: 'extracted', fields: {} },
    needsReview: false,
    source: { repo: repository, file: GATEWAY_FILE },
    attributes: { routes: file.routes.length },
  };

  const byService = endpointsByService(composed);
  const relationships: CatalogRelationship[] = [];
  const reached = new Set<CatalogResource>();
  const say = (message: string) => onFinding(`${repository}: ${GATEWAY_FILE}: ${message}`);

  for (const gatewayRoute of file.routes) {
    const endpoints = byService.get(gatewayRoute.service);

    if (!endpoints) {
      say(
        `route ${gatewayRoute.name} forwards to ${gatewayRoute.service}, whose API the catalog does not have`,
      );
      continue;
    }

    let any = false;

    for (const endpoint of endpoints) {
      const facts = endpointFacts.safeParse(endpoint.attributes);

      if (!facts.success) continue;

      const { method, path: servedAt, secured, basePaths } = facts.data;

      if (gatewayRoute.methods && !gatewayRoute.methods.some((m) => m === method)) continue;

      // Where the spec says the service serves it: below each `servers` path, such
      // as /v1, or at the root when it declares no servers.
      const at = (basePaths.length > 0 ? basePaths : [''])
        .map((base) => publicPath(gatewayRoute, `${base}${servedAt}`))
        .find((reached) => reached !== undefined);

      if (!at) {
        // What a pattern reaches the samples cannot always prove. For the auth
        // check, a route that may reach a secured operation is taken to.
        if (secured && !gatewayRoute.auth?.length && mayReach(gatewayRoute, servedAt))
          say(
            `route ${gatewayRoute.name} may reach ${gatewayRoute.service} ${shownName(endpoint.ref.id)}, which it secures, and ${gatewayRoute.auth ? 'authenticates nothing' : 'does not say what authenticates it'}`,
          );

        continue;
      }

      any = true;
      reached.add(endpoint);
      relationships.push({
        type: 'exposedBy',
        from: endpoint.ref,
        to: gateway.ref,
        provenance: 'extracted',
        needsReview: false,
        source: { repo: repository, file: GATEWAY_FILE },
        attributes: {
          route: gatewayRoute.name,
          path: at,
          ...(gatewayRoute.auth && { auth: gatewayRoute.auth }),
        },
      });

      // A file that does not say what authenticates a route is unknown, never safe.
      if (secured && !gatewayRoute.auth?.length)
        say(
          gatewayRoute.auth
            ? `route ${gatewayRoute.name} authenticates nothing, and ${gatewayRoute.service} secures ${shownName(endpoint.ref.id)}`
            : `route ${gatewayRoute.name} does not say what authenticates it, and ${gatewayRoute.service} secures ${shownName(endpoint.ref.id)}`,
        );
    }

    const where = [
      ...(gatewayRoute.paths ?? []),
      ...(gatewayRoute.patterns ?? []).map((pattern) => `~${pattern}`),
    ];

    for (const pattern of gatewayRoute.patterns ?? [])
      if (!compiled(pattern))
        say(
          `route ${gatewayRoute.name}: ~${pattern} uses what the catalog does not match, such as a group, so it was not compared`,
        );

    if (gatewayRoute.stripPath && gatewayRoute.patterns?.length)
      say(
        `route ${gatewayRoute.name} strips a regular expression path, which the catalog does not compare`,
      );

    if (!any)
      say(
        `route ${gatewayRoute.name} sends ${where.join(', ')} to ${gatewayRoute.service}, which serves no operation there`,
      );
  }

  for (const service of new Set(file.routes.map((r) => r.service)))
    for (const endpoint of byService.get(service) ?? [])
      if (!reached.has(endpoint))
        say(`${service} ${shownName(endpoint.ref.id)} is not exposed through ${file.gateway}`);

  return { ...emptyResourceGraph(), resources: [gateway], relationships };
}

/** The part of a pattern or template before anything that varies. */
function fixedStart(value: string, stop: RegExp): string {
  const at = value.search(stop);

  return at === -1 ? value : value.slice(0, at);
}

/**
 * Whether a route's patterns may reach a path they did not match a sample of:
 * one that does not compile, or whose fixed start and the path's agree.
 */
function mayReach(gatewayRoute: GatewayRoute, servedAt: string): boolean {
  const path = fixedStart(servedAt, /\{/);

  return (gatewayRoute.patterns ?? []).some((pattern) => {
    if (!compiled(pattern)) return true;

    const start = fixedStart(pattern, /[\\.[\]()*+?{}|^$]/);

    return start.startsWith(path) || path.startsWith(start);
  });
}

/** Every repository's gateway, joined to the endpoints already in the graph. */
export async function withGateways(
  composed: ResourceGraph,
  repositories: { repository: string; dir: string }[],
  onFinding: (message: string) => void,
): Promise<ResourceGraph> {
  let graph = composed;

  for (const { repository, dir } of repositories) {
    let file: GatewayFile | undefined;

    try {
      file = await readGatewayFile(dir);
    } catch (error) {
      onFinding(`${repository}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (file)
      graph = mergeConsumerGraph(graph, linkGateway(graph, { repository, file }, onFinding));
  }

  return graph;
}
