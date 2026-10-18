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
import type { IconName } from '../../icons';
import type { VisualiserGraph } from '../lib/visualiser';
import { Graph } from '../components/Graph';
import { IconTile } from '../components/IconTile';

export interface DomainPageProps {
  /** What the domain is for, when a record of it says. */
  summary?: string | undefined;
  events: Array<{
    name: string;
    id: string;
    href: string;
    summary?: string | undefined;
    /** Named only when two repositories publish an event with this id. */
    repository?: string | undefined;
  }>;
  /** Each service that produces or consumes one of the domain's events, and how many of each. */
  services: Array<{ name: string; href: string; produces: number; consumes: number }>;
  owners: Array<{ team: string; href?: string | undefined }>;
  visualiser?: VisualiserGraph | undefined;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Produces 2 events and consumes 1", leaving out a side it has none of. */
const roles = ({ produces, consumes }: { produces: number; consumes: number }) =>
  [
    produces && `produces ${count(produces, 'event', 'events')}`,
    consumes && `consumes ${count(consumes, 'event', 'events')}`,
  ]
    .filter(Boolean)
    .join(' and ')
    .replace(/^./, (first) => first.toUpperCase());

interface Row {
  key: string;
  title: string;
  href?: string | undefined;
  description?: string | undefined;
  kind: IconName;
}

function Section({
  id,
  heading,
  total,
  rows,
}: {
  id: string;
  heading: string;
  total: string;
  rows: Row[];
}) {
  if (rows.length === 0) return null;

  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {heading}
        </CardTitle>
        <CardAction>
          <span className="text-muted-foreground">{total}</span>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((row) => (
            <li key={row.key}>
              {/* Item is a link only when it is given an href at all. */}
              <Item {...(row.href && { href: row.href })} size="sm" data-kind={row.kind}>
                <ItemMedia>
                  <IconTile name={row.kind} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{row.title}</ItemTitle>
                  {row.description && <ItemDescription>{row.description}</ItemDescription>}
                </ItemContent>
                {row.href && (
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
      </CardContent>
    </Card>
  );
}

export function DomainPage({ summary, events, services, owners, visualiser }: DomainPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <p className="m-0 max-w-prose">
        {summary && `${summary} `}
        {count(events.length, 'event', 'events')} and{' '}
        {count(services.length, 'service', 'services')} around them.
      </p>

      <Graph id="domain-map" label="Domain map" visualiser={visualiser} height="30rem" />

      <div className="grid items-start gap-6 md:grid-cols-2">
        <Section
          id="events"
          heading="Events"
          total={count(events.length, 'event', 'events')}
          rows={events.map((event) => ({
            key: event.href,
            title: event.name,
            href: event.href,
            description: event.repository
              ? `${event.summary ?? event.id}, from the ${event.repository} repository`
              : (event.summary ?? event.id),
            kind: 'event',
          }))}
        />
        <div className="flex flex-col gap-6">
          <Section
            id="services"
            heading="Services"
            total={count(services.length, 'service', 'services')}
            rows={services.map((service) => ({
              key: service.href,
              title: service.name,
              href: service.href,
              description: roles(service),
              kind: 'service',
            }))}
          />
          <Section
            id="owners"
            heading="Owners"
            total={count(owners.length, 'team', 'teams')}
            rows={owners.map((owner) => ({
              key: owner.team,
              title: owner.team,
              href: owner.href,
              kind: 'owners',
            }))}
          />
        </div>
      </div>
    </div>
  );
}

export default DomainPage;
