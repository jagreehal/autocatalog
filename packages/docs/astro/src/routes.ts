import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { DOCS_MANIFEST_PATH } from 'autocatalog-docs-core';
import { z } from 'zod';
import { DESIGN_CHANGED } from './ui/lib/canvas-model';
import { markDesignsChanged, savedBy } from './dev-signals';
import { eventCatalogEmbeds } from './eventcatalog';
import { brokenLinks, formatBrokenLinks } from './link-check';
import { docPaths } from './paths';
import { ownPageEntrypoint, ownPageImports, ownPageRoutes } from './own-pages';

const fullReload = z.object({ type: z.literal('full-reload') });

// A design file in a repository: `<repository>/designs/<id>.md`.
const DESIGN_FILE = /[\\/]designs[\\/][^\\/]+\.md$/;

const here = path.dirname(fileURLToPath(import.meta.url));

/** The routes a site for an audience outside the company keeps. */
const OUTSIDE_ROUTES = new Set([
  '/',
  '/llms.txt',
  '/llms-full.txt',
  '/apis',
  '/apis/[repository]/[name]',
  '/apis/[repository]/[name]/openapi.json',
  '/[kind]',
  '/[...slug].md',
]);

/** The files that list or copy every document for agents: per request on a server site. */
const DOCUMENT_LISTS = new Set(['llms.txt.ts', 'llms-full.txt.ts']);

/** The catalog's pages that list or copy documents, rendered per reader on a site with `access`. */
const PER_READER_PAGES = new Set(['index.astro', 'kind.astro', 'llms.txt.ts', 'llms-full.txt.ts']);

const PRERENDER_EXPORT = /export\s+const\s+prerender\b/;

const read = (file: string) => fs.readFileSync(file, 'utf8');

/**
 * The routes Starlight does not publish.
 *
 * Added as an integration by the plugin rather than asked of the user: a raw
 * markdown twin that exists only when someone remembers to wire it is not a
 * promise agents can rely on.
 */
export function autocatalogDocsRoutes(
  root: string,
  ownPages?: string,
  audience?: string,
  /**
   * On a site with `access`, the kind pages' paths: each reader's lists are
   * their own, so these and the home page render per request.
   */
  perReaderKinds?: string[],
  /** A repository published at the root has `docs/index.md`, which is the home page. */
  docsHome = false,
): AstroIntegration {
  let base = '/';
  let output = 'static';
  let perRequest: string[] = [];
  let projectRoot: string | undefined;

  return {
    name: 'autocatalog-docs-routes',
    hooks: {
      'astro:config:setup': ({ command, config, injectRoute, updateConfig }) => {
        projectRoot = fileURLToPath(config.root);
        // Read here as well as at config:done: routes are set up before that runs.
        output = config.output;
        updateConfig({
          vite: {
            // The documents usually live above this project, and Vite's dev
            // server refuses to serve outside its inferred workspace root.
            server: {
              fs: { allow: [root, fileURLToPath(config.root), ...(ownPages ? [ownPages] : [])] },
            },
          },
        });

        // A project with its own `src/pages/index.*` keeps it: injecting ours
        // as well is a route collision, and Astro makes that a hard error.
        const srcPages = path.join(fileURLToPath(config.srcDir), 'pages');

        const hasOwnHome =
          docsHome ||
          (fs.existsSync(srcPages) &&
            fs.readdirSync(srcPages).some((entry) => /^index\.(astro|md|mdx|html)$/.test(entry)));

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
          ['/llms-full.txt', path.join(here, 'pages/llms-full.txt.ts')],
          [`/${DOCS_MANIFEST_PATH}`, path.join(here, 'pages/docs-manifest.json.ts')],
          ['/events/[repository]/[domain]/[id]', path.join(here, 'pages/event.astro')],
          ['/events/[repository]/[domain]/[id].md', path.join(here, 'pages/event.md.ts')],
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
          ['/services/[name].md', path.join(here, 'pages/service.md.ts')],
          ['/fields', path.join(here, 'pages/fields.astro')],
          ['/schemas', path.join(here, 'pages/schemas.astro')],
          ['/retirements', path.join(here, 'pages/retirements.astro')],
          ['/apis', path.join(here, 'pages/apis.astro')],
          ['/apis/[repository]/[name]', path.join(here, 'pages/api.astro')],
          ['/apis/[repository]/[name]/openapi.json', path.join(here, 'pages/api-spec.json.ts')],
          ['/flows', path.join(here, 'pages/flows.astro')],
          ['/flows/[repository]/[id]', path.join(here, 'pages/flow.astro')],
          ['/designs', path.join(here, 'pages/designs.astro')],
          ['/designs/[repository]/[id]', path.join(here, 'pages/design.astro')],
          ['/glossary', path.join(here, 'pages/glossary.astro')],
          ['/entities', path.join(here, 'pages/entities.astro')],
          ['/entities/[repository]/[id]', path.join(here, 'pages/entity.astro')],
          ['/data-products', path.join(here, 'pages/data-products.astro')],
          ['/data-products/[repository]/[id]', path.join(here, 'pages/data-product.astro')],
          ['/specs', path.join(here, 'pages/specs.astro')],
          ['/specs/[repository]/[name]', path.join(here, 'pages/spec.astro')],
          ['/specs/[repository]/[name]/[file]', path.join(here, 'pages/spec-file.ts')],
          ['/owners', path.join(here, 'pages/owners.astro')],
          ['/owners/[owner]', path.join(here, 'pages/owner.astro')],
          ['/domains', path.join(here, 'pages/domains.astro')],
          ['/domains/[domain]', path.join(here, 'pages/domain.astro')],
          ['/channels', path.join(here, 'pages/channels.astro')],
          ['/channels/[...id]', path.join(here, 'pages/channel.astro')],
          ['/components', path.join(here, 'pages/components.astro')],
          ['/components/[repository]/[id]', path.join(here, 'pages/component.astro')],
          ['/components/[repository]/[id].md', path.join(here, 'pages/component.md.ts')],
          ['/mcp-servers', path.join(here, 'pages/mcp-servers.astro')],
          ['/mcp-servers/[id]', path.join(here, 'pages/mcp-server.astro')],
          ['/systems', path.join(here, 'pages/systems.astro')],
          ['/systems/[id]', path.join(here, 'pages/system.astro')],
          ['/data', path.join(here, 'pages/data.astro')],
          ['/data/[repository]/[name]', path.join(here, 'pages/data-model.astro')],
          ['/data/[repository]/[name].md', path.join(here, 'pages/data-model.md.ts')],
          // Each document kind's index, at the path its conventions give it.
          // Below every static page, and kind paths are checked against them.
          ['/[kind]', path.join(here, 'pages/kind.astro')],
          // Registered before Starlight's catch-all resolves a `.md` request,
          // so the twin wins over a page whose slug happens to end in `.md`.
          [
            '/[...slug].md',
            // Documents rendered per request may be gated, by `access` or by the
            // site's own middleware, so their twins render per request too and
            // pass the same gate. Built ahead, a twin would skip it.
            path.join(
              here,
              config.output === 'server' ? 'pages/doc-twin.ts' : 'pages/[...slug].md.ts',
            ),
          ],
        ];

        // A site for readers outside has their guides and the API references.
        // Every other page is about the company's own systems.
        if (audience) {
          const kept = pages.filter(([pattern]) => OUTSIDE_ROUTES.has(pattern));

          pages.splice(0, pages.length, ...kept);
        }

        // `ac site` dev edits a design on a canvas and saves its file; a built
        // site is read only, so these are never part of one.
        else if (command === 'dev') {
          pages.push(
            ['/designs/[repository]/[id]/edit', path.join(here, 'pages/design-edit.astro')],
            ['/designs/[repository]/[id]/edit.json', path.join(here, 'pages/design-edit.json.ts')],
            ['/designs/new.json', path.join(here, 'pages/design-new.json.ts')],
          );
        }

        // A route per kind, as `[kind]` can only be prerendered: per request it
        // would answer for a document at a single segment.
        if (perReaderKinds) {
          const kind = pages.findIndex(([pattern]) => pattern === '/[kind]');

          if (kind >= 0) {
            pages.splice(
              kind,
              1,
              ...perReaderKinds.map((kindPath): [string, string] => [
                `/${kindPath}`,
                path.join(here, 'pages/kind.astro'),
              ]),
            );
          }
        }

        // Only when `ac site --eventcatalog` built the diagrams it shows.
        if (eventCatalogEmbeds() && !audience) {
          pages.push(['/architecture', path.join(here, 'pages/architecture.astro')]);
        }

        // The site's own pages and API routes. One at the address of a catalog
        // page replaces it, the home page included.
        if (ownPages) {
          const routes = ownPageRoutes(ownPages);
          const own = new Set(routes.map(([pattern]) => pattern));
          const markdownPage = path.join(here, 'pages/own-markdown.astro');

          pages.splice(
            0,
            pages.length,
            ...pages.filter(([pattern]) => !own.has(pattern)),
            ...routes.map(([pattern, file]): [string, string] => [
              pattern,
              ownPageEntrypoint(file, markdownPage),
            ]),
          );
          updateConfig({
            vite: { plugins: [ownPageImports(ownPages, fileURLToPath(config.root), routes)] },
          });
        }

        for (const [pattern, entrypoint] of pages) {
          injectRoute({ pattern, entrypoint });
        }
      },
      // The catalog is built once, so its pages are prerendered even when the
      // site renders documents per request. A page exporting `prerender` keeps it.
      'astro:route:setup': ({ route }) => {
        if (!projectRoot) return;

        const file = path.resolve(projectRoot, route.component);

        if (!file.startsWith(path.join(here, 'pages')) || PRERENDER_EXPORT.test(read(file))) return;

        const name = path.basename(file);

        // With `access`, every page that lists or copies documents is the reader's own.
        // On any server site, the copies of them are rendered per request, behind its gate.
        route.prerender = !(
          (perReaderKinds && PER_READER_PAGES.has(name)) ||
          (output === 'server' && DOCUMENT_LISTS.has(name))
        );
      },
      // The dev server reloads every page when a file under the catalog changes.
      // A design changing is told to the pages instead (`autocatalog:design-changed`):
      // the editor takes the file onto its canvas without losing its undo history,
      // the design's page reloads, and the editor's own save changes nothing on screen.
      'astro:server:setup': ({ server }) => {
        let designChangedAt = 0;

        const settling = new Map<string, ReturnType<typeof setTimeout>>();

        // Told once the file has settled: a writer that empties it first fires a change mid-write.
        const onDesign = (file: string) => {
          if (!DESIGN_FILE.test(file)) return;

          designChangedAt = Date.now();
          markDesignsChanged();
          clearTimeout(settling.get(file));

          settling.set(
            file,
            setTimeout(() => {
              settling.delete(file);
              markDesignsChanged();

              // Every page on the file is told; the tab whose save it is already shows it.
              const by = savedBy(file);

              server.hot.send({
                type: 'custom',
                event: DESIGN_CHANGED,
                data: { file, ...(by && { by }) },
              });
            }, 150),
          );
        };

        server.watcher.on('change', onDesign);
        server.watcher.on('add', onDesign);
        server.watcher.on('unlink', onDesign);

        // Vite's reload names no file, so a reload within 1.5s of a design change is skipped;
        // the pages on that design follow it through the event above.
        for (const channel of new Set([server.ws, server.hot, server.environments.client.hot])) {
          const send = channel.send.bind(channel);

          // SAFETY: the same function, passing every call it does not skip to the original.
          channel.send = ((...args: Parameters<typeof send>) => {
            if (fullReload.safeParse(args[0]).success && Date.now() - designChangedAt < 1500)
              return;

            send(...args);
          }) as typeof channel.send;
        }
      },
      'astro:config:done': ({ config }) => {
        base = config.base;
        output = config.output;
      },
      // A page or endpoint that renders per request, such as a site's own home
      // or llms.txt behind `access`, has no file.
      'astro:routes:resolved': ({ routes }) => {
        perRequest = routes
          .filter((route) => !route.isPrerendered && !route.params.length)
          .map((route) => route.pattern.replace(/\/?$/, '/'));
      },
      // A link to a renamed document or an event that left the catalog is
      // reported once the whole site exists. A warning by default, because one
      // team's stale link should not stop every other team's index publishing;
      // AUTOCATALOG_DOCS_LINKS=error makes it fail the build.
      'astro:build:done': async ({ dir, logger }) => {
        // A server site renders documents per request, so no file holds them.
        const served = new Set([
          ...perRequest,
          ...(output === 'server' ? docPaths().map(({ params }) => `/${params.slug}/`) : []),
        ]);

        const broken = await brokenLinks(fileURLToPath(dir), base, served);

        if (broken.length === 0) return;

        if (process.env.AUTOCATALOG_DOCS_LINKS === 'error') {
          throw new Error(formatBrokenLinks(broken));
        }

        logger.warn(formatBrokenLinks(broken));
      },
    },
  };
}
