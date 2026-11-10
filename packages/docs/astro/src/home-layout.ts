import type { JsonObject } from 'autocatalog-core';
import type { HomeBlockName, LayoutBlock } from 'autocatalog-docs-core';
import { HOME_BLOCKS } from 'autocatalog-docs-core';
import { z } from 'zod';
import { isIcon } from './icons';
import type { Stat } from './ui/components/Stats';
import type { DocListItem } from './ui/lib/docs';
import type { VisualiserGraph } from './ui/lib/visualiser';
import type { HomeBlockData } from './ui/pages/HomeBlock';
import type { ExploreCard, HomePageProps } from './ui/pages/HomePage';

/** One entry of a home layout: a built-in block with its data, or a site's own by name. */
export type HomeLayoutEntry =
  { custom: false; data: HomeBlockData } | { custom: true; name: string; props: JsonObject };

/** A site block's props, as JSON, since a layout reaches the site as JSON. */
const blockProps = z.record(z.string(), z.json());

export interface HomeLayoutContext {
  base: string;
  /** The counts, chosen by these kinds, or as the home page chooses them. */
  stats: (kinds?: string[]) => Stat[];
  documents: DocListItem[];
  /** Every document, by repository, for a `docs` block with no folder. */
  repos: HomePageProps['repos'];
  apis: ExploreCard[];
  /** The ways into the catalog, as the built-in page offers them. */
  explore: ExploreCard[];
  tags: HomePageProps['tags'];
  attention?: HomePageProps['attention'];
  map?: VisualiserGraph | undefined;
  catalogHref?: string | undefined;
}

/** A root-relative link under the site's base; any other is left as written. */
const under = (base: string, href: string) =>
  href.startsWith('/') ? `${base}${href.slice(1)}` : href;

/** A document whose path under its repository starts with the folder. */
const inFolder = (item: DocListItem, folder: string) =>
  item.id
    .split('/')
    .slice(1)
    .join('/')
    .startsWith(`${folder.replace(/^\/|\/$/g, '')}/`);

/**
 * Each block of a home layout with the catalog's data it shows: `layouts.home`,
 * or with none the default, which is the built-in page. A built-in block's
 * props are checked again here, since a layout reaches the site as JSON; a
 * block the site adds is passed its props as written.
 */
export function resolveHomeLayout(
  layout: LayoutBlock[],
  context: HomeLayoutContext,
): HomeLayoutEntry[] {
  return layout.map((entry): HomeLayoutEntry => {
    if (!(entry.block in HOME_BLOCKS)) {
      const { block: name, ...props } = entry;

      return { custom: true, name, props: blockProps.parse(props) };
    }

    // SAFETY: the guard above returned for every name HOME_BLOCKS does not hold.
    const block = HOME_BLOCKS[entry.block as HomeBlockName].parse(entry);

    switch (block.block) {
      case 'hero':
        return {
          custom: false,
          data: {
            block: 'hero',
            // The page's header already says the site's title and description.
            title: block.title,
            text: block.text,
            actions: (block.actions ?? []).map(({ label, href }) => ({
              label,
              href: under(context.base, href),
            })),
          },
        };
      case 'cards':
        return {
          custom: false,
          data: {
            block: 'cards',
            title: block.title,
            cards: block.items.map((item) => ({
              title: item.title,
              href: under(context.base, item.href),
              text: item.text ?? '',
              icon: item.icon && isIcon(item.icon) ? item.icon : 'doc',
            })),
          },
        };
      case 'countCards':
        return { custom: false, data: { block: 'countCards', stats: context.stats(block.kinds) } };
      case 'docs': {
        const { folder } = block;

        return {
          custom: false,
          data: folder
            ? {
                block: 'docs',
                title: block.title,
                items: context.documents.filter((item) => inFolder(item, folder)),
              }
            : { block: 'docs', title: block.title, repos: context.repos },
        };
      }

      case 'apis':
        return { custom: false, data: { block: 'apis', title: block.title, cards: context.apis } };
      case 'graph':
        return {
          custom: false,
          data: {
            block: 'graph',
            title: block.title,
            map: context.map,
            catalogHref: context.catalogHref,
          },
        };
      case 'attention':
        return { custom: false, data: { block: 'attention', attention: context.attention } };
      case 'explore':
        return {
          custom: false,
          data: { block: 'explore', title: block.title, cards: context.explore },
        };
      case 'tags':
        return { custom: false, data: { block: 'tags', title: block.title, tags: context.tags } };
    }
  });
}
