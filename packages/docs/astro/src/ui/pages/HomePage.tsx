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
import type { IconName } from '../../icons';
import { DocList, type DocListItem } from '../components/DocList';
import { SectionHeading } from '../components/SectionHeading';
import { Icon } from '../components/Icon';
import type { Stat } from '../components/Stats';
import { IconTile } from '../components/IconTile';

/** One way into the catalog this build actually made. */
export interface ExploreCard {
  title: string;
  text: string;
  href: string;
  icon: IconName;
  kind?: string;
}

export interface HomePageProps {
  stats: Stat[];
  explore: ExploreCard[];
  /** Repositories in name order, each with the documents it publishes. */
  repos: Array<[string, DocListItem[]]>;
  /** Tags in name order; empty when no document is tagged. */
  tags: Array<[string, DocListItem[]]>;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const documents = (count: number) => plural(count, 'document', 'documents');

export function HomePage({ stats, explore, repos, tags }: HomePageProps) {
  const total = repos.reduce((sum, [, docs]) => sum + docs.length, 0);

  // Built as one string: adjacent expressions in the template lose the whitespace
  // between them, which is how "5documents" gets shipped.
  const counted = `${documents(total)} from ${plural(repos.length, 'repository', 'repositories')}`;

  return (
    <div className="not-content flex flex-col gap-10" data-wide>
      {stats.some((stat) => stat.value > 0) && <Holds stats={stats} />}

      <section className="flex flex-col gap-4" aria-labelledby="home-explore">
        <SectionHeading id="home-explore" count={plural(explore.length, 'place', 'places')}>
          Explore
        </SectionHeading>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {explore.map((card) => (
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
                      <CardDescription>{card.text}</CardDescription>
                    </div>
                  </CardContent>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="home-documents">
        <SectionHeading id="home-documents" count={total > 0 ? counted : undefined}>
          Documents
        </SectionHeading>
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
            {repos.map(([repo, docs]) => (
              <Shelf key={repo} title={repo} count={documents(docs.length)}>
                <DocList items={docs} />
              </Shelf>
            ))}
          </div>
        )}
      </section>

      {tags.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="home-by-tag">
          <SectionHeading id="home-by-tag" count={plural(tags.length, 'tag', 'tags')}>
            By tag
          </SectionHeading>
          <div className="grid items-start gap-4 md:grid-cols-2">
            {tags.map(([tag, docs]) => (
              <Shelf key={tag} title={tag} count={documents(docs.length)}>
                <DocList items={docs} showRepo />
              </Shelf>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** What the catalog holds, said as a sentence; a count with a page links to it. */
function Holds({ stats }: { stats: Stat[] }) {
  return (
    <p className="m-0 max-w-prose text-sm text-muted-foreground">
      The catalog holds{' '}
      {stats.map((stat, index) => (
        <Fragment key={stat.label}>
          {index > 0 && (index === stats.length - 1 ? ' and ' : ', ')}
          {stat.href ? (
            <a
              href={stat.href}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              {`${stat.value} ${stat.label}`}
            </a>
          ) : (
            <span className="text-foreground">{`${stat.value} ${stat.label}`}</span>
          )}
        </Fragment>
      ))}
      .
    </p>
  );
}

/** A repository or a tag, and the documents under it. */
function Shelf({ title, count, children }: { title: string; count: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={3}>
          {title}
        </CardTitle>
        <CardAction>
          <span className="text-xs text-muted-foreground">{count}</span>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default HomePage;
