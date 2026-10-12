/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Item, ItemActions, ItemContent, ItemTitle } from '#ui/components/ui/item.tsx';
import { Separator } from '#ui/components/ui/separator.tsx';

export interface EventVersionsProps {
  /** Newest first, each already linked to its own page. */
  versions: Array<{ href: string; label: string; current: boolean; active: boolean }>;
  /**
   * What changed since the version before the one being read, as HTML. It is
   * `ac changelog`'s Markdown rendered at build time, so the site and the CLI
   * cannot describe the same change two ways.
   */
  changesHtml?: string | null;
}

export function EventVersions({ versions, changesHtml }: EventVersionsProps) {
  return (
    <div className="not-content">
      <Card id="versions">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Versions
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground">{`${versions.length} ${versions.length === 1 ? 'version' : 'versions'}`}</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Rows bleed into the card's padding, so their text lines up with its title. */}
            <ul className="-mx-3 m-0 flex list-none flex-col gap-1 p-0">
              {versions.map((entry) => (
                <li key={entry.href}>
                  {/* The one being read is marked, not linked to itself as if elsewhere. */}
                  <Item
                    size="sm"
                    variant={entry.active ? 'muted' : 'default'}
                    href={entry.href}
                    aria-current={entry.active ? 'page' : undefined}
                  >
                    <ItemContent>
                      <ItemTitle>
                        {entry.label}
                        {entry.current && <Badge variant="secondary">current</Badge>}
                      </ItemTitle>
                    </ItemContent>
                    {!entry.active && (
                      <ItemActions>
                        <ArrowUpRightIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground group-hover/item:text-foreground"
                        />
                      </ItemActions>
                    )}
                  </Item>
                </li>
              ))}
            </ul>
            {changesHtml && (
              <>
                <Separator />
                <div
                  className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:mt-0 prose-headings:mb-2 prose-headings:text-sm prose-headings:font-medium prose-headings:text-foreground prose-ul:my-0 prose-li:my-1 prose-li:text-foreground prose-li:marker:text-muted-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none"
                  data-changes=""
                  dangerouslySetInnerHTML={{ __html: changesHtml }}
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default EventVersions;
