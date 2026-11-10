import { createRequire } from 'node:module';
import { stringify } from 'devalue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import type { StarlightPlugin } from '@astrojs/starlight/types';
import { z } from 'astro/zod';
import {
  type Doc,
  HOME_BLOCKS,
  INSIDE_ONLY_BLOCKS,
  type SiteConfig,
  resolveDocsLayout,
  siteNavLinkSchema,
  type SiteAccessConfig,
  type SiteNavigationInput,
  type SiteNavLink,
  type SITE_THEMES,
} from 'autocatalog-docs-core';
import type { PluginOption } from 'vite';
import { type DocsSiteConfig, docsSiteConfig, servesMcp as siteServesMcp } from './config';
import { ownPageRoutes } from './own-pages';
import { autocatalogDocsRoutes } from './routes';

export { rehypeDocsBase } from './links';

export {
  loadSiteExtensions,
  mergeSiteExtensions,
  type SiteExtension,
  type SiteExtensions,
} from './extensions';

/** The catalog every page is built from, for a site's own pages and API routes. */
export { docsCatalog, type DocsCatalog } from './catalog';

/** What a site's assistant module default-exports; see `chat` in autocatalog.site.json. */
export type { SiteChatOptions, SiteChatRequest } from './chat';

/** What a site's access module default-exports; see `access` in autocatalog.site.json. */
export { type AccessDoc, type AccessReader, defaultCanRead, type SiteAccess } from './access';

export { loadSiteAccess } from './access-report';

export { ownPageRoutes } from './own-pages';

import { accessTable, closedLinks, formatAccessTable } from './access-report';
import type { SiteAccess } from './access';
import { buildSiteCatalog } from './catalog';
import type { ChatPage } from 'autocatalog-chatbot';
import type { ChatPanelProps } from 'autocatalog-chatbot/react';
import { chatIcons, chatPages, chatText } from './chat';
import { audienceReader } from './audience';
import { graphOwners } from './owners';
import { retirementsPageProps } from './retirements';
import { buildChannels } from './channels';
import { catalogSystemRows } from './systems';
import { catalogSidebar, docsSidebar, navigationGroups } from './sidebar';
import { domainSidebar } from './domain-sidebar';
import { buildDomains } from './domains';
import { eventCatalogEmbeds } from './eventcatalog';
import { reactRendererIntegration, siteHasReact } from './react-integration';
import { EMBED_SCRIPT } from './embed';
import { SIDEBAR_SCRIPT } from './sidebar-state';
import { SECTION_TRANSITION_SCRIPT } from './section-transition';
import { DARK_CLASS_SCRIPT } from './dark-class';
import { registerMarkdownPlugins } from './markdown-plugins';
import { MERMAID_SCRIPT } from './mermaid';
import { mdxComponents } from './mdx';
import { DEFAULT_FAVICON } from './favicon';
import { apiPath, catalogServices } from './apis';
import { isIcon } from './icons';
import { catalogNav, portalNav } from './nav';
import { docKindIcon, RESERVED_SEGMENTS } from './kinds';
import { docPage } from './ui/lib/docs';

export interface AutocatalogDocsOptions {
  /**
   * Aggregation root, relative to the Astro project root.
   *
   * Defaults to `..`: a docs site in its own repository, reading the sibling
   * repositories checked out beside it. Point it at a directory containing
   * `docs/` instead to publish one repository's own documentation.
   */
  root?: string;
  /**
   * Name for the single-repository shape, when the root's directory name is not
   * the repository name. Otherwise the shape is detected from disk.
   *
   * This is the URL namespace every document sits under, because a document's
   * id is its address: `docs/runbook` is published at `/docs/runbook`.
   */
  repo?: string;
  /**
   * Repository identity in the shared resource graph, when it differs from the
   * URL namespace above.
   *
   * A project site already served from `/<repo>/` does not want that name
   * repeated in every path, so `repo` is often a shorter word than the
   * repository is called. The graph joins Documents, Events and Agents on
   * repository identity, so it needs the real name rather than the pretty one.
   */
  repository?: string;
  /** Committed JSON Schema the frontmatter must satisfy. */
  schema?: string;
  /**
   * The organisation's document kinds. Omit and the site finds
   * `contracts/autocatalog.conventions.json` the way it finds the contract.
   */
  conventions?: string;
  /**
   * A folder of the site's own pages and API routes, laid out as `src/pages/`
   * is. For a site `ac site` builds, which has no `src/pages/` to put them in.
   */
  pages?: string;
  /** One sentence describing what is aggregated here, used on / and llms.txt. */
  description?: string;
  /** An accent colour by name. A site's own `customCss` goes further. */
  theme?: (typeof SITE_THEMES)[number];
  /** Groups to show in place of the catalog's own. */
  navigation?: SiteNavigationInput;
  /**
   * Build for readers outside the company, such as `public`: only documents
   * naming them, and the API references without `x-internal` operations.
   */
  audience?: string;
  /**
   * How each OpenAPI reference is laid out. `frame`, the default, keeps the
   * site's header and sidebar and gives Scalar the rest of the page in a
   * frame, with its own sidebar, search and request client. `full` gives
   * Scalar the whole page below the header; `embedded` sets it inside the
   * content column.
   */
  apiReference?: 'frame' | 'full' | 'embedded';
  /** What the sidebar calls the link to an API's reference under its service: `Scalar` by default. */
  apiReferenceLabel?: string;
  /** The kinds the home page counts, in order: six chosen for it by default. */
  homeCounts?: string[];
  /** Pages composed from blocks: `home`, in order. Unset, the home page is as built. */
  layouts?: SiteConfig['layouts'];
  /** Blocks a layout can name beyond the built-in ones: an Astro component's path by name. */
  blocks?: Record<string, string>;
  /**
   * The MCP endpoint at `/mcp` on a site with `output: 'server'`, where agents
   * search its pages and read its APIs' operations. On by default with `access`
   * or an `audience`; `true` serves it on any server site, `false` leaves it out.
   */
  mcp?: boolean;
  /**
   * A server-sent events URL the maps follow in their live mode: each frame's
   * JSON names the event that fired (`{ "name": "order.placed", "producer"? }`).
   * `event` is the SSE event name frames arrive under; `message` by default.
   */
  live?: { url: string; event?: string };
  /**
   * Favicon path under the site's `public/` directory. Defaults to
   * `/favicon.svg` (shipped with `ac site`). A Starlight `favicon` already set
   * on the site wins over this.
   */
  favicon?: string;
  /** The site's own words for its interface, by Starlight's translation key. */
  strings?: Record<string, string>;
  /** The site's sections, in the rail beside the sidebar and atop the menu on a phone. `[]` names none. */
  nav?: SiteNavLink[];
  /**
   * Who may open each document, per request, on a site with `output: 'server'`:
   * `module` default-exports `SiteAccess`, and `denied` is what a closed
   * document answers with, `hide` (a 404) or `teaser` (its title, a 403).
   */
  /**
   * Publish the one repository's documents at the site's root, without its
   * name: `docs/labels/start.md` at `/labels/start/`. Ids keep the name.
   * A site for an `audience` with one repository does this unless `false`.
   */
  atRoot?: boolean;
  access?: {
    module: string;
    denied?: 'hide' | 'teaser';
    /**
     * The module, loaded with `loadSiteAccess` at the top of astro.config.mjs.
     * Given, the build prints what each of its sample `readers` may open.
     */
    rule?: SiteAccess<unknown>;
  };
}

/**
 * Read every enrolled repository's `docs/` instead of one `src/content/docs`.
 *
 * Everything a documentation site needs and nothing here is opinionated about —
 * search, navigation, keyboard and screen-reader support, dark mode,
 * translations — stays Starlight's. This plugin supplies what Starlight has no
 * opinion about: where the documents come from, who owns each one, when git
 * last saw it change, and which documents point at it.
 */
export default function autocatalogDocs(opts: AutocatalogDocsOptions = {}): StarlightPlugin {
  return {
    name: 'autocatalog-docs',
    hooks: {
      'config:setup': async ({
        astroConfig,
        config,
        updateConfig,
        addIntegration,
        addRouteMiddleware,
        command,
        logger,
      }) => {
        const projectRoot = fileURLToPath(astroConfig.root);
        const root = path.resolve(projectRoot, opts.root ?? '..');

        // The environment is how content.config.ts, which Astro loads outside
        // this module graph, learns what was configured. Anything already set
        // wins, so CI can point a build at a different checkout.
        process.env.AUTOCATALOG_DOCS_ROOT ??= root;
        process.env.AUTOCATALOG_DOCS_TITLE ??= starlightTitle.parse(config.title);

        if (opts.description) process.env.AUTOCATALOG_DOCS_DESCRIPTION ??= opts.description;

        const nav = opts.nav ?? siteNav(process.env.AUTOCATALOG_SITE_NAV);

        if (opts.navigation) {
          process.env.AUTOCATALOG_SITE_NAVIGATION ??= JSON.stringify(opts.navigation);
        }

        const theme = opts.theme ?? process.env.AUTOCATALOG_SITE_THEME;

        if (opts.audience) process.env.AUTOCATALOG_SITE_AUDIENCE ??= opts.audience;

        if (opts.apiReference) process.env.AUTOCATALOG_SITE_API_REFERENCE ??= opts.apiReference;

        if (opts.apiReferenceLabel) {
          process.env.AUTOCATALOG_SITE_API_REFERENCE_LABEL ??= opts.apiReferenceLabel;
        }

        if (opts.homeCounts) {
          process.env.AUTOCATALOG_SITE_HOME_COUNTS ??= JSON.stringify(opts.homeCounts);
        }

        if (opts.layouts) process.env.AUTOCATALOG_SITE_LAYOUTS ??= JSON.stringify(opts.layouts);

        const blocks = opts.blocks ?? {};

        checkHomeLayout(docsSiteConfig(), blocks);

        addIntegration({
          name: 'autocatalog-docs-blocks',
          hooks: {
            'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
              updateAstroConfig({ vite: { plugins: [blocksModule(blocks)] } });
            },
          },
        });

        if (opts.mcp !== undefined) process.env.AUTOCATALOG_SITE_MCP ??= String(opts.mcp);

        if (opts.atRoot !== undefined) process.env.AUTOCATALOG_DOCS_AT_ROOT ??= String(opts.atRoot);

        if (opts.access) {
          const { rule: _rule, ...settings } = opts.access;

          process.env.AUTOCATALOG_SITE_ACCESS ??= JSON.stringify({
            ...settings,
            module: path.resolve(projectRoot, settings.module),
          });
        }

        if (opts.repo) process.env.AUTOCATALOG_DOCS_REPO ??= opts.repo;

        if (opts.repository) process.env.AUTOCATALOG_DOCS_REPOSITORY ??= opts.repository;

        if (opts.live) {
          process.env.AUTOCATALOG_DOCS_LIVE_URL ??= opts.live.url;

          if (opts.live.event) process.env.AUTOCATALOG_DOCS_LIVE_EVENT ??= opts.live.event;
        }

        if (opts.pages)
          process.env.AUTOCATALOG_DOCS_PAGES ??= path.resolve(projectRoot, opts.pages);

        if (opts.schema) {
          process.env.AUTOCATALOG_DOCS_SCHEMA ??= path.resolve(projectRoot, opts.schema);
        }

        if (opts.conventions) {
          process.env.AUTOCATALOG_DOCS_CONVENTIONS ??= path.resolve(projectRoot, opts.conventions);
        }

        // Read back rather than reusing the locals above: an environment
        // override wins, and a sidebar built from a different checkout to the
        // pages is worse than no sidebar.
        const effective = docsSiteConfig();

        // One repository at the root: every link and route drops its name. A
        // site for an audience does this by default, since its readers never
        // see repositories; `atRoot: false` keeps the name.
        const atRoot = process.env.AUTOCATALOG_DOCS_AT_ROOT;

        const rootRepo =
          atRoot === 'true'
            ? onlyRepository(effective)
            : atRoot !== 'false' && effective.audience
              ? soleRepository(effective)
              : undefined;

        if (rootRepo) process.env.AUTOCATALOG_DOCS_ROOT_REPO = rootRepo;

        addIntegration({
          name: 'autocatalog-docs-root',
          hooks: {
            'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
              updateAstroConfig({
                vite: {
                  define: {
                    'import.meta.env.AUTOCATALOG_DOCS_ROOT_REPO': JSON.stringify(rootRepo ?? ''),
                  },
                },
              });
            },
          },
        });

        // Navigation comes from the validated catalog, not from raw files: a
        // repository whose catalog does not compile is quarantined here exactly
        // as it is on the pages, instead of failing the whole site.
        const catalog = await buildSiteCatalog(effective, { includeDates: false });

        // Configuration is the one place a build compiles the catalog exactly
        // once, so it is where the build says what the catalog left out.
        for (const warning of catalog.warnings) logger.warn(warning);

        if (rootRepo) refuseRootClashes(catalog.docs);

        // The rail and TopNav read the sections from here, at build time: a
        // server site has no build environment left when it renders. A site
        // that names none gets Home, Catalog and Docs, or, for readers
        // outside, Documentation and API reference; `nav: []` names none.
        const docPages = catalog.docs.map((doc) => docPage(doc.id));

        const sections =
          nav ??
          (effective.audience
            ? portalNav(docPages, catalog.apis.map(apiPath))
            : catalogNav(docPages, [
                ...RESERVED_SEGMENTS,
                ...catalog.kinds.map((kind) => kind.path),
                'search',
              ]));

        for (const { label, icon } of sections) {
          if (icon && !isIcon(icon)) {
            logger.warn(
              `nav: "${label}" names the icon "${icon}", which the catalog does not have`,
            );
          }
        }

        addIntegration({
          name: 'autocatalog-docs-nav',
          hooks: {
            'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
              updateAstroConfig({ vite: { plugins: [navModule(sections)] } });
            },
          },
        });

        // Documents the catalog left out have no pages, twins or navigation
        // either: the content collection and the twins read this back.
        const exclude = catalog.failures.flatMap((failure) =>
          failure.source === 'docs' ? [failure.repository] : [],
        );

        process.env.AUTOCATALOG_DOCS_EXCLUDE = exclude.join(path.delimiter);

        const sidebar = docsSidebar(effective.root, {
          repo: effective.repo,
          repository: effective.repository,
          exclude,
          ...audienceReader(effective.audience),
        });

        // A site with every document left out would replace the last good one.
        // A repository publishing components still has something to show.
        const onlyDocuments = exclude.filter(
          (repository) =>
            !catalog.graph.resources.some(
              ({ ref }) => ref.kind === 'component' && ref.namespace === repository,
            ),
        );

        if (sidebar.length === 0 && onlyDocuments.length > 0) {
          throw new Error(
            `Every document was left out (${onlyDocuments.join(', ')}). The warnings above say why.`,
          );
        }

        if (sidebar.length === 0) {
          logger.warn(
            effective.audience
              ? `No document names audience ${effective.audience}. Add \`audience: [${effective.audience}]\` to the frontmatter of each one to publish.`
              : `No documents found under ${effective.root}. A repository publishes by committing docs/*.md.`,
          );
        }

        // One repository at the root has its folders at the top, as its pages are.
        const contentSidebar =
          config.sidebar ?? (rootRepo && sidebar.length === 1 ? sidebar[0]!.items : sidebar);

        // Starlight also opens whichever group holds the current page.
        const eventsSidebar = catalogSidebar(catalog.events, catalog.apis, {
          apiLabel: effective.apiReferenceLabel,
          graph: catalog.graph,
        });

        // A plugin `favicon` fills Starlight when the site did not set one.
        // `ac site` ships `public/favicon.svg` and reads AUTOCATALOG_SITE_FAVICON.
        const favicon =
          opts.favicon && (config.favicon ?? DEFAULT_FAVICON) === DEFAULT_FAVICON
            ? opts.favicon
            : undefined;

        // Readers outside get the references; the rest of the catalog is the company's.
        const catalogPages = effective.audience
          ? [
              // One API is the reference itself, not a list of one.
              ...(catalog.apis.length === 1
                ? [
                    {
                      label: 'API reference',
                      id: 'apis',
                      link: `/${apiPath(catalog.apis[0]!)}`,
                      icon: 'api' as const,
                    },
                  ]
                : catalog.apis.length > 1
                  ? [{ label: 'API reference', link: '/apis', icon: 'api' as const }]
                  : []),
              ...catalog.kinds.map((kind) => ({
                label: kind.label,
                link: `/${kind.path}`,
                icon: docKindIcon(kind),
              })),
            ]
          : [
              { label: 'Knowledge graph', link: '/catalog', icon: 'catalog' as const },
              ...(eventCatalogEmbeds()
                ? [{ label: 'Architecture', link: '/architecture', icon: 'architecture' as const }]
                : []),
              ...(buildDomains(catalog.events, catalog.graph).length > 0
                ? [{ label: 'Domains', link: '/domains', icon: 'domain' as const }]
                : []),
              ...(catalog.events.length > 0
                ? [
                    { label: 'Schemas', link: '/schemas', icon: 'braces' as const },
                    { label: 'Fields', link: '/fields', icon: 'fields' as const },
                  ]
                : []),
              ...(retirementsPageProps(catalog, '/').retirements.length > 0
                ? [{ label: 'Retirements', link: '/retirements', icon: 'layers' as const }]
                : []),
              ...(catalogServices(catalog).size > 0
                ? [{ label: 'Services', link: '/services', icon: 'service' as const }]
                : []),
              ...(catalogSystemRows(catalog, '/').length > 0
                ? [{ label: 'Systems', link: '/systems', icon: 'architecture' as const }]
                : []),
              ...(catalog.apis.length > 0
                ? [{ label: 'APIs', link: '/apis', icon: 'api' as const }]
                : []),
              ...(buildChannels(catalog.graph, catalog.designs, '/').length > 0
                ? [{ label: 'Channels', link: '/channels', icon: 'channel' as const }]
                : []),
              ...(catalog.graph.resources.some(({ ref }) => ref.kind === 'component')
                ? [{ label: 'Components', link: '/components', icon: 'component' as const }]
                : []),
              ...(catalog.graph.resources.some(({ ref }) => ref.kind === 'mcp-server')
                ? [{ label: 'MCP servers', link: '/mcp-servers', icon: 'mcp-server' as const }]
                : []),
              ...(catalog.flows.length > 0
                ? [{ label: 'Flows', link: '/flows', icon: 'flow' as const }]
                : []),
              // `ac site` dev starts designs there, so it is listed before there are any.
              ...(catalog.designs.length > 0 || command === 'dev'
                ? [{ label: 'Designs', link: '/designs', icon: 'design' as const }]
                : []),
              ...(catalog.model.glossaries.length > 0
                ? [{ label: 'Glossary', link: '/glossary', icon: 'glossary' as const }]
                : []),
              ...(catalog.model.entities.length > 0
                ? [{ label: 'Entities', link: '/entities', icon: 'entity' as const }]
                : []),
              ...(catalog.model.dataProducts.length > 0
                ? [{ label: 'Data products', link: '/data-products', icon: 'dataProduct' as const }]
                : []),
              ...(catalog.specifications.length > 0
                ? [{ label: 'Specifications', link: '/specs', icon: 'book' as const }]
                : []),
              // Decisions, runbooks, incidents: each kind with documents.
              ...catalog.kinds.map((kind) => ({
                label: kind.label,
                link: `/${kind.path}`,
                icon: docKindIcon(kind),
              })),
              ...(catalog.models.length > 0
                ? [{ label: 'Data models', link: '/data', icon: 'data' as const }]
                : []),
              ...(graphOwners(catalog.graph).length > 0
                ? [{ label: 'Owners', link: '/owners', icon: 'owners' as const }]
                : []),
            ];

        // Domains first, then a link to each catalog page. A site with its own
        // `navigation`, a site for an audience and a catalog without domains
        // keep the list of pages.
        const domainGroups =
          effective.navigation || effective.audience
            ? []
            : domainSidebar(catalog, catalogPages, { apiLabel: effective.apiReferenceLabel });

        updateConfig({
          ...(favicon && { favicon }),
          // Starlight draws asides and heading links only in the folders it is told about.
          markdown: {
            ...config.markdown,
            processedDirs: [...(config.markdown?.processedDirs ?? []), effective.root],
          },
          // A sidebar the site was configured with would have to be edited every
          // time a team writes a document. This one is what is on disk.
          sidebar: domainGroups.length
            ? [...domainGroups, ...contentSidebar]
            : [
                ...navigationGroups(catalogPages, effective.navigation),
                ...contentSidebar,
                ...eventsSidebar,
              ],
          // The theme (DESIGN.md). First, so a site's own customCss still wins.
          customCss: [
            'autocatalog-docs-astro/styles/index.css',
            ...(theme ? [`autocatalog-docs-astro/styles/themes/${theme}.css`] : []),
            ...(config.customCss ?? []),
          ],
          // Draws ```mermaid fences, on the pages that have one.
          head: [
            ...(config.head ?? []),
            { tag: 'script', content: EMBED_SCRIPT },
            { tag: 'script', content: SIDEBAR_SCRIPT },
            { tag: 'script', content: SECTION_TRANSITION_SCRIPT },
            { tag: 'script', content: DARK_CLASS_SCRIPT },
            { tag: 'script', attrs: { type: 'module' }, content: MERMAID_SCRIPT },
          ],
          components: {
            // Ownership and the two link directions are facts about a document
            // that Starlight has nowhere to put, so they go below the article.
            Footer: 'autocatalog-docs-astro/overrides/DocFooter.astro',
            // The title names a resource by its key in the catalog and says
            // where its definition was read.
            PageTitle: 'autocatalog-docs-astro/overrides/PageTitle.astro',
            // Pinned pages, as the first group of the navigation.
            Sidebar: 'autocatalog-docs-astro/overrides/Sidebar.astro',
            // Sun-and-moon theme control, plus icon rail and sidebar
            // collapse/resize outside the pane Starlight hides when collapsed.
            ThemeSelect: 'autocatalog-docs-astro/overrides/ThemeSelect.astro',
            // Product chrome: title, dominant search, utilities. Section links
            // live in the icon rail.
            Header: 'autocatalog-docs-astro/overrides/Header.astro',
            // Pagefind indexes only prerendered pages, so a site that renders per
            // request searches on the server, as each reader may.
            ...(config.prerender === false && {
              Search: 'autocatalog-docs-astro/overrides/Search.astro',
            }),
            // A document's own `# Title` would repeat the title above it.
            MarkdownContent: 'autocatalog-docs-astro/overrides/MarkdownContent.astro',
            // A site that already overrides one of these keeps its own.
            ...config.components,
          },
        });

        const { access } = effective;

        // A page built ahead is the same for every reader, so no rule reaches it.
        if (access && (astroConfig.output !== 'server' || config.prerender !== false)) {
          throw new Error(
            "access decides per request, so the site needs output: 'server' in Astro and prerender: false in Starlight",
          );
        }

        // What each sample reader may open, and the links that would lead
        // one of them to a document they may not open.
        const rule = opts.access?.rule;

        if (rule) {
          const table = accessTable(catalog.docs, rule);

          // What a page shared by every reader may list: see `docsCatalog`.
          process.env.AUTOCATALOG_DOCS_OPEN = JSON.stringify(
            table.rows.flatMap((row) => (row.opens[0] ? [row.id] : [])),
          );

          if (command === 'build') {
            logger.info(
              rule.readers
                ? `Who may open each document:\n${formatAccessTable(table)}`
                : 'Name sample readers in the access module (readers) to see who may open each document.',
            );

            for (const link of closedLinks(catalog.docs, table)) logger.warn(link);
          }
        } else if (access) {
          logger.warn(
            'The access module was not loaded at build, so pages built ahead list no documents. Load it with loadSiteAccess in astro.config.mjs.',
          );
        }

        addIntegration(
          autocatalogDocsRoutes(
            effective.root,
            process.env.AUTOCATALOG_DOCS_PAGES || undefined,
            effective.audience,
            // Each reader's lists are their own, so kind pages render per request.
            access && catalog.kinds.map((kind) => kind.path),
            rootRepo !== undefined && catalog.docs.some((doc) => docPage(doc.id) === ''),
          ),
        );

        // A page rendered per request runs after the build's environment is
        // gone, so what the build was told goes into the bundle. The assistant's
        // pages are taken now for the same reason.
        const { chat } = effective;

        // Agents connect by URL, so the endpoint needs a server; llms.txt names it.
        const servesMcp = siteServesMcp(effective, astroConfig.output);

        if (servesMcp) process.env.AUTOCATALOG_SITE_MCP_ENDPOINT = 'mcp';

        const snapshot =
          command === 'build' && astroConfig.output === 'server'
            ? await catalogSnapshot(effective)
            : {};

        addIntegration({
          name: 'autocatalog-docs-build',
          hooks: {
            'astro:config:setup': ({
              updateConfig: updateAstroConfig,
              injectRoute,
              addMiddleware,
            }) => {
              const base = astroConfig.base.replace(/\/?$/, '/');

              updateAstroConfig({
                vite: {
                  ...(command === 'build' && {
                    define: {
                      ...builtSettings(process.env),
                      ...snapshot,
                    },
                  }),
                  // The site's own panel is served to the browser in dev.
                  ...(chat?.panel && { server: { fs: { allow: [path.dirname(chat.panel)] } } }),
                  plugins: [
                    buildModules(
                      chat && {
                        module: chat.module,
                        component: chat.panel,
                        pages: chatPages(catalog, base),
                        panel: {
                          api: `${base}api/chat`,
                          title: chat.title,
                          description: chat.description,
                          suggestions: chat.suggestions,
                          support: chat.support,
                          side: chat.side,
                          text: chatText(chat.text),
                          icons: chatIcons(chat.icons),
                        },
                      },
                      astroConfig.output === 'server',
                      access,
                    ),
                  ],
                },
              });

              // Before the site's own middleware, which can read `locals.reader`.
              if (access) {
                addMiddleware({
                  entrypoint: fileURLToPath(new URL('./access-middleware.ts', import.meta.url)),
                  order: 'pre',
                });
              }

              // The site's own page at one of these addresses replaces ours.
              const own = new Set(
                process.env.AUTOCATALOG_DOCS_PAGES
                  ? ownPageRoutes(process.env.AUTOCATALOG_DOCS_PAGES).map(([pattern]) => pattern)
                  : [],
              );

              const routes: Array<[boolean, string, string]> = [
                [config.prerender === false, '/search', './pages/search.astro'],
                [access?.denied === 'teaser', '/no-access', './pages/no-access.astro'],
                [chat !== undefined, '/api/chat', './pages/chat.ts'],
                [servesMcp, '/mcp', './pages/mcp.ts'],
              ];

              for (const [wanted, pattern, file] of routes) {
                if (wanted && !own.has(pattern)) {
                  injectRoute({
                    pattern,
                    entrypoint: fileURLToPath(new URL(file, import.meta.url)),
                  });
                }
              }
            },
          },
        });

        // Joins the site's own Markdown processor, Sätteri or unified, the way
        // Starlight adds its asides (markdown-plugins.ts).
        addIntegration({
          name: 'autocatalog-docs-markdown',
          hooks: {
            'astro:config:setup': ({ config: astro, logger: markdownLogger }) => {
              registerMarkdownPlugins(astro.markdown?.processor, astro.base, markdownLogger);
            },
          },
        });

        // `.mdx` documents use the built-in components without importing them.
        addIntegration({
          name: 'autocatalog-docs-mdx',
          hooks: {
            'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
              updateAstroConfig({ vite: { plugins: [mdxComponents()] } });
            },
          },
        });

        // The pages are React components, hydrated as islands where they have
        // anything to do. A site already using React keeps its own configuration
        // of it.
        if (command === 'dev' && !siteHasReact(projectRoot)) {
          throw new Error(
            "autocatalog-docs-astro renders React pages, and the dev server resolves React from the site. Add react and react-dom to this site's dependencies; builds do not need them.",
          );
        }

        if (
          !astroConfig.integrations.some((integration) => integration.name === '@astrojs/react')
        ) {
          addIntegration(react());
        }

        addIntegration(reactRendererIntegration());

        // The Code component's highlighter, microlighter, loads each grammar with
        // import(`./grammars/${name}.js`). Pre-bundling would break that in dev,
        // and a build leaves such imports in node_modules alone unless told to
        // bundle them; everything else in node_modules is still left alone.
        addIntegration({
          name: 'autocatalog-docs-microlighter',
          hooks: {
            'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
              updateAstroConfig({
                vite: {
                  optimizeDeps: { exclude: ['microlighter'] },
                  build: { dynamicImportVarsOptions: microlighterGrammars },
                },
              });
            },
          },
        });

        // The components are styled with Tailwind (shadcn/ui). A site already
        // running Tailwind's Vite plugin compiles this plugin's styles with it.
        if (!hasTailwind(astroConfig.vite.plugins ?? [])) {
          addIntegration({
            name: 'autocatalog-docs-tailwind',
            hooks: {
              'astro:config:setup': ({ updateConfig: updateAstroConfig }) => {
                updateAstroConfig({ vite: { plugins: [tailwindcss()] } });
              },
            },
          });
        }

        addRouteMiddleware({ entrypoint: 'autocatalog-docs-astro/route-middleware' });
      },
      // Search finds more than documents here, so its box says so. A site's
      // own translation of the label still wins.
      'i18n:setup': ({ injectTranslations }) => {
        const outside = opts.audience ?? process.env.AUTOCATALOG_SITE_AUDIENCE;

        injectTranslations({
          en: {
            'search.label': outside ? 'Search guides and APIs…' : 'Search docs, events, services…',
            // The site's own words win over ours.
            ...(opts.strings ?? siteStrings(process.env.AUTOCATALOG_SITE_STRINGS)),
          },
        });
      },
    },
  };
}

const stringsSchema = z.record(z.string(), z.string());

/** Header links `ac site` passes as JSON; none when unset. */
function siteNav(json: string | undefined): SiteNavLink[] | undefined {
  return json ? z.array(siteNavLinkSchema).parse(JSON.parse(json)) : undefined;
}

const CHAT_MODULE = 'virtual:autocatalog-chat';

const BUILD_MODULE = 'virtual:autocatalog-docs-build';

const ACCESS_MODULE = 'virtual:autocatalog-access';

const PANEL_MODULE = 'virtual:autocatalog-chat-panel';

const require = createRequire(import.meta.url);

/**
 * The site's settings as Vite replacements for `process.env.<name>`, so a
 * server site renders each request from what it was built with. The dev
 * server's design signals change while it runs, so they are left to read live.
 */
/** The repository a site publishes at its root: there must be exactly one. */
function onlyRepository(site: DocsSiteConfig): string {
  const name = soleRepository(site);

  if (name) return name;

  const { roots } = resolveDocsLayout(site.root, { repo: site.repo, repository: site.repository });

  throw new Error(
    `atRoot publishes one repository at the site's root, and this site has ${roots.length}: ${roots.map((root) => root.name).join(', ') || 'none'}`,
  );
}

/** The site's repository when it has exactly one. */
function soleRepository(site: DocsSiteConfig): string | undefined {
  const { roots } = resolveDocsLayout(site.root, { repo: site.repo, repository: site.repository });

  return roots.length === 1 ? roots[0]!.name : undefined;
}

/** The addresses the catalog and its pages use, which a document at the root cannot take. */
const ROOT_TAKEN = new Set([...RESERVED_SEGMENTS, 'search', 'no-access', 'api', '404']);

/** A document at the root whose first folder is an address of the catalog's own. */
function refuseRootClashes(docs: readonly Doc[]): void {
  const clashes = docs.flatMap((doc) => {
    const first = docPage(doc.id).split('/')[0] ?? '';

    return ROOT_TAKEN.has(first) ? [`${doc.id} (/${first}/)`] : [];
  });

  if (clashes.length > 0) {
    throw new Error(
      `atRoot: these documents would take an address the site uses itself; move them into a folder of another name, or set "atRoot": false: ${clashes.join(', ')}`,
    );
  }
}

/**
 * The catalog a server build renders every request from, so it never reads the
 * repositories at runtime: a deployment ships without them.
 */
async function catalogSnapshot(site: DocsSiteConfig): Promise<Record<string, string>> {
  return {
    'import.meta.env.AUTOCATALOG_CATALOG': JSON.stringify(stringify(await buildSiteCatalog(site))),
  };
}

export function builtSettings(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      /^AUTOCATALOG_((DOCS|SITE)_|EVENTCATALOG$)/.test(name) && value !== undefined
        ? [[`process.env.${name}`, JSON.stringify(value)]]
        : [],
    ),
  );
}

/**
 * What the build decided, for code that runs per request: the audience and
 * the assistant's panel for every page, and for the assistant's endpoint the
 * site's model module and the pages it answers from.
 */
function buildModules(
  chat:
    | { module: string; component: string | undefined; pages: ChatPage[]; panel: ChatPanelProps }
    | undefined,
  documentsPerRequest: boolean,
  access: SiteAccessConfig | undefined,
): PluginOption {
  return {
    name: 'autocatalog-docs-build',
    resolveId: (id) =>
      [CHAT_MODULE, BUILD_MODULE, ACCESS_MODULE, PANEL_MODULE].includes(id) ? `\0${id}` : undefined,
    load: (id) => {
      // The panel the browser renders: the site's own component, or the default.
      if (id === `\0${PANEL_MODULE}`) {
        return chat?.component
          ? `export { default } from ${JSON.stringify(chat.component)};`
          : `export { ChatPanel as default } from ${JSON.stringify(require.resolve('autocatalog-chatbot/react'))};`;
      }

      if (id === `\0${ACCESS_MODULE}`) {
        if (!access) throw new Error('The site has no access: set access in autocatalog.site.json');

        return [
          `export { default as access } from ${JSON.stringify(access.module)};`,
          `export const denied = ${JSON.stringify(access.denied ?? 'hide')};`,
        ].join('\n');
      }

      if (id === `\0${BUILD_MODULE}`) {
        return [
          `export const chatPanel = ${JSON.stringify(chat?.panel ?? null)};`,
          `export const documentsPerRequest = ${documentsPerRequest};`,
        ].join('\n');
      }

      if (id !== `\0${CHAT_MODULE}`) return undefined;

      if (!chat) throw new Error('The site has no assistant: set chat in autocatalog.site.json');

      return [
        `export { default as options } from ${JSON.stringify(chat.module)};`,
        `export const pages = ${JSON.stringify(chat.pages)};`,
      ].join('\n');
    },
  };
}

/**
 * A home layout that would not draw what it says fails the build, naming the
 * block: one nobody provides, an extension's block that takes a built-in's
 * name, and on a site for an audience, the counts, map or attention list,
 * which that site never publishes.
 */
export function checkHomeLayout(
  site: Pick<SiteConfig, 'audience' | 'layouts'>,
  blocks: Record<string, string>,
): void {
  for (const name of Object.keys(blocks)) {
    if (name in HOME_BLOCKS) {
      throw new Error(
        `extend: a block named '${name}' takes the name of a built-in block (${Object.keys(HOME_BLOCKS).join(', ')}). Name yours differently.`,
      );
    }
  }

  for (const { block } of site.layouts?.home ?? []) {
    if (!(block in HOME_BLOCKS) && !(block in blocks)) {
      throw new Error(
        `layouts.home: no block '${block}'. Built in: ${Object.keys(HOME_BLOCKS).join(', ')}${Object.keys(blocks).length ? `; from extend: ${Object.keys(blocks).join(', ')}` : ''}`,
      );
    }

    if (site.audience && INSIDE_ONLY_BLOCKS.some((name) => name === block)) {
      throw new Error(
        `layouts.home: a site for "${site.audience}" does not show '${block}', which draws the company's own catalog. Remove it from the layout.`,
      );
    }
  }
}

const BLOCKS_MODULE = 'virtual:autocatalog-docs-blocks';

/** The blocks `extend` adds, as a module of their components by name. */
function blocksModule(blocks: Record<string, string>): PluginOption {
  const entries = Object.entries(blocks);

  return {
    name: 'autocatalog-docs-blocks',
    resolveId: (id) => (id === BLOCKS_MODULE ? `\0${BLOCKS_MODULE}` : undefined),
    load: (id) =>
      id === `\0${BLOCKS_MODULE}`
        ? [
            ...entries.map(([, file], i) => `import block${i} from ${JSON.stringify(file)};`),
            `export default { ${entries.map(([name], i) => `${JSON.stringify(name)}: block${i}`).join(', ')} };`,
          ].join('\n')
        : undefined,
  };
}

const NAV_MODULE = 'virtual:autocatalog-docs-nav';

/** The header's links as a module, so pages read what the build was given. */
function navModule(links: SiteNavLink[]): PluginOption {
  return {
    name: 'autocatalog-docs-nav',
    resolveId: (id) => (id === NAV_MODULE ? `\0${NAV_MODULE}` : undefined),
    load: (id) =>
      id === `\0${NAV_MODULE}` ? `export default ${JSON.stringify(links)};` : undefined,
  };
}

/** Strings `ac site` passes as JSON; none when unset. */
function siteStrings(json: string | undefined): Record<string, string> {
  return json ? stringsSchema.parse(JSON.parse(json)) : {};
}

/** Bundles microlighter's grammars, and leaves every other dependency as Vite would. */
export const microlighterGrammars = {
  include: [
    /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?microlighter\//,
    /^(?!.*\/node_modules\/)/,
  ],
  exclude: [],
};

/** Whether Tailwind's Vite plugin, which registers several, is among these. */
function hasTailwind(plugins: PluginOption[]): boolean {
  return plugins.some((plugin) =>
    Array.isArray(plugin)
      ? hasTailwind(plugin)
      : Boolean(plugin && 'name' in plugin && plugin.name.startsWith('@tailwindcss/vite')),
  );
}

/** Starlight's title is a string or a per-language record; ours is one string. */
const starlightTitle = z.union([
  z.string(),
  z
    .record(z.string(), z.string())
    .transform((title) => title.en ?? Object.values(title)[0] ?? 'Documentation'),
]);
