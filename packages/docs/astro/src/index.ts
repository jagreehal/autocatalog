import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import type { StarlightPlugin } from '@astrojs/starlight/types';
import { z } from 'astro/zod';
import { isUnifiedProcessor } from '@astrojs/markdown-remark';
import type { PluginOption } from 'vite';
import { docsSiteConfig } from './config';
import { autocatalogDocsRoutes } from './routes';

export { rehypeDocsBase } from './links';

import { buildDocsCatalog } from './catalog';
import { graphOwners } from './owners';
import { catalogSidebar, docsSidebar } from './sidebar';
import { eventCatalogEmbeds } from './eventcatalog';
import { reactRendererIntegration, siteHasReact } from './react-integration';
import { MERMAID_SCRIPT, remarkMermaid } from './mermaid';

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
  /** One sentence describing what is aggregated here, used on / and llms.txt. */
  description?: string;
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

        if (opts.repo) process.env.AUTOCATALOG_DOCS_REPO ??= opts.repo;

        if (opts.repository) process.env.AUTOCATALOG_DOCS_REPOSITORY ??= opts.repository;

        if (opts.schema) {
          process.env.AUTOCATALOG_DOCS_SCHEMA ??= path.resolve(projectRoot, opts.schema);
        }

        // Read back rather than reusing the locals above: an environment
        // override wins, and a sidebar built from a different checkout to the
        // pages is worse than no sidebar.
        const effective = docsSiteConfig();
        const sidebar = docsSidebar(effective.root, effective.repo);

        if (sidebar.length === 0) {
          logger.warn(
            `No documents found under ${effective.root}. A repository publishes by committing docs/*.md.`,
          );
        }

        const contentSidebar = config.sidebar ?? sidebar;

        // Navigation comes from the validated catalog, not from raw files: a
        // repository whose catalog does not compile is quarantined here exactly
        // as it is on the pages, instead of failing the whole site.
        const catalog = await buildDocsCatalog(effective.root, {
          repo: effective.repo,
          repository: effective.repository,
          schemaPath: effective.schemaPath,
          includeDates: false,
        });

        // Configuration is the one place a build compiles the catalog exactly
        // once, so it is where the build says what the catalog left out.
        for (const warning of catalog.warnings) logger.warn(warning);

        const eventsSidebar = catalogSidebar(catalog.events);
        updateConfig({
          // A sidebar the site was configured with would have to be edited every
          // time a team writes a document. This one is what is on disk.
          sidebar: [
            {
              label: 'Catalog',
              items: [
                { label: 'Knowledge graph', link: '/catalog' },
                ...(eventCatalogEmbeds() ? [{ label: 'Architecture', link: '/architecture' }] : []),
                ...(eventsSidebar.length > 0
                  ? [
                      { label: 'Domains', link: '/domains' },
                      { label: 'Schemas', link: '/schemas' },
                      { label: 'Fields', link: '/fields' },
                    ]
                  : []),
                ...(catalog.apis.length > 0 ? [{ label: 'APIs', link: '/apis' }] : []),
                ...(graphOwners(catalog.graph).length > 0
                  ? [{ label: 'Owners', link: '/owners' }]
                  : []),
              ],
            },
            ...contentSidebar,
            ...eventsSidebar,
          ],
          // The theme (DESIGN.md). First, so a site's own customCss still wins.
          customCss: ['autocatalog-docs-astro/styles/index.css', ...(config.customCss ?? [])],
          // Draws ```mermaid fences, on the pages that have one.
          head: [
            ...(config.head ?? []),
            { tag: 'script', attrs: { type: 'module' }, content: MERMAID_SCRIPT },
          ],
          components: {
            // Ownership and the two link directions are facts about a document
            // that Starlight has nowhere to put, so they go below the article.
            Footer: 'autocatalog-docs-astro/overrides/DocFooter.astro',
            // The title names a resource by its key in the catalog and says
            // where its definition was read.
            PageTitle: 'autocatalog-docs-astro/overrides/PageTitle.astro',
            // A sun-and-moon button rather than a three-way select; it follows
            // the system until pressed.
            ThemeSelect: 'autocatalog-docs-astro/overrides/ThemeSelect.astro',
            // A document's own `# Title` would repeat the title above it.
            MarkdownContent: 'autocatalog-docs-astro/overrides/MarkdownContent.astro',
            // A site that already overrides one of these keeps its own.
            ...config.components,
          },
        });

        addIntegration(autocatalogDocsRoutes(effective.root));

        // Joins the site's own Markdown processor, the way Starlight adds its
        // asides. Another processor leaves the fence as a highlighted code block.
        addIntegration({
          name: 'autocatalog-docs-mermaid',
          hooks: {
            'astro:config:setup': ({ config: astro }) => {
              const processor = astro.markdown?.processor;

              if (processor && isUnifiedProcessor(processor))
                processor.options.remarkPlugins.push(remarkMermaid);
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
        injectTranslations({ en: { 'search.label': 'Search docs, events, services…' } });
      },
    },
  };
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
