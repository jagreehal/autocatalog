import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

const require = createRequire(import.meta.url);

// Every page this plugin routes is a React component under ui/pages, so React
// has to run wherever the site does, dev server included.
const ui = fileURLToPath(new URL('./ui', import.meta.url));

/**
 * Lets the site render this plugin's React pages without installing React
 * itself. Astro imports an integration's renderer from the site's root, where
 * a site that never installed React (or whose package manager does not hoist
 * it, as pnpm does not) cannot find the one this plugin brings; the alias points
 * it at that copy, and the dev server is allowed to serve it and the pages.
 */
export function reactRendererIntegration(): AstroIntegration {
  return {
    name: 'autocatalog-docs-react-renderer',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        const renderer = ['server.js', 'client.js'].map((entry) => ({
          find: `@astrojs/react/${entry}`,
          replacement: require.resolve(`@astrojs/react/${entry}`),
        }));

        updateConfig({
          vite: {
            resolve: { alias: renderer },
            server: {
              fs: { allow: [ui, ...renderer.map((entry) => nodeModulesOf(entry.replacement))] },
            },
          },
        });
      },
    },
  };
}

/** The node_modules directory a resolved file sits in, store and all. */
function nodeModulesOf(file: string): string {
  const at = file.indexOf(`${path.sep}node_modules${path.sep}`);

  return at === -1 ? path.dirname(file) : file.slice(0, at + '/node_modules'.length);
}

/**
 * Whether the site can resolve React from its own root. A build bundles React
 * from this package, so it never needs to. The dev server instead hands React
 * to Node from the site's root, so a site whose package manager does not hoist
 * it (pnpm) has to list react and react-dom itself.
 */
export function siteHasReact(projectRoot: string): boolean {
  return ['react', 'react-dom'].every((name) => installed(projectRoot, name));
}

// Looked up the way Vite does, directory by directory, rather than through
// require: a pnpm script's NODE_PATH lets require find what Vite will not.
function installed(from: string, name: string): boolean {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', name, 'package.json'))) return true;

    if (path.dirname(dir) === dir) return false;
  }
}
