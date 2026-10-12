/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '#ui/components/ui/item.tsx';

export interface ResourceLinksProps {
  id: string;
  heading: string;
  links: Array<{ href: string; title: string; label: string }>;
}

/** A card of links; nothing at all when there are none. */
export function ResourceLinks({ id, heading, links }: ResourceLinksProps) {
  if (links.length === 0) return null;

  return (
    <div className="not-content">
      <Card id={id}>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {heading}
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground">{`${links.length} ${links.length === 1 ? 'link' : 'links'}`}</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {/* Rows bleed into the card's padding, so their text lines up with its title. */}
          <ul className="-mx-3 m-0 flex list-none flex-col gap-1 p-0" data-links={id}>
            {links.map((link) => (
              <li key={`${link.href}|${link.label}`}>
                <Item size="sm" href={link.href}>
                  <ItemContent>
                    <ItemTitle>{link.title}</ItemTitle>
                    {/* A repository or a resource's key: literally code either way. */}
                    <ItemDescription>
                      <span className="font-mono">{link.label}</span>
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="self-start">
                    <ArrowUpRightIcon
                      aria-hidden="true"
                      className="size-4 text-muted-foreground group-hover/item:text-foreground"
                    />
                  </ItemActions>
                </Item>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default ResourceLinks;
