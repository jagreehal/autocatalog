import fs from 'node:fs';
import { createRequire, isBuiltin, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Loaded with `--import` by the build and by a server site's `server.mjs`. The
 * site's code is built inside autocatalog and runs from --out, so a package
 * either side installed can be missing from where it runs. A bare import Node
 * cannot find is tried again from each folder in AUTOCATALOG_RESOLVE_FROM, in order.
 *
 * The site's own project, AUTOCATALOG_RESOLVE_SITE, answers first only for the
 * packages its package.json names. Anything else autocatalog's code imports
 * comes from autocatalog's tree first: a version the project only has hoisted,
 * from some other tool, is not the one that code was written against.
 */
const parent = (dir: string) => pathToFileURL(path.join(dir, 'noop.js')).href;

const from = (process.env.AUTOCATALOG_RESOLVE_FROM ?? '')
  .split(path.delimiter)
  .filter(Boolean)
  .map(parent);

const site = process.env.AUTOCATALOG_RESOLVE_SITE;

/** The packages the site's package.json names, in any of its dependency lists. */
export function declaredPackages(project: string): Set<string> {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));

    return new Set(
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
        (field) => Object.keys(manifest[field] ?? {}),
      ),
    );
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

const declared = new Map<string, Set<string>>();

/** Where to look for a bare import, best first. */
export function resolveOrder(specifier: string, folders = from, project = site): string[] {
  if (!project) return folders;

  if (!declared.has(project)) declared.set(project, declaredPackages(project));

  return declared.get(project)!.has(packageName(specifier))
    ? [parent(project), ...folders]
    : [...folders, parent(project)];
}

// createRequire().resolve passes through this hook too; inside it, the default runs.
let resolving = false;

// A package name, not a path, URL or one of Node's own modules.
const bare = (specifier: string) => !/^[./]|^[a-z]+:/i.test(specifier) && !isBuiltin(specifier);

/**
 * The built site, AUTOCATALOG_RESOLVE_OUT. Its chunks hold autocatalog's code, so
 * their imports take resolveOrder() before Node's own lookup: built into a `dist/`
 * inside the project, that lookup walks up to the project's node_modules first.
 */
const out = process.env.AUTOCATALOG_RESOLVE_OUT
  ? pathToFileURL(path.join(process.env.AUTOCATALOG_RESOLVE_OUT, path.sep)).href
  : undefined;

/** Whether an import from `parentURL` is the built site's, resolved by resolveOrder() first. */
export const fromBuiltSite = (parentURL: string | undefined, built = out) =>
  built !== undefined && parentURL?.startsWith(built) === true;

if (from.length > 0 || site)
  registerHooks({
    resolve: (specifier, context, next) => {
      if (resolving) return next(specifier, context);

      // require() resolves from its parent module and ignores parentURL.
      const cjs = context.conditions?.includes('require');

      const fromFolders = () => {
        for (const parentURL of resolveOrder(specifier)) {
          try {
            if (cjs) {
              resolving = true;

              try {
                const url = pathToFileURL(createRequire(parentURL).resolve(specifier)).href;

                return { url, shortCircuit: true };
              } finally {
                resolving = false;
              }
            }

            return next(specifier, { ...context, parentURL });
          } catch {
            // the next folder
          }
        }

        return undefined;
      };

      if (bare(specifier) && fromBuiltSite(context.parentURL)) {
        const found = fromFolders();

        if (found) return found;
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

        if (found) return found;

        throw error;
      }
    },
  });
