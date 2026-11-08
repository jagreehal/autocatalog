import { glob, type Loader, type LoaderContext } from 'astro/loaders';
import type { DocsLayout } from 'autocatalog-docs-core';
import { entryId } from './ui/lib/docs';

type DataStore = LoaderContext['store'];

const escapeGlob = (file: string) => file.replace(/[\\*?[\]{}()!+@|]/g, '\\$&');

/** From now on, a write of something hidden removes it instead. */
export function keepOut(store: Pick<DataStore, 'set' | 'delete'>, hidden: (id: string) => boolean) {
  const write = store.set.bind(store);

  store.set = (entry) => {
    if (!hidden(entry.id)) return write(entry);

    store.delete(entry.id);

    return false;
  };
}

/**
 * Keep cached document and image paths tied to the checkout they came from.
 * `listUnreadable` lists what a reader must not get. It is asked again for each
 * update the dev server's watcher sends, because the glob only knows what was
 * true at startup: a page can be added restricted, or restricted by an edit.
 */
export function docsLoader(layout: DocsLayout, listUnreadable: () => string[] = () => []): Loader {
  // Only files in this layout's repositories: a later scan can find a folder
  // this one did not, and nothing outside the glob is loaded anyway.
  const unreadable = () => listUnreadable().filter((file) => layout.rootFor(file) !== undefined);

  const leftOut = unreadable();

  const loader = glob({
    base: layout.root,
    pattern: [layout.pattern, ...leftOut.map((file) => `!${escapeGlob(file)}`)],
    generateId: ({ entry }) => entryId(layout.idFor(entry)),
  });

  const identity = JSON.stringify([layout.root, layout.roots]);

  return {
    name: 'autocatalog-documents',
    async load(context) {
      // Unchanged Markdown can retain image paths from a different checkout.
      // That checkout may no longer exist or may carry different images.
      if (context.meta.get('autocatalog-source') !== identity) context.store.clear();

      // Nothing publishes documents, every repository excluded included.
      if (layout.roots.length === 0) context.store.clear();
      else {
        await loader.load(context);
        keepOut(context.store, (id) =>
          unreadable().some((file) => entryId(layout.idFor(file)) === id),
        );
      }

      // By exact id as well: this must not rest on how a file name reads as a glob.
      for (const file of leftOut) context.store.delete(entryId(layout.idFor(file)));

      context.meta.set('autocatalog-source', identity);
    },
  };
}
