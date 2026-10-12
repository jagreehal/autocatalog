/** @jsxImportSource react */
import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { Separator } from '#ui/components/ui/separator.tsx';
import type { ResourceLink } from '../../about';
import { kindIcon } from '../../icons';
import { DocLinks, type DocLink } from '../components/DocLinks';
import { Icon } from '../components/Icon';
import { ResourceLinks } from '../components/ResourceLinks';
import { SourceLinks } from '../components/SourceLinks';
import { IconTile } from '../components/IconTile';

/** A resource its repository defines by convention, ready to link to. */
export interface DefinedResource {
  kind: string;
  id: string;
  title: string;
  href: string;
}

export interface DocFooterChromeProps {
  /** The site's base path, ending in a slash. */
  base: string;
  siteTitle: string;
  /** The team that owns the document, as written. */
  owner?: string;
  /** Where the owner's page is, when the catalog knows the team. */
  ownerHref?: string;
  /** Whether the manifest knows the document; the meta row shows for it or an owner. */
  known: boolean;
  /** The last change, already formatted; absent when git could not say. */
  changed?: string | null;
  source?: string | null;
  edit?: string | null;
  related: DocLink[];
  linkedFrom: DocLink[];
  /** What the catalog says is about this document. */
  about: ResourceLink[];
  /** The repository the document is published from. */
  repository: string;
  defined: DefinedResource[];
  /** Starlight's own footer (edit link, last updated, pagination). */
  children?: ReactNode;
}

/**
 * Ownership, freshness and the two link directions are facts about a document
 * that Starlight has nowhere to put, so they go below the article, then the
 * quiet last row: whose site this is, and the machine-readable twins.
 */
export function DocFooterChrome({
  base,
  siteTitle,
  owner,
  ownerHref,
  known,
  changed,
  source,
  edit,
  related,
  linkedFrom,
  about,
  repository,
  defined,
  children,
}: DocFooterChromeProps) {
  return (
    <>
      {(owner || known) && (
        <div className="mt-8 flex flex-col gap-4">
          <Separator />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {owner && (
              <span>
                Owned by{' '}
                <strong>
                  {ownerHref ? (
                    <a
                      href={ownerHref}
                      className="text-foreground underline underline-offset-4 hover:text-primary"
                    >
                      {owner}
                    </a>
                  ) : (
                    owner
                  )}
                </strong>
              </span>
            )}
            <span>{changed ? `Last changed ${changed}` : 'Last change unknown'}</span>
            <SourceLinks source={source} edit={edit} />
          </div>
        </div>
      )}

      <DocLinks related={related} linkedFrom={linkedFrom} />

      {about.length > 0 && (
        <div className="mt-4">
          <ResourceLinks id="about" heading="About" links={about} />
        </div>
      )}

      {defined.length > 0 && (
        <aside className="mt-4" aria-labelledby="ac-catalog-connections-title">
          <Card>
            <CardHeader>
              <CardTitle id="ac-catalog-connections-title" role="heading" aria-level={2}>
                Repository catalog
              </CardTitle>
              <CardDescription>
                <strong className="text-foreground">{repository}</strong>
                {` also defines ${defined.length} ${defined.length === 1 ? 'resource' : 'resources'} by convention.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Rows bleed into the card's padding, so their text lines up with its title. */}
              <ul className="-mx-3 m-0 flex list-none flex-col gap-1 p-0">
                {defined.map((resource) => (
                  <li key={`${resource.kind}/${resource.id}`} data-kind={resource.kind}>
                    <Item size="sm" href={resource.href}>
                      <ItemMedia>
                        <IconTile name={kindIcon(resource.kind)} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{resource.title}</ItemTitle>
                        <ItemDescription>
                          <code className="font-mono">{`${resource.kind}/${resource.id}`}</code>
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="self-start">
                        <Icon
                          name="external"
                          className="size-4 text-muted-foreground group-hover/item:text-foreground"
                        />
                      </ItemActions>
                    </Item>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <a
                href={`${base}catalog.json`}
                className="text-xs text-foreground underline underline-offset-4 hover:text-primary"
              >
                Inspect these connections as JSON
              </a>
            </CardFooter>
          </Card>
        </aside>
      )}

      {children}

      {/* Starlight's own footer is the landmark; this sits inside its region. */}
      <div className="mt-10 flex flex-col gap-4 text-xs text-muted-foreground">
        <Separator />
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 pb-2">
          <span>{siteTitle}</span>
          <nav aria-label="Machine-readable" className="flex gap-4">
            {['llms.txt', 'catalog.json'].map((file) => (
              <a
                key={file}
                href={`${base}${file}`}
                className="font-mono text-muted-foreground no-underline underline-offset-4 hover:text-foreground hover:underline"
              >
                {file}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

export default DocFooterChrome;
