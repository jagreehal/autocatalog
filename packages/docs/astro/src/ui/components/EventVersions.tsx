/** @jsxImportSource react */
import { ArrowUpRightIcon, ChevronRightIcon } from 'lucide-react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button } from '#ui/components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Collapsible, CollapsibleContent } from '#ui/components/ui/collapsible.tsx';
import { Item, ItemActions, ItemContent, ItemTitle } from '#ui/components/ui/item.tsx';

export interface EventVersionsProps {
  /**
   * Newest first, each already linked to its own page. `changesHtml` is what
   * changed since the version before it: `ac changelog`'s Markdown rendered at
   * build time, so the site and the CLI cannot describe the same change two
   * ways. Null for the oldest version.
   */
  versions: Array<{
    href: string;
    label: string;
    current: boolean;
    active: boolean;
    changesHtml?: string | null;
  }>;
}

const PROSE =
  'prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:mt-0 prose-headings:mb-2 prose-headings:text-sm prose-headings:font-medium prose-headings:text-foreground prose-ul:my-0 prose-li:my-1 prose-li:text-foreground prose-li:marker:text-muted-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none';

export function EventVersions({ versions }: EventVersionsProps) {
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
          {/* A timeline: the rail runs down the releases, newest at the top. */}
          <ul className="m-0 flex list-none flex-col gap-1 border-l p-0 pl-2">
            {versions.map((entry) => (
              <li key={entry.href} className="flex flex-col">
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
                {entry.changesHtml && (
                  // Every release's changes are a click away; the one being read starts open.
                  <Collapsible defaultExpanded={entry.active}>
                    <Button variant="ghost" size="xs" slot="trigger" className="ml-1">
                      <ChevronRightIcon className="transition-transform group-aria-expanded/button:rotate-90" />
                      What changed
                    </Button>
                    <CollapsibleContent>
                      <div
                        className={`${PROSE} px-3 pt-1 pb-2`}
                        data-changes=""
                        dangerouslySetInnerHTML={{ __html: entry.changesHtml }}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default EventVersions;
