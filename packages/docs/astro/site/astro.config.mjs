// The site `ac site` builds. Nobody edits this file: every choice arrives as
// an environment variable, so one install serves any company's repositories.
import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import autocatalogDocs, { rehypeDocsBase } from 'autocatalog-docs-astro';

const env = process.env;

const base = env.AUTOCATALOG_SITE_BASE || '/';

export default defineConfig({
  // Starlight's sitemap needs an origin. Without one the site still builds.
  ...(env.AUTOCATALOG_SITE_URL && { site: env.AUTOCATALOG_SITE_URL }),
  base,
  // Images ship as the repositories committed them: optimising needs Sharp, a
  // native install every user of `ac site` would otherwise have to get right.
  image: { service: passthroughImageService() },
  // Documents link to each other by id, which is root-relative, so body links
  // need the base as well as the ones Starlight makes.
  markdown: { processor: unified({ rehypePlugins: [rehypeDocsBase(base)] }) },
  integrations: [
    starlight({
      title: env.AUTOCATALOG_DOCS_TITLE || 'Catalog',
      plugins: [autocatalogDocs()],
    }),
  ],
});
