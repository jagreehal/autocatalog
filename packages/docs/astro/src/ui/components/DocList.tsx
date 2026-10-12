/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { day, docHref, type DocListItem } from '../lib/docs';
import { IconTile } from './IconTile';

export type { DocListItem };

export interface DocListProps {
  items: DocListItem[];
  /** Show which repository each document comes from, for mixed lists. */
  showRepo?: boolean;
}

/** Who keeps a document and when it last changed, said as a sentence. */
function byline(item: DocListItem, showRepo: boolean): string {
  const updated = day(item.updated);
  const owned = `${showRepo ? `In ${item.repo}, owned` : 'Owned'} by ${item.owner}`;

  return updated ? `${owned}, updated ${updated}` : owned;
}

/**
 * Documents, one linked row each. Drawn inside a card's content: the rows bleed
 * into the card's padding, so their text lines up with the card's title.
 */
export function DocList({ items, showRepo = false }: DocListProps) {
  return (
    <ul className="not-content -mx-3 m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => (
        <li key={item.id}>
          <Item size="sm" href={docHref(item.id)}>
            <ItemMedia>
              <IconTile name="doc" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{item.title}</ItemTitle>
              <ItemDescription>{byline(item, showRepo)}</ItemDescription>
            </ItemContent>
            <ItemActions className="self-start">
              {item.tags.length > 0 && (
                <span className="text-muted-foreground">{item.tags.join(', ')}</span>
              )}
              <ArrowUpRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground group-hover/item:text-foreground"
              />
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  );
}

export default DocList;
