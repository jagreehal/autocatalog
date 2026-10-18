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
import type { VisualiserGraph } from '../lib/visualiser';
import {
  EventCatalogDiagram,
  type EventCatalogDiagramProps,
} from '../components/EventCatalogDiagram';
import { Evidence } from '../components/Evidence';
import { FlowStrip, type FlowStripProps } from '../components/FlowStrip';
import { Graph } from '../components/Graph';
import { ResourceLinks, type ResourceLinksProps } from '../components/ResourceLinks';
import { IconTile } from '../components/IconTile';

export interface ServiceEvent {
  name: string;
  id: string;
  domain: string;
  href: string;
  /** Named only when two repositories publish an event with this id. */
  repository?: string | undefined;
}

export interface ServicePageProps {
  /** One hop of the message flow around the service. */
  flow: Omit<FlowStripProps, 'label'>;
  visualiser?: VisualiserGraph | undefined;
  /** "Produces" and "Consumes", each only when the service has any. */
  sections: Array<{ heading: string; slug: string; events: ServiceEvent[] }>;
  /** The OpenAPI specs it serves, each with its reference page. */
  apis?: Array<{ title: string; file: string; href: string }> | undefined;
  documents: ResourceLinksProps['links'];
  /** Decisions, runbooks and incidents about it: one card per kind that has any. */
  records?: ResourceLinksProps[] | undefined;
  /** When EventCatalog drew this service. Inline when it can embed, else a link. */
  diagram?: EventCatalogDiagramProps | undefined;
  /** Who owns it, when its own record says: imported from EventCatalog or Backstage. */
  owner?: { team: string; href?: string | undefined } | undefined;
  /** The system it is part of, as EventCatalog groups services. */
  system?: string | undefined;
}

export function ServicePage({
  flow,
  visualiser,
  sections,
  apis = [],
  documents,
  records = [],
  diagram,
  owner,
  system,
}: ServicePageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <Evidence
        method="inferred"
        location={null}
        symbol={null}
        confidence={null}
        needsReview={false}
        basis="from the events that name it as a producer or consumer"
      />

      {(owner || system) && (
        <p className="not-content m-0 max-w-prose">
          {owner && (
            <>
              Owned by{' '}
              {owner.href ? (
                <a
                  className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                  href={owner.href}
                >
                  {owner.team}
                </a>
              ) : (
                owner.team
              )}
              .
            </>
          )}
          {owner && system && ' '}
          {system && `Part of ${system}.`}
        </p>
      )}

      <Graph
        id="message-flow"
        label="Message flow"
        visualiser={visualiser}
        height="30rem"
        fallback={<FlowStrip label="Message flow" {...flow} />}
      />

      {(sections.length > 0 ||
        apis.length > 0 ||
        documents.length > 0 ||
        records.length > 0 ||
        diagram) && (
        <div className="grid items-start gap-6 md:grid-cols-2">
          {sections.map((section) => (
            <Card id={section.slug} key={section.slug}>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  {section.heading}
                </CardTitle>
                <CardAction>
                  <span className="text-muted-foreground">
                    {section.events.length} {section.events.length === 1 ? 'event' : 'events'}
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {section.events.map((event) => (
                    <li key={event.href}>
                      <Item href={event.href} size="sm" data-kind="event">
                        <ItemMedia>
                          <IconTile name="event" />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{event.name}</ItemTitle>
                          <ItemDescription>
                            <code>{event.id}</code> in {event.domain}
                            {event.repository && <>, from the {event.repository} repository</>}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
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
          ))}
          {apis.length > 0 && (
            <Card id="apis">
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  APIs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {apis.map((api) => (
                    <li key={api.href}>
                      <Item href={api.href} size="sm">
                        <ItemMedia>
                          <IconTile name="api" />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{api.title}</ItemTitle>
                          <ItemDescription>
                            <code>{api.file}</code>
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
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
          )}
          {records.map((record) => (
            <ResourceLinks key={record.id} {...record} />
          ))}
          <ResourceLinks id="documents" heading="Documents" links={documents} />
          {diagram && (
            <Card id="diagram" className={diagram.embed ? 'md:col-span-2' : undefined}>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  Diagram
                </CardTitle>
              </CardHeader>
              <CardContent>
                <EventCatalogDiagram {...diagram} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default ServicePage;
