import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import autocatalogDocs, { rehypeDocsBase } from 'autocatalog-docs-astro';

const base = '/autocatalog';

// GitHub Pages serves a project site under the repository name, so every
// generated link has to carry the base. The plugin handles the links it makes
// and the ones inside document bodies; Starlight handles its own.
export default defineConfig({
  site: 'https://jagreehal.github.io',
  base,
  // Documents address each other by id, so a link in a body is root-relative
  // and would miss the base. Astro freezes the markdown pipeline before a
  // plugin-added integration could touch it, so it is wired here.
  markdown: { rehypePlugins: [rehypeDocsBase(base)] },
  integrations: [
    starlight({
      title: 'autocatalog',
      description:
        'Event catalogs generated from the code that runs, with provenance on every field.',
      favicon: '/favicon.svg',
      customCss: [
        '@fontsource/jetbrains-mono',
        '@fontsource/jetbrains-mono/500.css',
        '@fontsource/jetbrains-mono/600.css',
        './src/styles/theme.css',
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/autocatalog' },
      ],
      editLink: {
        baseUrl: 'https://github.com/jagreehal/autocatalog/edit/main/',
      },
      plugins: [
        // This project's own docs/, published by the plugin this project ships.
        // `repo: 'docs'` names the URL segment every document sits under; the
        // repository's own name is already the base path.
        autocatalogDocs({
          root: '../..',
          repo: 'docs',
          // `repo` is the URL namespace; this is who the repository actually is.
          // The site is already served from /autocatalog/, so repeating the name
          // in every path would be noise — but the graph joins on identity.
          repository: 'autocatalog',
          description:
            'Everything committed under docs/ in the autocatalog repository, published from source.',
        }),
      ],
      // Generated navigation is one group per repository, which is the right
      // answer for an aggregating site and the wrong one for a single project
      // with sections. A configured sidebar wins, so this is ours.
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'docs/introduction' },
            { label: 'Quick start', slug: 'docs/quick-start' },
            { label: 'autocatalog and EventCatalog', slug: 'docs/comparison' },
          ],
        },
        {
          label: 'Defining events',
          items: [
            { label: 'From Zod', slug: 'docs/events/zod' },
            { label: 'From Pydantic', slug: 'docs/events/pydantic' },
            { label: 'From JSON Schema', slug: 'docs/events/json-schema' },
            { label: 'Importing a catalog', slug: 'docs/events/importing' },
            { label: 'Writing an adapter', slug: 'docs/adapters' },
            { label: 'Validation', slug: 'docs/events/validation' },
            { label: 'Versioning', slug: 'docs/events/versioning' },
          ],
        },
        {
          label: 'Keeping it honest',
          items: [
            { label: 'Drift gating in CI', slug: 'docs/drift-ci' },
            { label: 'Cross-domain delivery', slug: 'docs/cross-domain-delivery' },
            { label: 'Production operation', slug: 'docs/production' },
          ],
        },
        {
          label: 'Surfaces',
          items: [
            { label: 'The company site', slug: 'docs/site' },
            { label: 'MCP for coding agents', slug: 'docs/mcp' },
            { label: 'Agent catalogs', slug: 'docs/agents' },
            { label: 'The docs convention', slug: 'docs/docs-convention' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'CLI', slug: 'docs/cli' }],
        },
      ],
    }),
  ],
});
