import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Loaded with `--import` by the build and by a server site's `server.mjs`. The
 * site's code is built inside autocatalog and runs from --out, so a package
 * either side installed can be missing from where it runs. A bare import Node
 * cannot find is tried again from each folder in AUTOCATALOG_RESOLVE_FROM, in order.
 */
const from = (process.env.AUTOCATALOG_RESOLVE_FROM ?? '')
  .split(path.delimiter)
  .filter(Boolean)
  .map((dir) => pathToFileURL(path.join(dir, 'noop.js')).href);

// createRequire().resolve passes through this hook too; inside it, the default runs.
let resolving = false;

const bare = (specifier: string) => !/^[./]|^[a-z]+:/i.test(specifier);

if (from.length > 0)
  registerHooks({
    resolve: (specifier, context, next) => {
      if (resolving) return next(specifier, context);

      try {
        return next(specifier, context);
      } catch (error) {
        // ESM and require() say it differently.
        const code = error instanceof Error && 'code' in error ? error.code : undefined;

        if (!bare(specifier) || (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND')) {
          throw error;
        }

        // require() resolves from its parent module and ignores parentURL.
        const cjs = context.conditions?.includes('require');

        for (const parentURL of from) {
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

        throw error;
      }
    },
  });
