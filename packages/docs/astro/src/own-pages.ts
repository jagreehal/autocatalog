import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** What Astro routes from a file: pages, Markdown, and endpoints such as `status.json.ts`. */
const ROUTED = /\.(astro|md|mdx|ts|js)$/;

/** Astro routes an injected file as a page only if it is `.astro`, so Markdown renders through one. */
const MARKDOWN = /\.mdx?$/;

const MARKDOWN_MODULE = 'virtual:autocatalog-docs-own-markdown';

/**
 * A site's own pages and API routes, from a folder laid out as `src/pages/`
 * is: `team.astro` at `/team/`, `api/status.json.ts` at `/api/status.json`.
 * One at an address the catalog publishes replaces the catalog's page.
 */
export function ownPageRoutes(dir: string): Array<[string, string]> {
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--pages ${dir}: not a folder`);
  }

  const routes: Array<[string, string]> = [];

  for (const entry of fs.globSync('**/*', { cwd: dir }).sort()) {
    const file = entry.split(path.sep).join('/');

    if (!ROUTED.test(file) || file.split('/').some((part) => part.startsWith('_'))) continue;

    routes.push([
      `/${file.replace(ROUTED, '').replace(/(^|\/)index$/, '')}`,
      path.join(dir, entry),
    ]);
  }

  return routes;
}

/** The entrypoint each route injects: its own file, or the page that renders Markdown. */
export function ownPageEntrypoint(file: string, markdownPage: string): string {
  return MARKDOWN.test(file) ? markdownPage : file;
}

/**
 * Resolve what a page in that folder imports as the site does: the folder has
 * no node_modules of its own, so `autocatalog-docs-astro` or
 * `@astrojs/starlight` come from the site's. Serves the page that renders
 * Markdown its files, by route.
 */
export function ownPageImports(
  dir: string,
  projectRoot: string,
  routes: Array<[string, string]>,
): Plugin {
  const inside = (file: string) => !path.relative(dir, file).startsWith('..');

  return {
    name: 'autocatalog-docs-own-pages',
    enforce: 'pre',
    load(id) {
      if (id !== `\0${MARKDOWN_MODULE}`) return null;

      const entries = routes.flatMap(([pattern, file]) =>
        MARKDOWN.test(file)
          ? [`${JSON.stringify(pattern)}: () => import(${JSON.stringify(file)})`]
          : [],
      );

      return `export default {${entries.join(',')}};`;
    },
    async resolveId(source, importer) {
      if (source === MARKDOWN_MODULE) return `\0${MARKDOWN_MODULE}`;

      if (!importer || !inside(importer.split('?')[0]!) || /^[./\0]|^[a-z]+:/.test(source)) {
        return null;
      }

      return this.resolve(source, path.join(projectRoot, 'package.json'), { skipSelf: true });
    },
  };
}
