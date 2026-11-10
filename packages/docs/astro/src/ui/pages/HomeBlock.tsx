/** @jsxImportSource react */
import { Fragment, type ReactNode } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Badge } from '#ui/components/ui/badge.tsx';
import { LinkButton } from '#ui/components/ui/button.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import type { AttentionSnapshot } from '../../attention';
import { hasAttention } from '../../attention';
import { docHref } from '../lib/docs';
import { CountCards } from '../components/CountCards';
import { DocList, type DocListItem } from '../components/DocList';
import { Graph } from '../components/Graph';
import { Icon } from '../components/Icon';
import { IconTile } from '../components/IconTile';
import { SectionHeading } from '../components/SectionHeading';
import type { Stat } from '../components/Stats';
import type { VisualiserGraph } from '../lib/visualiser';
import type { ExploreCard, HomePageProps } from './HomePage';

/** A built-in block of a home layout, with the catalog's data it shows already chosen. */
export type HomeBlockData =
  | {
      block: 'hero';
      title?: string | undefined;
      text?: string | undefined;
      actions: Array<{ label: string; href: string }>;
    }
  | { block: 'cards' | 'apis' | 'explore'; title?: string | undefined; cards: ExploreCard[] }
  | { block: 'countCards'; stats: Stat[] }
  | {
      block: 'docs';
      title?: string | undefined;
      /** One folder's documents, as a list. */
      items?: DocListItem[] | undefined;
      /** Every document, on a shelf per repository. */
      repos?: HomePageProps['repos'] | undefined;
    }
  | {
      block: 'graph';
      title?: string | undefined;
      map?: VisualiserGraph | undefined;
      catalogHref?: string | undefined;
    }
  | { block: 'attention'; attention?: AttentionSnapshot | undefined }
  | { block: 'tags'; title?: string | undefined; tags: HomePageProps['tags'] };

/** Each block's heading id, so links into the home page keep working whatever the layout. */
const SECTION_ID = new Map<string, string>(
  Object.entries({
    hero: 'home-hero',
    cards: 'home-cards',
    apis: 'home-apis',
    explore: 'home-explore',
    countCards: 'home-counts',
    docs: 'home-documents',
    graph: 'home-architecture',
    attention: 'home-attention',
    tags: 'home-by-tag',
  } satisfies Record<HomeBlockData['block'], string>),
);

/** The heading id of each block in a layout: the block's own, then numbered for a second of a kind. */
export function blockIds(blocks: Array<{ block: string }>): string[] {
  const seen = new Map<string, number>();

  return blocks.map(({ block }) => {
    const id = SECTION_ID.get(block) ?? `home-${block}`;
    const count = seen.get(id) ?? 0;

    seen.set(id, count + 1);

    return count === 0 ? id : `${id}-${count + 1}`;
  });
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const documents = (count: number) => plural(count, 'document', 'documents');

/** Enough to show what a repository holds; the rest stay a click away. */
const SHELF_SIZE = 5;

const Section = ({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: ReactNode;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-4" aria-labelledby={id}>
    <SectionHeading id={id} count={count}>
      {title}
    </SectionHeading>
    {children}
  </section>
);

/** One block of the home page. `id` is its heading's, from `blockIds`. */
export function HomeBlock({ block, id }: { block: HomeBlockData; id: string }) {
  switch (block.block) {
    case 'hero':
      return (
        <section
          className="not-content flex flex-col gap-4"
          aria-labelledby={block.title ? id : undefined}
        >
          {block.title && (
            <h2 id={id} className="m-0 text-3xl font-semibold tracking-tight">
              {block.title}
            </h2>
          )}
          {block.text && <p className="m-0 max-w-prose text-muted-foreground">{block.text}</p>}
          {block.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {block.actions.map((action, i) => (
                <LinkButton
                  key={action.href}
                  variant={i === 0 ? 'default' : 'outline'}
                  href={action.href}
                >
                  {action.label}
                </LinkButton>
              ))}
            </div>
          )}
        </section>
      );
    case 'cards':
    case 'apis':
    case 'explore':
      return block.cards.length > 0 ? (
        <Section
          id={id}
          title={block.title ?? (block.block === 'apis' ? 'APIs' : 'Explore')}
          count={
            block.block === 'explore' ? plural(block.cards.length, 'place', 'places') : undefined
          }
        >
          <CardGrid cards={block.cards} />
        </Section>
      ) : null;
    case 'countCards':
      return <CountCards items={block.stats} />;
    case 'docs':
      return block.repos ? (
        <Shelves id={id} title={block.title ?? 'Documents'} repos={block.repos} />
      ) : (block.items ?? []).length > 0 ? (
        <Section id={id} title={block.title ?? 'Documents'}>
          <DocList items={block.items ?? []} />
        </Section>
      ) : null;
    case 'graph':
      return block.map ? (
        <Section
          id={id}
          title={block.title ?? 'Architecture'}
          count={
            block.catalogHref ? (
              <a
                href={block.catalogHref}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Open full screen
              </a>
            ) : undefined
          }
        >
          <Graph
            id={`${id}-map`}
            label={block.title ?? 'Architecture'}
            visualiser={block.map}
            height="30rem"
          />
        </Section>
      ) : null;
    case 'attention':
      return block.attention && hasAttention(block.attention) ? (
        <Attention id={id} attention={block.attention} />
      ) : null;
    case 'tags':
      return block.tags.length > 0 ? (
        <Tags id={id} title={block.title ?? 'By tag'} tags={block.tags} />
      ) : null;
  }
}

/** Every document, a shelf per repository, the first few on show. */
function Shelves({
  id,
  title,
  repos,
}: {
  id: string;
  title: string;
  repos: HomePageProps['repos'];
}) {
  const total = repos.reduce((sum, { docs }) => sum + docs.length, 0);

  // Built as one string: adjacent expressions in the template lose the whitespace
  // between them, which is how "5documents" gets shipped.
  // One repository goes unnamed: a public site's readers never see repositories.
  const counted =
    repos.length > 1 ? `${documents(total)} from ${repos.length} repositories` : documents(total);

  return (
    <Section id={id} title={title} count={total > 0 ? counted : undefined}>
      {repos.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="doc" />
            </EmptyMedia>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              Commit Markdown to a <code>docs/</code> folder in an enrolled repository and it
              appears here on the next build.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {repos.map(({ name, label, description, href, docs }) => (
            <Shelf
              key={name}
              title={label}
              href={href}
              description={description}
              count={documents(docs.length)}
            >
              <DocList items={docs.slice(0, SHELF_SIZE)} />
              {docs.length > SHELF_SIZE && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    All {docs.length} documents
                  </summary>
                  <DocList items={docs.slice(SHELF_SIZE)} />
                </details>
              )}
            </Shelf>
          ))}
        </div>
      )}
    </Section>
  );
}

function Tags({ id, title, tags }: { id: string; title: string; tags: HomePageProps['tags'] }) {
  return (
    <Section id={id} title={title} count={plural(tags.length, 'tag', 'tags')}>
      <Card>
        <CardContent>
          <Table aria-label="Documents by tag">
            <TableHeader>
              <TableHead isRowHeader>Tag</TableHead>
              <TableHead>Documents</TableHead>
            </TableHeader>
            <TableBody>
              {tags.map(([tag, docs]) => (
                <TableRow key={tag} id={tag}>
                  <TableCell className="w-40 align-top">
                    <Badge variant="secondary">{tag}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {docs.map((doc, index) => (
                      <Fragment key={doc.id}>
                        {index > 0 && ', '}
                        <a
                          href={docHref(doc.id)}
                          className="text-foreground underline-offset-4 hover:underline"
                        >
                          {doc.title}
                        </a>
                      </Fragment>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Section>
  );
}

/** Dark spots: review work, quarantine, missing producers/consumers/owners. */
function Attention({ id, attention }: { id: string; attention: AttentionSnapshot }) {
  const items = [
    attention.needsReview > 0 && {
      label: `${attention.needsReview} need review`,
      href: attention.needsReviewHref,
    },
    attention.failures.length > 0 && {
      label: `${attention.failures.length} quarantined`,
      href: attention.catalogHref,
    },
    attention.orphanProducers > 0 && {
      label: `${attention.orphanProducers} with no producer`,
      href: attention.catalogHref,
    },
    attention.orphanConsumers > 0 && {
      label: `${attention.orphanConsumers} with no consumer`,
      href: attention.catalogHref,
    },
    attention.unowned > 0 && {
      label: `${attention.unowned} unowned`,
      href: attention.ownersHref,
    },
  ].filter((item): item is { label: string; href: string } => Boolean(item));

  return (
    <section className="flex flex-col gap-2" aria-labelledby={id} data-attention="">
      <SectionHeading id={id}>Needs attention</SectionHeading>
      <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-sm">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      {attention.failures.length > 0 && (
        <ul className="m-0 list-none p-0 text-xs text-muted-foreground">
          {attention.failures.slice(0, 5).map((failure) => (
            <li key={failure.repository}>
              {failure.repository}: {failure.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Cards that each lead somewhere: Explore, and a layout's cards and APIs. */
export function CardGrid({ cards }: { cards: ExploreCard[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <li key={card.title} className="flex" data-kind={card.kind}>
          <a
            href={card.href}
            className="group flex w-full rounded-xl no-underline outline-none hover:ring-2 hover:ring-ring/40 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="w-full">
              <CardHeader>
                <IconTile name={card.icon} size="md" />
                <CardAction>
                  <Icon
                    name="external"
                    className="size-4 text-muted-foreground group-hover:text-foreground"
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1.5">
                  <CardTitle>{card.title}</CardTitle>
                  {card.text && <CardDescription>{card.text}</CardDescription>}
                </div>
              </CardContent>
            </Card>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Shelf({
  title,
  href,
  description,
  count,
  children,
}: {
  title: string;
  href?: string | undefined;
  description?: string | undefined;
  count: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          {href ? (
            <a href={href} className="text-foreground underline-offset-4 hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <span className="text-xs text-muted-foreground">{count}</span>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default HomeBlock;
