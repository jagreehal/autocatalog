/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { docHref } from '../lib/docs';
import { IconTile } from './IconTile';

/** One cross-repository edge, resolved to a readable title where one is known. */
export interface DocLink {
  id: string;
  title: string;
  repo: string;
  /** False when the target is not in this checkout, so the link cannot render. */
  resolved: boolean;
}

export interface DocLinksProps {
  /** Edges this document declares in `related`. */
  related: DocLink[];
  /** Edges other documents declare towards this one. Derived, never authored. */
  linkedFrom: DocLink[];
}

export function DocLinks({ related, linkedFrom }: DocLinksProps) {
  const sections = [
    { kind: 'related', heading: 'Related', links: related },
    { kind: 'linked-from', heading: 'Linked from', links: linkedFrom },
  ].filter((section) => section.links.length > 0);

  if (sections.length === 0) return null;

  return (
    <aside
      className="not-content mt-6 grid items-start gap-4 sm:grid-cols-2"
      aria-label="Linked documents"
    >
      {sections.map((section) => (
        // The two directions look alike and read differently, so each is
        // addressable on its own.
        <Card key={section.kind} data-links={section.kind}>
          <CardHeader>
            <CardTitle role="heading" aria-level={3}>
              {section.heading}
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">{`${section.links.length} ${section.links.length === 1 ? 'document' : 'documents'}`}</span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="-mx-3 m-0 flex list-none flex-col gap-1 p-0">
              {section.links.map((link) => (
                <li key={link.id}>
                  {link.resolved ? (
                    <Item size="sm" href={docHref(link.id)}>
                      <ItemMedia>
                        <IconTile name="doc" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{link.title}</ItemTitle>
                        <ItemDescription>{`In ${link.repo}`}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="self-start">
                        <ArrowUpRightIcon
                          aria-hidden="true"
                          className="size-4 text-muted-foreground group-hover/item:text-foreground"
                        />
                      </ItemActions>
                    </Item>
                  ) : (
                    /* Not in this checkout. Shown anyway, and said in words: a
                       hidden edge looks like no edge, and `ac docs check` is
                       what fails for it. */
                    <Item size="sm">
                      <ItemMedia>
                        <IconTile name="doc" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>
                          <span className="text-muted-foreground line-through">{link.title}</span>
                        </ItemTitle>
                        <ItemDescription>{`In ${link.repo}, which is not in this checkout`}</ItemDescription>
                      </ItemContent>
                    </Item>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </aside>
  );
}

export default DocLinks;
