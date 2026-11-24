import fs from 'node:fs';
import { createRequire, isBuiltin, registerHooks } from 'node:module';
import type { ResolveFnOutput, ResolveHookContext } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Loaded with `--import` by the build and by a server site's `server.mjs`. The
 * site's code is built inside autocatalog and runs from --out, so a package
 * either side installed can be missing from where it runs. A bare import Node
 * cannot find is tried again from each folder in AUTOCATALOG_RESOLVE_FROM, in order.
 *
 * A package that one of those folders names comes from there, then from the
 * site's own project, AUTOCATALOG_RESOLVE_SITE, when its package.json names it. A
 * version either side only has hoisted, from some other tool, comes last: it is
 * not the one the code was written against.
 */
const parent = (dir: string) => pathToFileURL(path.join(dir, 'noop.js')).href;

const from = (process.env.AUTOCATALOG_RESOLVE_FROM ?? '')
  .split(path.delimiter)
  .filter(Boolean)
  .map(parent);

const site = process.env.AUTOCATALOG_RESOLVE_SITE;

/** What an installed package has beside it: its devDependencies are not installed. */
const INSTALLED = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/** The packages a folder's package.json names: the site's own, in any of its dependency lists. */
export function declaredPackages(
  project: string,
  fields = [...INSTALLED, 'devDependencies'],
): Set<string> {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));

    return new Set(fields.flatMap((field) => Object.keys(manifest[field] ?? {})));
  } catch {
    return new Set();
  }
}

/** `@scope/name/sub` and `name/sub` name the packages `@scope/name` and `name`. */
export const packageName = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

const known = new Map<string, Set<string>>();

/** {@link declaredPackages}, read once per folder. */
function packagesIn(folder: string, fields?: Array<string>): Set<string> {
  const names = known.get(folder) ?? declaredPackages(path.dirname(fileURLToPath(folder)), fields);

  known.set(folder, names);

  return names;
}

/**
 * The folders whose package.json names a package. Only from one of those is it
 * certain to be the version that code wants: from another, a hoisted copy such
 * as Express's `cookie` can answer for the one Astro's output imports.
 */
export function declaringFolders(specifier: string, folders = from): Array<string> {
  return folders.filter((folder) => packagesIn(folder, INSTALLED).has(packageName(specifier)));
}

/**
 * Where to look for a bare import, best first: where a package names it, then
 * the project if it does, then anywhere.
 */
export function resolveOrder(specifier: string, all = from, project = site): Array<string> {
  const declaring = declaringFolders(specifier, all);
  const rest = all.filter((folder) => !declaring.includes(folder));

  if (!project) {
    return [...declaring, ...rest];
  }

  const own = parent(project);

  return packagesIn(own).has(packageName(specifier))
    ? [...declaring, own, ...rest]
    : [...declaring, ...rest, own];
}

// createRequire().resolve passes through these hooks too; inside it, the default runs.
let resolving = false;

/** What an import resolves to from a folder. require() resolves from its parent module and ignores parentURL. */
const resolveFrom = (
  specifier: string,
  parentURL: string,
  [context, next]: [ResolveHookContext, NextResolve],
): ResolveFnOutput => {
  // Node's own modules are not files to look for.
  if (isBuiltin(specifier) || !context.conditions.includes('require')) {
    return next(specifier, { ...context, parentURL });
  }

  resolving = true;

  try {
    const url = pathToFileURL(createRequire(parentURL).resolve(specifier)).href;

    return { url, shortCircuit: true };
  } finally {
    resolving = false;
  }
};

type NextResolve = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput;

// A package name, not a path, URL or one of Node's own modules.
const bare = (specifier: string) => !/^[./]|^[a-z]+:/i.test(specifier) && !isBuiltin(specifier);

/**
 * The built site, AUTOCATALOG_RESOLVE_OUT: `--out`, or the run's folder while it is
 * being built. Its chunks hold autocatalog's code, so their imports take
 * resolveOrder() before Node's own lookup, which walks up to whatever the
 * project, or pnpm's hoisted folder, has at the top.
 */
const out = process.env.AUTOCATALOG_RESOLVE_OUT
  ? pathToFileURL(path.join(process.env.AUTOCATALOG_RESOLVE_OUT, path.sep)).href
  : undefined;

/** Whether an import from `parentURL` is the built site's, resolved by resolveOrder() first. */
export const fromBuiltSite = (parentURL: string | undefined, built = out) =>
  built !== undefined && parentURL?.startsWith(built) === true;

/** How the build marks what a site's own code, or an extension it installs, imports. */
const FROM_SITE = /^autocatalog-site:([^?]+)\?from=(.*)$/;

/** The package a marked import names, and the folder under the project it is looked up from. */
export function fromSite(specifier: string): { name: string; folder: string } | undefined {
  const [, name, folder] = FROM_SITE.exec(specifier) ?? [];

  return name === undefined || folder === undefined
    ? undefined
    : { name, folder: decodeURIComponent(folder) };
}

if (site !== undefined && site !== '') {
  const root = fs.existsSync(site) ? fs.realpathSync(site) : site;

  registerHooks({
    resolve: (specifier, context, next) => {
      const marked = fromSite(specifier);

      return marked === undefined
        ? next(specifier, context)
        : resolveFrom(marked.name, parent(path.resolve(root, marked.folder)), [context, next]);
    },
  });
}

if (from.length > 0 || site) {
  registerHooks({
    resolve: (specifier, context, next) => {
      if (resolving) {
        return next(specifier, context);
      }

      const fromFolders = () => {
        for (const parentURL of resolveOrder(specifier)) {
          try {
            return resolveFrom(specifier, parentURL, [context, next]);
          } catch {
            // the next folder
          }
        }

        return undefined;
      };

      if (bare(specifier) && fromBuiltSite(context.parentURL)) {
        const found = fromFolders();

        if (found) {
          return found;
        }
      }

      try {
        return next(specifier, context);
      } catch (error) {
        // ESM and require() say it differently.
        const code = error instanceof Error && 'code' in error ? error.code : undefined;

        if (!bare(specifier) || (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND')) {
          throw error;
        }

        const found = fromFolders();

        if (found) {
          return found;
        }

        throw error;
      }
    },
  });
}
