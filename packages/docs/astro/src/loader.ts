import { glob, type Loader } from 'astro/loaders';
import type { DocsLayout } from 'autocatalog-docs-core';

/** Keep cached document and image paths tied to the checkout they came from. */
export function docsLoader(layout: DocsLayout): Loader {
  const loader = glob({
    base: layout.root,
    pattern: layout.pattern,
    generateId: ({ entry }) => layout.idFor(entry),
  });

  const identity = JSON.stringify([
    layout.root,
    layout.pattern,
    layout.idFor(layout.single ? 'docs/index.md' : 'repo/docs/index.md'),
  ]);

  return {
    name: 'autocatalog-documents',
    async load(context) {
      // Unchanged Markdown can retain image paths from a different checkout.
      // That checkout may no longer exist or may carry different images.
      if (context.meta.get('autocatalog-source') !== identity) context.store.clear();

      await loader.load(context);
      context.meta.set('autocatalog-source', identity);
    },
  };
}
