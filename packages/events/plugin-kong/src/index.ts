import fs from 'node:fs/promises';
import path from 'node:path';
import { writeGatewayFile, type GatewayFile, type GatewayRoute } from 'autocatalog-core';
import kleur from 'kleur';
import { parseAllDocuments, parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AUTHENTICATION, authenticates } from './authentication';
import { compareGateways } from './compare';
import { isKubernetes, readKubernetes } from './kubernetes';

// A decK declarative configuration, as `deck gateway dump` writes it and DB-less
// Kong reads it. Routes sit under their service or at the top naming one, and
// plugins sit under a service or route or at the top naming either, or neither,
// which applies them to every route.

/** A reference to a service or route, by name or as `{ name }`. */
const reference = z
  .union([z.string(), z.object({ name: z.string() }).transform(({ name }) => name)])
  .optional();

const plugin = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  service: reference,
  route: reference,
  consumer: reference,
  /** Only `anonymous` is read: set, the plugin lets a request through without credentials. */
  config: z.looseObject({ anonymous: z.unknown().optional() }).optional(),
});

type Plugin = z.infer<typeof plugin>;

const route = z.object({
  name: z.string().optional(),
  paths: z.array(z.string()).optional(),
  methods: z.array(z.string()).optional(),
  strip_path: z.boolean().default(true),
  service: reference,
  plugins: z.array(plugin).default([]),
});

const service = z.object({
  name: z.string(),
  url: z.string().optional(),
  path: z.string().optional(),
  routes: z.array(route).default([]),
  plugins: z.array(plugin).default([]),
});

const configuration = z.object({
  _format_version: z.string(),
  services: z.array(service).default([]),
  routes: z.array(route).default([]),
  plugins: z.array(plugin).default([]),
});

/** A decK template, such as `${{ env "DECK_JWT_PUBLIC_KEY" }}`. */
const DECK_TEMPLATE = /\$\{\{[^}]*\}\}/g;

type Method = NonNullable<GatewayRoute['methods']>[number];

const METHODS = new Set<string>([
  'GET',
  'PUT',
  'POST',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
  'TRACE',
]);

const isMethod = (value: string): value is Method => METHODS.has(value);

const NAME = /^[A-Za-z0-9][\w.:-]{0,199}$/;

/** The path of a service's URL, which Kong forwards below. */
function upstreamPathOf(entry: z.infer<typeof service>): string | undefined {
  if (entry.path) return entry.path;

  if (!entry.url) return undefined;

  try {
    const { pathname } = new URL(entry.url);

    return pathname === '/' ? undefined : pathname;
  } catch {
    return undefined;
  }
}

export interface ReadKongOptions {
  /** The gateway's name in the catalog. */
  gateway?: string;
  /** Kong service names that differ from the catalog's, Kong's first. */
  services?: Record<string, string>;
}

/** What a configuration routes where, and what it could not say. */
/** {@link readKong}'s answer. */
export interface KongRead {
  file: GatewayFile;
  /** What the configuration holds that the file cannot say, in words. */
  warnings: string[];
}

/**
 * What a configuration routes where, and what it could not say. Several files
 * are read as one, the way decK merges a platform file with each team's.
 */
export { compareGateways } from './compare';

export function readKong(texts: string[], options: ReadKongOptions = {}): KongRead {
  // Kubernetes manifests come several to a file, a decK configuration one.
  const documents = texts.flatMap((text) =>
    parseAllDocuments(text.replace(DECK_TEMPLATE, 'from-environment')).map((document) =>
      document.toJS(),
    ),
  );

  if (isKubernetes(documents)) {
    const { routes, warnings } = readKubernetes(documents, options.services ?? {});

    return { file: { gateway: options.gateway ?? 'kong', routes }, warnings };
  }

  const parts = texts.map((text, index) => {
    // decK fills `${{ env "NAME" }}` before it parses, so do the same. Routes and
    // plugins are all this reads, so no value is looked up.
    const parsed = configuration.safeParse(
      parseYaml(text.replace(DECK_TEMPLATE, 'from-environment')),
    );

    if (parsed.success) return parsed.data;

    const issue = parsed.error.issues[0];

    throw new Error(
      `file ${index + 1} is not a Kong declarative configuration (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'})`,
    );
  });

  const config = {
    services: parts.flatMap((part) => part.services),
    routes: parts.flatMap((part) => part.routes),
    plugins: parts.flatMap((part) => part.plugins),
  };

  const warnings: string[] = [];

  // A plugin scoped to a consumer applies to that consumer only, never to a route as such.
  const scoped = (list: Plugin[]) =>
    list.filter((entry) => AUTHENTICATION.has(entry.name) && !entry.consumer);

  const global = scoped(config.plugins).filter((entry) => !entry.service && !entry.route);

  const routes = [
    ...config.services.flatMap((owner) => owner.routes.map((entry) => ({ entry, owner }))),
    ...config.routes.map((entry) => ({
      entry,
      owner: config.services.find(({ name }) => name === entry.service),
    })),
  ];

  const out: GatewayRoute[] = [];

  for (const [index, { entry, owner }] of routes.entries()) {
    const name = entry.name ?? `${owner?.name ?? 'route'}-${index + 1}`;

    if (!owner) {
      warnings.push(`route ${name}: names no service in this configuration, so it was left out`);
      continue;
    }

    if (!NAME.test(name)) {
      warnings.push(
        `route ${JSON.stringify(name)}: not a name the catalog takes, so it was left out`,
      );
      continue;
    }

    // Kong marks a regular expression with `~` and anchors it at the start.
    const patterns = (entry.paths ?? []).filter((p) => p.startsWith('~')).map((p) => p.slice(1));
    const paths = entry.paths ? entry.paths.filter((p) => !p.startsWith('~')) : ['/'];

    const methods = entry.methods?.map((m) => m.toUpperCase()).filter(isMethod);

    // Kong runs the most specific instance of each plugin: the route's, then the
    // service's, then the global one. A more specific instance that is disabled,
    // or lets anonymous requests through, is what the route gets.
    const levels = [
      [
        ...scoped(entry.plugins),
        ...scoped(config.plugins).filter((p) => p.route !== undefined && p.route === entry.name),
      ],
      [
        ...scoped(owner.plugins),
        ...scoped(config.plugins).filter((p) => !p.route && p.service === owner.name),
      ],
      global,
    ];

    const auth = [...AUTHENTICATION].filter((name) => {
      const instance = levels.map((level) => level.find((p) => p.name === name)).find(Boolean);

      return instance !== undefined && authenticates(instance);
    });

    const upstreamPath = upstreamPathOf(owner);

    out.push({
      name,
      service: options.services?.[owner.name] ?? owner.name,
      ...(paths.length > 0 && { paths }),
      ...(patterns.length > 0 && { patterns }),
      ...(methods?.length && { methods }),
      stripPath: entry.strip_path,
      ...(upstreamPath && { upstreamPath }),
      auth,
    });
  }

  return { file: { gateway: options.gateway ?? 'kong', routes: out }, warnings };
}

/** A file as given, or every YAML file below a folder, in path order. */
async function configFiles(given: string): Promise<string[]> {
  if (!(await fs.stat(given)).isDirectory()) return [given];

  const entries = await fs.readdir(given, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

export async function runFromKong(opts: {
  config: string[];
  root: string;
  gateway?: string;
  service?: string[];
  check?: boolean;
  /** Another configuration of the same gateway that must let through the same routes. */
  sameAs?: string[];
}): Promise<number> {
  const services = Object.fromEntries(
    (opts.service ?? []).flatMap((pair) => {
      const [kong, catalog] = pair.split('=');

      return kong && catalog ? [[kong, catalog]] : [];
    }),
  );

  const readConfig = async (given: string[]): Promise<KongRead | undefined> => {
    try {
      const files = (await Promise.all(given.map(configFiles))).flat();

      const result = readKong(await Promise.all(files.map((file) => fs.readFile(file, 'utf8'))), {
        ...(opts.gateway && { gateway: opts.gateway }),
        services,
      });

      for (const warning of result.warnings) console.warn(kleur.yellow(`! ${warning}`));

      return result;
    } catch (error) {
      console.error(
        kleur.red(
          `✗ ${given.join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );

      return undefined;
    }
  };

  const read = await readConfig(opts.config);

  if (!read) return 1;

  // Two configurations of one gateway, such as Compose and Kubernetes: compared, nothing written.
  if (opts.sameAs) {
    const other = await readConfig(opts.sameAs);

    if (!other) return 1;

    const differences = compareGateways(read.file, other.file, [
      opts.config.join(', '),
      opts.sameAs.join(', '),
    ]);

    for (const difference of differences) console.error(kleur.red(`✗ ${difference}`));

    if (differences.length > 0) return 1;

    console.log(
      `✓ both let through the same ${read.file.routes.length > 0 ? 'routes' : 'nothing'}`,
    );

    return 0;
  }

  const root = path.resolve(opts.root);

  const source = opts.config
    .map((file) => path.relative(root, path.resolve(file)).split(path.sep).join('/'))
    .join(', ');

  const result = await writeGatewayFile(root, { ...read.file, source }, { check: opts.check });

  if (result === 'stale') {
    console.error(
      kleur.red('✗ autocatalog.gateway.json does not match the configuration: run ac from-kong'),
    );

    return 1;
  }

  console.log(
    `${result === 'current' ? '✓ autocatalog.gateway.json is current' : '✓ wrote autocatalog.gateway.json'}: ${read.file.routes.length} routes`,
  );

  return 0;
}
