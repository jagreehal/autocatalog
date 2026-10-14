import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Loaded with `--import` into the process that builds the site. The site
 * renders with the React that autocatalog-docs-astro installs. A project with
 * another React at the top of a flat node_modules would otherwise lend that
 * copy to the libraries hoisted beside it, and two Reacts cannot share hooks.
 */
const from = process.env.AUTOCATALOG_REACT_FROM;

const ownReact = /^react(-dom)?(\/|$)/;

// Resolved as `require` would from the docs package, for `import` and `require` alike.
const resolveOwn = from ? createRequire(from).resolve : undefined;

// resolveOwn passes through this hook too; inside it, the default resolver runs.
let resolving = false;

if (resolveOwn)
  registerHooks({
    resolve: (specifier, context, next) => {
      if (resolving || !ownReact.test(specifier)) return next(specifier, context);
      resolving = true;

      try {
        return { url: pathToFileURL(resolveOwn(specifier)).href, shortCircuit: true };
      } finally {
        resolving = false;
      }
    },
  });
