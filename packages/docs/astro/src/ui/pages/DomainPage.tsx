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

interface Linked {
  name: string;
  href: string;
  summary?: string | undefined;
}

export interface DomainPageProps {
  /** Its name, from its overview file, else its id. */
  title?: string | undefined;
  /** What the domain is for, when a record of it says. */
  summary?: string | undefined;
  /** Domains whose overview names this one as `parent`. */
  subdomains?: Linked[] | undefined;
  /** Systems with at least one of the domain's services in them. */
  systems?: Array<Linked & { members: number }> | undefined;
  /** The APIs the domain's services serve. */
  contracts?: Linked[] | undefined;
  entities?: Linked[] | undefined;
  flows?: Linked[] | undefined;
  /** Documents whose `about:` names the domain. */
  documents?: Array<{ name: string; href: string; kind?: string | undefined }> | undefined;
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

const linkedRows = (items: Linked[] | undefined, kind: IconName): Row[] =>
  (items ?? []).map((item) => ({
    key: item.href,
    title: item.name,
    href: item.href,
    description: item.summary,
    kind,
  }));

/**
 * A domain: its overview, then what is in it
 * (subdomains, systems, services, events, contracts, entities, flows and the
 * documents about it), then the map and its owners.
 */
export function DomainPage({
  subdomains,
  systems,
  contracts,
  entities,
  flows,
  documents,
  events,
  services,
  owners,
  visualiser,
}: DomainPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      {/* The summary is the page's description, under its title; this says what is here. */}
      <p className="m-0 max-w-prose">
        {count(events.length, 'event', 'events')} and{' '}
        {count(services.length, 'service', 'services')} around them.
      </p>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <Section
          id="subdomains"
          heading="Subdomains"
          total={count(subdomains?.length ?? 0, 'subdomain', 'subdomains')}
          rows={linkedRows(subdomains, 'domain')}
        />
        <Section
          id="systems"
          heading="Systems"
          total={count(systems?.length ?? 0, 'system', 'systems')}
          rows={(systems ?? []).map((system) => ({
            key: system.href,
            title: system.name,
            href: system.href,
            description: system.summary ?? count(system.members, 'service', 'services'),
            kind: 'architecture',
          }))}
        />
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
        <Section
          id="contracts"
          heading="Contracts"
          total={count(contracts?.length ?? 0, 'API', 'APIs')}
          rows={linkedRows(contracts, 'api')}
        />
        <Section
          id="entities"
          heading="Entities"
          total={count(entities?.length ?? 0, 'entity', 'entities')}
          rows={linkedRows(entities, 'entity')}
        />
        <Section
          id="flows"
          heading="Flows"
          total={count(flows?.length ?? 0, 'flow', 'flows')}
          rows={linkedRows(flows, 'flow')}
        />
        <Section
          id="documents"
          heading="Guides and runbooks"
          total={count(documents?.length ?? 0, 'document', 'documents')}
          rows={(documents ?? []).map((doc) => ({
            key: doc.href,
            title: doc.name,
            href: doc.href,
            kind: doc.kind === 'runbook' ? 'runbook' : doc.kind === 'adr' ? 'decision' : 'doc',
          }))}
        />
      </div>

      <Graph id="domain-map" label="Domain map" visualiser={visualiser} height="30rem" />

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
  );
}

export default DomainPage;
