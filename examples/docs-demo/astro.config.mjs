import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import autocatalogDocs from 'autocatalog-docs-astro';

export default defineConfig({
  // Starlight ships the sitemap integration, which needs an absolute origin to
  // write URLs against. The demo is never deployed, so this is Acme's fictional
  // one — a real site puts its own here.
  site: 'https://docs.acme.example',
  integrations: [
    starlight({
      title: 'Acme docs (demo)',
      // Everything a documentation site needs is Starlight's: search, keyboard
      // navigation, dark mode, translations. The plugin only changes where the
      // documents come from and what the site can say about them.
      plugins: [
        autocatalogDocs({
          // A real company index sets root to '..' and reads the sibling
          // repositories checked out beside it. The demo keeps its
          // repositories in ./repos so the whole thing is one clone.
          root: './repos',
          description:
            'Every document committed under docs/ in an Acme repository, aggregated at build time.',
        }),
      ],
      components: {
        // Acme's own field, shown by Acme's own component. The plugin never
        // hears about `tier`; the contract at repos/contracts is the only place
        // it is declared.
        PageTitle: './src/DocTitle.astro',
      },
    }),
  ],
});
