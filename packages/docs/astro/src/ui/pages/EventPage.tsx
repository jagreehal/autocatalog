/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '#ui/components/ui/item.tsx';
import { kindIcon } from '../../icons';
import { Icon } from '../components/Icon';
import { IconTile } from '../components/IconTile';
import type { PropNode } from '../lib/schema-tree';
import type { VisualiserGraph } from '../lib/visualiser';
import { EventCatalogDiagram } from '../components/EventCatalogDiagram';
import type { EventCatalogDiagramProps } from '../components/EventCatalogDiagram';
import { EventVersions } from '../components/EventVersions';
import type { EventVersionsProps } from '../components/EventVersions';
import { Evidence } from '../components/Evidence';
import type { EvidenceView } from '../components/Evidence';
import { Examples } from '../components/Examples';
import type { ExampleView } from '../components/Examples';
import { FlowStrip } from '../components/FlowStrip';
import type { FlowStripProps } from '../components/FlowStrip';
import { Graph } from '../components/Graph';
import { ResourceLinks } from '../components/ResourceLinks';
import type { ResourceLinksProps } from '../components/ResourceLinks';
import { RuntimeEvidence } from '../components/RuntimeEvidence';
import type { RuntimeEvidenceView } from '../components/RuntimeEvidence';
import { SchemaSection } from '../components/SchemaTree';
import { SourceLinks } from '../components/SourceLinks';
import { StatusBanners } from '../components/StatusBanners';
import { DeliveryFacts } from '../components/DeliveryFacts';
import type { DeliveryView } from '../components/DeliveryFacts';
import { DeliveryPath } from '../components/DeliveryPath';
import type { DeliveryPathProps } from '../components/DeliveryPath';
import { TransportFacts } from '../components/TransportFacts';
import type { TransportEntry } from '../components/TransportFacts';
import type { StatusBanner } from '../../resource-status';

export interface EventPageProps {
  /** Who owns the event; `href` is their page, when the graph knows the team. */
  owner?: { team: string; href?: string | undefined } | undefined;
  /** Where the event was read from, and how sure the catalog is. */
  provenance: EvidenceView;
  /** Draft / deprecated / review / newer-version banners. */
  banners?: Array<StatusBanner> | undefined;
  /** The team's own index.mdx, rendered to HTML. */
  narrativeHtml?: string | null | undefined;
  /** One hop of the message flow around the event. */
  flow: Omit<FlowStripProps, 'label'>;
  visualiser?: VisualiserGraph | undefined;
  /** The schema's properties, built by `schemaTree`. */
  schema: Array<PropNode>;
  schemaHref: string;
  evidence: RuntimeEvidenceView;
  examples: Array<ExampleView>;
  /** Newest first. */
  versions: EventVersionsProps['versions'];
  documents: ResourceLinksProps['links'];
  /** Decisions, runbooks and incidents about it: one card per kind that has any. */
  records?: Array<ResourceLinksProps> | undefined;
  /** The facts that identify the event, beyond the title and crumbs above. */
  facts: Array<[label: string, value: string, href?: string]>;
  transport?: Array<TransportEntry> | undefined;
  /** What a consumer may rely on about arrival. */
  delivery?: DeliveryView | undefined;
  /** How it reaches each consumer, from the broker configuration. */
  deliveryPath?: DeliveryPathProps | undefined;
  /** Where the event's folder lives, and where to edit its narrative. */
  source?: string | null | undefined;
  edit?: string | null | undefined;
  /** When EventCatalog drew this event. Inline when it can embed, else a link. */
  diagram?: EventCatalogDiagramProps | undefined;
}

export function EventPage({
  owner,
  provenance,
  banners = [],
  narrativeHtml,
  flow,
  visualiser,
  schema,
  schemaHref,
  evidence,
  examples,
  versions,
  documents,
  records = [],
  facts,
  transport,
  delivery,
  deliveryPath,
  source,
  edit,
  diagram,
}: EventPageProps) {
  // An inline diagram needs the page's width; a link to one fits beside the schema.
  const inlineDiagram = diagram?.embed === true;

  const observed = evidence.status !== 'no-evidence';

  // Flows that name the event arrive with its other records; the impact block lists them too.
  const flows = records.find((record) => record.id === 'flows')?.links ?? [];

  const diagramCard = diagram && (
    <Card id="diagram">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Diagram
        </CardTitle>
      </CardHeader>
      <CardContent>
        <EventCatalogDiagram {...diagram} />
      </CardContent>
    </Card>
  );

  const details = (
    <Card id="details">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="m-0 flex flex-col">
          {facts.map(([label, value, href]) => (
            <Item key={label} size="xs">
              <dt className="w-32 text-muted-foreground">{label}</dt>
              <dd className="m-0 min-w-0 flex-1 break-words">
                {href ? (
                  <a
                    className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                    href={href}
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </Item>
          ))}
          {/* Props that crossed into the browser arrive as null where they were undefined. */}
          <TransportFacts transport={transport ?? undefined} />
          <DeliveryFacts delivery={delivery ?? undefined} />
        </dl>
      </CardContent>
      {(source || edit) && (
        <CardFooter>
          <div className="flex gap-4">
            <SourceLinks source={source} edit={edit} />
          </div>
        </CardFooter>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-8" data-wide>
      <div className="flex flex-col gap-4">
        <Evidence {...provenance} />
        <StatusBanners banners={banners} />
        <Impact
          owner={owner}
          flow={flow}
          flows={flows.map(({ title, href }) => ({ label: title, href, kind: 'flow' }))}
        />

        {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
      </div>

      <div className="not-content flex flex-col gap-8">
        <Graph
          id="message-flow"
          label="Message flow"
          visualiser={visualiser}
          fallback={<FlowStrip label="Message flow" {...flow} />}
        />

        {deliveryPath && <DeliveryPath {...deliveryPath} />}

        {/* The contract on the left: what the event is. What was seen of it, and
            where to read more, on the right. */}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <SchemaSection
              nodes={schema}
              href={schemaHref}
              note="schema.json is the contract a consumer validates against."
            />
            {/* An empty evidence card beside the schema only leaves a gap; below it, it says what is missing. */}
            {!observed && <RuntimeEvidence evidence={evidence} />}
            {versions.length > 1 && <EventVersions versions={versions} />}
            {details}
          </div>

          <div className="flex flex-col gap-6">
            {observed && <RuntimeEvidence evidence={evidence} />}
            <Examples examples={examples} />
            {records.map((record) => (
              <ResourceLinks key={record.id} {...record} />
            ))}
            <ResourceLinks id="documents" heading="Documents" links={documents} />
            {!inlineDiagram && diagramCard}
          </div>
        </div>

        {inlineDiagram && diagramCard}
      </div>
    </div>
  );
}

/** A row in the impact block: a service, agent, team or flow. */
interface ImpactLink {
  label: string;
  href?: string | undefined;
  kind?: string | undefined;
}

/** "2 services", or "2 consumers" when they are of more than one kind. */
function counted(links: Array<ImpactLink>, noun: string): string {
  const kinds = new Set(links.map((link) => link.kind ?? noun));

  const one = kinds.size === 1 ? [...kinds][0]! : noun;

  return `${links.length} ${one}${links.length === 1 ? '' : 's'}`;
}

/**
 * Who a change to the event reaches, before anything else on the page:
 * what publishes it, what subscribes, who owns it and the flows it is part of.
 */
function Impact({
  owner,
  flow,
  flows,
}: Pick<EventPageProps, 'owner' | 'flow'> & { flows: Array<ImpactLink> }) {
  const owners: Array<ImpactLink> = owner
    ? [{ label: owner.team, href: owner.href, kind: 'owner' }]
    : [];

  return (
    <section className="not-content @container" aria-labelledby="impact">
      <Card>
        <CardHeader>
          <CardTitle id="impact" role="heading" aria-level={2}>
            Impact
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 @xl:grid-cols-2 @5xl:grid-cols-4" data-impact="">
            <ImpactColumn
              heading="Producers"
              count={counted(flow.from, 'producer')}
              links={flow.from}
              empty={{
                kind: 'service',
                title: 'No producers',
                how: (
                  <>
                    Name the services that publish it in the event&apos;s <code>producers</code>{' '}
                    frontmatter.
                  </>
                ),
              }}
            />
            <ImpactColumn
              heading="Consumers"
              count={counted(flow.to, 'consumer')}
              links={flow.to}
              empty={{
                kind: 'service',
                title: 'No consumers',
                how: (
                  <>
                    Nothing subscribes to it yet. Name the services that do in the event&apos;s{' '}
                    <code>consumers</code> frontmatter, or retire it.
                  </>
                ),
              }}
            />
            <ImpactColumn
              heading="Owner"
              links={owners}
              empty={{
                kind: 'owner',
                title: 'No owner',
                how: (
                  <>
                    Name the team in the event&apos;s <code>owner</code> frontmatter.
                  </>
                ),
              }}
            />
            <ImpactColumn
              heading="Flows"
              count={counted(flows, 'flow')}
              links={flows}
              empty={{
                kind: 'flow',
                title: 'In no flows',
                how: (
                  <>
                    Name the event in a step of a flow under <code>flows/</code>.
                  </>
                ),
              }}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function ImpactColumn({
  heading,
  count,
  links,
  empty,
}: {
  heading: string;
  count?: string | undefined;
  links: Array<ImpactLink>;
  empty: { kind: string; title: string; how: ReactNode };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-impact-column={heading}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-medium">{heading}</h3>
        {links.length > 0 && count && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      {links.length === 0 ? (
        <div className="flex border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon name={kindIcon(empty.kind)} />
              </EmptyMedia>
              <EmptyTitle>{empty.title}</EmptyTitle>
              <EmptyDescription>{empty.how}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {links.map((link, index) => (
            <li key={`${link.label}|${index}`}>
              <ImpactRow link={link} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The whole row is the link, when the thing it names has a page. */
function ImpactRow({ link }: { link: ImpactLink }) {
  const content = (
    <>
      <ItemMedia>
        <IconTile name={kindIcon(link.kind ?? 'service')} kind={link.kind} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{link.label}</ItemTitle>
      </ItemContent>
      {link.href && (
        <ItemActions>
          <ArrowUpRightIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground group-hover/item:text-foreground"
          />
        </ItemActions>
      )}
    </>
  );

  return link.href ? (
    <Item variant="outline" size="sm" href={link.href} data-kind={link.kind}>
      {content}
    </Item>
  ) : (
    <Item variant="outline" size="sm" data-kind={link.kind}>
      {content}
    </Item>
  );
}

export default EventPage;
