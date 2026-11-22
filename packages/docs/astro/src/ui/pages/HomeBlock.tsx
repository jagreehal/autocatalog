/** @jsxImportSource react */
import { SearchIcon } from 'lucide-react';
import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
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
import { Button, LinkButton } from '#ui/components/ui/button.tsx';
import { Kbd } from '#ui/components/ui/kbd.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import type { AttentionSnapshot } from '../../attention';
import { kindIcon } from '../../icons';
import type { IconName } from '../../icons';
import { hasAttention } from '../../attention';
import { day, docHref } from '../lib/docs';
import { CountCards } from '../components/CountCards';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { DocList } from '../components/DocList';
import type { DocListItem } from '../components/DocList';
import { Graph } from '../components/Graph';
import { Icon } from '../components/Icon';
import { IconTile } from '../components/IconTile';
import { SectionHeading } from '../components/SectionHeading';
import { SiteSearch } from '../overrides/SiteSearch';
import type { Stat } from '../components/Stats';
import type { VisualiserGraph } from '../lib/visualiser';
import type { ExploreCard, HomePageProps } from './HomePage';

/** One thing that changed lately, with the day git last saw it change. */
export interface RecentChange {
  /** What it is, as a reader says it: `Event`, `Document`. */
  kind: string;
  icon: IconName;
  title: string;
  href: string;
  repository: string;
  /** ISO date of the newest commit to its file or folder. */
  updated: string;
}

type Source = 'extracted' | 'declared' | 'inferred';

/** How many of the catalog's facts each source gave: resources, and the relationships between them. */
export interface CatalogProvenance {
  resources: Partial<Record<Source, number>>;
  relationships: Partial<Record<Source, number>>;
}

/** A built-in block of a home layout, with the catalog's data it shows already chosen. */
export type HomeBlockData =
  | {
      block: 'search';
      /** The search page of a site that renders per request; absent, the header's search dialog. */
      action?: string | undefined;
    }
  | {
      block: 'provenance';
      title?: string | undefined;
      provenance?: CatalogProvenance | undefined;
      attention?: AttentionSnapshot | undefined;
    }
  | { block: 'browse'; title?: string | undefined; stats: Array<Stat> }
  | {
      block: 'hero';
      title?: string | undefined;
      text?: string | undefined;
      actions: Array<{ label: string; href: string }>;
    }
  | { block: 'cards' | 'apis' | 'explore'; title?: string | undefined; cards: Array<ExploreCard> }
  | { block: 'countCards'; stats: Array<Stat> }
  | {
      block: 'docs';
      title?: string | undefined;
      /** One folder's documents, as a list. */
      items?: Array<DocListItem> | undefined;
      /** Every document, on a shelf per repository. */
      repos?: HomePageProps['repos'] | undefined;
    }
  | {
      block: 'graph';
      title?: string | undefined;
      map?: VisualiserGraph | undefined;
      catalogHref?: string | undefined;
    }
  | { block: 'recent'; title?: string | undefined; items: Array<RecentChange> }
  | { block: 'attention'; attention?: AttentionSnapshot | undefined }
  | { block: 'tags'; title?: string | undefined; tags: HomePageProps['tags'] };

/** Each block's heading id, so links into the home page keep working whatever the layout. */
const SECTION_ID = new Map<string, string>(
  Object.entries({
    search: 'home-search',
    provenance: 'home-provenance',
    browse: 'home-browse',
    hero: 'home-hero',
    cards: 'home-cards',
    apis: 'home-apis',
    explore: 'home-explore',
    countCards: 'home-counts',
    docs: 'home-documents',
    graph: 'home-architecture',
    recent: 'home-recent',
    attention: 'home-attention',
    tags: 'home-by-tag',
  } satisfies Record<HomeBlockData['block'], string>),
);

/** The heading id of each block in a layout: the block's own, then numbered for a second of a kind. */
export function blockIds(blocks: Array<{ block: string }>): Array<string> {
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
    case 'search':
      return block.action !== undefined ? (
        <div className="not-content">
          <SiteSearch action={block.action} label={SEARCH_LABEL} />
        </div>
      ) : (
        <SearchField />
      );
    case 'provenance':
      if (block.provenance && total(block.provenance.resources) > 0) {
        return (
          <ProvenanceCard
            id={id}
            title={block.title ?? 'Where the catalog’s facts come from'}
            provenance={block.provenance}
            attention={block.attention}
          />
        );
      }

      // With nothing to count, what needs attention (a repository that failed
      // its scan, say) is still the first thing to know.
      return block.attention && hasAttention(block.attention) ? (
        <Attention id={id} attention={block.attention} />
      ) : null;
    case 'browse':
      return block.stats.some(({ value }) => value > 0) ? (
        <Section id={id} title={block.title ?? 'Browse by type'}>
          <BrowseByType stats={block.stats} />
        </Section>
      ) : null;
    case 'hero':
      return (
        <section
          className="not-content flex flex-col gap-4"
          aria-labelledby={block.title !== undefined ? id : undefined}
        >
          {block.title !== undefined && (
            <h2 id={id} className="m-0 text-3xl font-semibold tracking-tight">
              {block.title}
            </h2>
          )}
          {block.text !== undefined && (
            <p className="m-0 max-w-prose text-muted-foreground">{block.text}</p>
          )}
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
            block.catalogHref !== undefined ? (
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
    case 'recent':
      return block.items.length > 0 ? (
        <Section id={id} title={block.title ?? 'Recently changed'}>
          <Card>
            <CardContent>
              <ul className="not-content -mx-3 m-0 flex list-none flex-col gap-1 p-0">
                {block.items.map((item) => (
                  <li key={item.href}>
                    <Item size="sm" href={item.href}>
                      <ItemMedia>
                        <IconTile name={item.icon} kind={item.kind.toLowerCase()} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{item.title}</ItemTitle>
                        <ItemDescription>
                          {`${item.kind} in ${item.repository}, updated ${day(item.updated) ?? ''}`}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
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

/** What needs doing, each a count and a link to where to do it. */
function attentionItems(attention: AttentionSnapshot) {
  return [
    attention.needsReview > 0 && {
      label: `${attention.needsReview} need review`,
      href: attention.needsReviewHref,
    },
    attention.failures.length > 0 && {
      label: `${attention.failures.length} ${attention.failures.length === 1 ? 'repository' : 'repositories'} left out`,
      href: attention.catalogHref,
    },
    attention.orphanProducers > 0 && {
      label: `${attention.orphanProducers} events with no producer`,
      href: attention.catalogHref,
    },
    attention.orphanConsumers > 0 && {
      label: `${attention.orphanConsumers} events with no consumer`,
      href: attention.catalogHref,
    },
    attention.unowned > 0 && {
      label: `${attention.unowned} unowned`,
      href: attention.ownersHref,
    },
  ].filter((item): item is { label: string; href: string } => Boolean(item));
}

function AttentionLinks({
  attention,
  layout = 'row',
}: {
  attention: AttentionSnapshot;
  layout?: 'row' | 'column';
}) {
  return (
    <ul
      className={`m-0 flex list-none gap-3 p-0 text-sm ${layout === 'row' ? 'flex-wrap' : 'flex-col gap-1.5'}`}
    >
      {attentionItems(attention).map((item) => (
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
  );
}

/** Dark spots: review work, quarantine, missing producers/consumers/owners. */
function Attention({ id, attention }: { id: string; attention: AttentionSnapshot }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id} data-attention="">
      <SectionHeading id={id}>Needs attention</SectionHeading>
      <AttentionLinks attention={attention} />
      <Failures attention={attention} />
    </section>
  );
}

/** Which repositories the catalog left out, and why: the first few, so the page stays short. */
function Failures({ attention }: { attention: AttentionSnapshot }) {
  return attention.failures.length > 0 ? (
    <ul className="m-0 list-none p-0 text-xs text-muted-foreground">
      {attention.failures.slice(0, 5).map((failure) => (
        <li key={failure.repository}>
          {failure.repository}: {failure.message}
        </li>
      ))}
    </ul>
  ) : null;
}

/** Cards that each lead somewhere: Explore, and a layout's cards and APIs. */
export function CardGrid({ cards }: { cards: Array<ExploreCard> }) {
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
          {href !== undefined ? (
            <a href={href} className="text-foreground underline-offset-4 hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </CardTitle>
        {description !== undefined && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <span className="text-xs text-muted-foreground">{count}</span>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default HomeBlock;

const SEARCH_LABEL = 'Search events, services, schemas and owners';

/** Starlight's own search dialog: the header's button opens it, and so does this one. */
const openSearch = () =>
  document.querySelector<HTMLButtonElement>('site-search button[data-open-modal]')?.click();

/** The page's one search field: the same search as the header's, across the page. */
function SearchField() {
  return (
    <div className="not-content">
      <Button
        variant="outline"
        size="lg"
        onPress={openSearch}
        className="h-12 w-full justify-start"
        data-home-search=""
      >
        <SearchIcon aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
          {SEARCH_LABEL}
        </span>
        <Kbd className="max-sm:hidden">⌘K</Kbd>
      </Button>
    </div>
  );
}

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every kind the catalog holds: its hue, name and count, each a link to its list. */
function BrowseByType({ stats }: { stats: Array<Stat> }) {
  return (
    <ul
      aria-label="Browse by type"
      className="not-content m-0 grid list-none gap-1 p-0 sm:grid-cols-2 lg:grid-cols-3"
    >
      {stats
        .filter(({ value }) => value > 0)
        .map((stat) => (
          <li key={stat.label}>
            <Item size="sm" href={stat.href}>
              <ItemMedia>
                <IconTile name={kindIcon(stat.kind ?? stat.label)} kind={stat.kind} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{sentenceCase(stat.label)}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {stat.value.toLocaleString('en-GB')}
                </span>
              </ItemActions>
            </Item>
          </li>
        ))}
    </ul>
  );
}

const SOURCES: Array<{ source: Source; name: string; means: string; colour: string }> = [
  {
    source: 'extracted',
    name: 'Extracted',
    means: 'read from code and contracts',
    colour: 'bg-extracted',
  },
  {
    source: 'declared',
    name: 'Declared',
    means: 'written down by their owners',
    colour: 'bg-declared',
  },
  {
    source: 'inferred',
    name: 'Inferred',
    means: 'worked out from other facts',
    colour: 'bg-inferred',
  },
];

const total = (counts: CatalogProvenance['resources']) =>
  SOURCES.reduce((sum, { source }) => sum + (counts[source] ?? 0), 0);

const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

/** One bar of where facts come from, and its three figures said in words. */
function SourceBar({ counts, noun }: { counts: CatalogProvenance['resources']; noun: string }) {
  const all = total(counts);

  const said = SOURCES.map(
    ({ source, name }) => `${name} ${counts[source] ?? 0} (${percent(counts[source] ?? 0, all)}%)`,
  ).join(', ');

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm">
        <span className="font-semibold tabular-nums">{all.toLocaleString('en-GB')}</span> {noun}
      </p>
      <div
        role="img"
        aria-label={`${all} ${noun}: ${said}`}
        className="flex h-2.5 overflow-hidden rounded-full bg-muted"
      >
        {SOURCES.map(({ source, colour }) =>
          (counts[source] ?? 0) > 0 ? (
            <span
              key={source}
              className={`w-(--ac-share) ${colour}`}
              // SAFETY: a custom property is a valid inline style; React's type lists only standard ones.
              style={{ '--ac-share': `${((counts[source] ?? 0) / all) * 100}%` } as CSSProperties}
            />
          ) : null,
        )}
      </div>
      <ul className="not-content m-0 grid list-none gap-2 p-0 text-sm sm:grid-cols-3">
        {SOURCES.map(({ source, name, means, colour }) => (
          <li key={source} className="flex items-start gap-2">
            <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${colour}`} />
            <span>
              <span className="font-medium">
                {name} <span className="tabular-nums">{percent(counts[source] ?? 0, all)}%</span>
              </span>
              <span className="block text-muted-foreground">{means}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How sure the catalog is: where its facts come from, beside what needs doing. */
function ProvenanceCard({
  id,
  title,
  provenance,
  attention,
}: {
  id: string;
  title: string;
  provenance: CatalogProvenance;
  attention?: AttentionSnapshot | undefined;
}) {
  const todo = attention && hasAttention(attention) ? attention : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} id={id}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8 lg:grid-cols-4">
          <div className="flex flex-col gap-6 lg:col-span-3">
            <SourceBar counts={provenance.resources} noun="resources" />
            {total(provenance.relationships) > 0 && (
              <SourceBar counts={provenance.relationships} noun="relationships" />
            )}
          </div>
          {todo && (
            <div className="flex flex-col gap-2 lg:border-l lg:pl-8" data-attention="">
              <p className="m-0 text-sm font-semibold">Needs attention</p>
              <AttentionLinks attention={todo} layout="column" />
              <Failures attention={todo} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
