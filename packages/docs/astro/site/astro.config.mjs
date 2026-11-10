// The site `ac site` builds. Nobody edits this file: every choice arrives as
// an environment variable, so one install serves any company's repositories.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import node from '@astrojs/node';
import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import autocatalogDocs, {
  loadSiteAccess,
  loadSiteExtensions,
  ownPageRoutes,
  rehypeDocsBase,
} from 'autocatalog-docs-astro';

const env = process.env;

const base = env.AUTOCATALOG_SITE_BASE || '/';

const title = env.AUTOCATALOG_DOCS_TITLE || 'Catalog';

// The site's own code, from `extend` in autocatalog.site.json: absolute module paths.
const ext = await loadSiteExtensions(
  (env.AUTOCATALOG_SITE_EXTEND || '').split(path.delimiter).filter(Boolean),
);

// Who may open each document, from `access` in autocatalog.site.json. Loaded
// here, while Astro loads this file, as the extensions are.
const access = env.AUTOCATALOG_SITE_ACCESS && JSON.parse(env.AUTOCATALOG_SITE_ACCESS);

const accessRule = access ? await loadSiteAccess(access.module) : undefined;

// Documents render per request; the catalog's pages stay prerendered.
const server = env.AUTOCATALOG_SITE_OUTPUT === 'server';

// A site's own 404 page replaces Starlight's.
const own404 =
  env.AUTOCATALOG_DOCS_PAGES &&
  ownPageRoutes(env.AUTOCATALOG_DOCS_PAGES).some(([pattern]) => pattern === '/404');

export default defineConfig({
  // `ac site` gives each run a root of its own; the sources stay here.
  srcDir: fileURLToPath(new URL('./src/', import.meta.url)),
  publicDir: env.AUTOCATALOG_SITE_PUBLIC || fileURLToPath(new URL('./public/', import.meta.url)),
  // Starlight's sitemap needs an origin. Without one the site still builds.
  ...(env.AUTOCATALOG_SITE_URL && { site: env.AUTOCATALOG_SITE_URL }),
  base,
  // Images ship as the repositories committed them: optimising needs Sharp, a
  // native install every user of `ac site` would otherwise have to get right.
  image: { service: passthroughImageService() },
  // Documents link to each other by id, which is root-relative, so body links
  // need the base as well as the ones Starlight makes.
  markdown: {
    processor: unified({
      remarkPlugins: ext.remarkPlugins,
      rehypePlugins: [...ext.rehypePlugins, rehypeDocsBase(base)],
    }),
  },
  ...(server && { output: 'server' }),
  // The assistant's endpoint answers per request, while the pages stay prerendered.
  ...((server || env.AUTOCATALOG_SITE_CHAT) && { adapter: node({ mode: 'standalone' }) }),
  integrations: [
    ...ext.integrations,
    starlight({
      title,
      ...(env.AUTOCATALOG_SITE_LOGO && {
        logo: {
          light: env.AUTOCATALOG_SITE_LOGO,
          dark: env.AUTOCATALOG_SITE_LOGO_DARK,
          alt: title,
          replacesTitle: true,
        },
      }),
      customCss: [
        ...(env.AUTOCATALOG_SITE_CSS ? [env.AUTOCATALOG_SITE_CSS] : []),
        ...ext.customCss,
      ],
      // autocatalog.site.json's tags first, then the extensions'.
      head: [...JSON.parse(env.AUTOCATALOG_SITE_HEAD || '[]'), ...ext.head],
      ...(env.AUTOCATALOG_SITE_SOCIAL && { social: JSON.parse(env.AUTOCATALOG_SITE_SOCIAL) }),
      components: ext.components,
      routeMiddleware: ext.routeMiddleware,
      ...(server && { prerender: false }),
      ...(own404 && { disable404Route: true }),
      // Default lives in site/public/favicon.svg. Set AUTOCATALOG_SITE_FAVICON
      // (and put that file under public/) to replace it.
      favicon: env.AUTOCATALOG_SITE_FAVICON || '/favicon.svg',
      plugins: [
        autocatalogDocs({
          ...(access && { access: { ...access, rule: accessRule } }),
          blocks: ext.blocks,
        }),
        ...ext.plugins,
      ],
    }),
  ],
});
