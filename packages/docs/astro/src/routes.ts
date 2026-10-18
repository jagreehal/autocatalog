import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { DOCS_MANIFEST_PATH } from 'autocatalog-docs-core';
import { eventCatalogEmbeds } from './eventcatalog';
import { brokenLinks, formatBrokenLinks } from './link-check';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The routes Starlight does not publish.
 *
 * Added as an integration by the plugin rather than asked of the user: a raw
 * markdown twin that exists only when someone remembers to wire it is not a
 * promise agents can rely on.
 */
export function autocatalogDocsRoutes(root: string): AstroIntegration {
  let base = '/';

  return {
    name: 'autocatalog-docs-routes',
    hooks: {
      'astro:config:setup': ({ config, injectRoute, updateConfig }) => {
        updateConfig({
          vite: {
            // The documents usually live above this project, and Vite's dev
            // server refuses to serve outside its inferred workspace root.
            server: { fs: { allow: [root, fileURLToPath(config.root)] } },
          },
        });

        // A site that wrote its own front door keeps it: injecting ours as
        // well is a route collision, and Astro will make that a hard error.
        const ownPages = path.join(fileURLToPath(config.srcDir), 'pages');

        const hasOwnHome =
          fs.existsSync(ownPages) &&
          fs.readdirSync(ownPages).some((entry) => /^index\.(astro|md|mdx|html)$/.test(entry));

        // Starlight has no page at / until some repository publishes
        // docs/index.md, which no single team should have to own.
        const home: Array<[string, string]> = hasOwnHome
          ? []
          : [['/', path.join(here, 'pages/index.astro')]];

        const pages: Array<[string, string]> = [
          ...home,
          ['/catalog', path.join(here, 'pages/catalog.astro')],
          ['/catalog.json', path.join(here, 'pages/catalog.json.ts')],
          ['/llms.txt', path.join(here, 'pages/llms.txt.ts')],
          [`/${DOCS_MANIFEST_PATH}`, path.join(here, 'pages/docs-manifest.json.ts')],
          ['/events/[repository]/[domain]/[id]', path.join(here, 'pages/event.astro')],
          [
            '/events/[repository]/[domain]/[id]/schema.json',
            path.join(here, 'pages/event-schema.json.ts'),
          ],
          [
            '/events/[repository]/[domain]/[id]/v/[version]',
            path.join(here, 'pages/event-version.astro'),
          ],
          [
            '/events/[repository]/[domain]/[id]/v/[version]/schema.json',
            path.join(here, 'pages/event-version-schema.json.ts'),
          ],
          ['/services/[name]', path.join(here, 'pages/service.astro')],
          ['/fields', path.join(here, 'pages/fields.astro')],
          ['/owners', path.join(here, 'pages/owners.astro')],
          ['/owners/[owner]', path.join(here, 'pages/owner.astro')],
          // Registered before Starlight's catch-all resolves a `.md` request,
          // so the twin wins over a page whose slug happens to end in `.md`.
          ['/[...slug].md', path.join(here, 'pages/[...slug].md.ts')],
        ];

        // Only when `ac site --eventcatalog` built the diagrams it shows.
        if (eventCatalogEmbeds()) {
          pages.push(['/architecture', path.join(here, 'pages/architecture.astro')]);
        }

        for (const [pattern, entrypoint] of pages) {
          injectRoute({ pattern, entrypoint });
        }
      },
      'astro:config:done': ({ config }) => {
        base = config.base;
      },
      // A link to a renamed document or an event that left the catalog is
      // reported once the whole site exists. A warning by default, because one
      // team's stale link should not stop every other team's index publishing;
      // AUTOCATALOG_DOCS_LINKS=error makes it fail the build.
      'astro:build:done': async ({ dir, logger }) => {
        const broken = await brokenLinks(fileURLToPath(dir), base);

        if (broken.length === 0) return;

        if (process.env.AUTOCATALOG_DOCS_LINKS === 'error') {
          throw new Error(formatBrokenLinks(broken));
        }

        logger.warn(formatBrokenLinks(broken));
      },
    },
  };
}
