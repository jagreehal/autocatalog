/** @jsxImportSource react */
import { PencilLineIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Item } from '#ui/components/ui/item.tsx';
import type { PropNode } from '../lib/schema-tree';
import type { VisualiserGraph } from '../lib/visualiser';
import {
  EventCatalogDiagram,
  type EventCatalogDiagramProps,
} from '../components/EventCatalogDiagram';
import { EventVersions, type EventVersionsProps } from '../components/EventVersions';
import { Evidence, type EvidenceView } from '../components/Evidence';
import { Examples, type ExampleView } from '../components/Examples';
import { FlowStrip, type FlowStripProps } from '../components/FlowStrip';
import { Graph } from '../components/Graph';
import { ResourceLinks, type ResourceLinksProps } from '../components/ResourceLinks';
import { RuntimeEvidence, type RuntimeEvidenceView } from '../components/RuntimeEvidence';
import { SchemaSection } from '../components/SchemaTree';
import { SourceLinks } from '../components/SourceLinks';
import { DeliveryFacts, type DeliveryView } from '../components/DeliveryFacts';
import { TransportFacts, type TransportEntry } from '../components/TransportFacts';

export interface EventPageProps {
  /** Who owns the event; `href` is their page, when the graph knows the team. */
  owner?: { team: string; href?: string | undefined } | undefined;
  /** Where the event was read from, and how sure the catalog is. */
  provenance: EvidenceView;
  /** What the deprecation notice says; absent for an event that is not deprecated. */
  deprecation?: string | null | undefined;
  /** A contract still being written: published to read and discuss with its owner. */
  draft?: boolean | undefined;
  /** The team's own index.mdx, rendered to HTML. */
  narrativeHtml?: string | null | undefined;
  /** One hop of the message flow around the event. */
  flow: Omit<FlowStripProps, 'label'>;
  visualiser?: VisualiserGraph | undefined;
  /** The schema's properties, built by `schemaTree`. */
  schema: PropNode[];
  schemaHref: string;
  evidence: RuntimeEvidenceView;
  examples: ExampleView[];
  /** Newest first. */
  versions: EventVersionsProps['versions'];
  changesHtml?: string | null | undefined;
  documents: ResourceLinksProps['links'];
  /** The facts that identify the event, beyond the title and crumbs above. */
  facts: Array<[label: string, value: string, href?: string]>;
  transport?: TransportEntry[] | undefined;
  /** What a consumer may rely on about arrival. */
  delivery?: DeliveryView | undefined;
  /** Where the event's folder lives, and where to edit its narrative. */
  source?: string | null | undefined;
  edit?: string | null | undefined;
  /** When EventCatalog drew this event. Inline when it can embed, else a link. */
  diagram?: EventCatalogDiagramProps | undefined;
}

export function EventPage({
  owner,
  provenance,
  deprecation,
  draft,
  narrativeHtml,
  flow,
  visualiser,
  schema,
  schemaHref,
  evidence,
  examples,
  versions,
  changesHtml,
  documents,
  facts,
  transport,
  delivery,
  source,
  edit,
  diagram,
}: EventPageProps) {
  // An inline diagram needs the page's width; a link to one fits beside the schema.
  const inlineDiagram = diagram?.embed === true;

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
        <FlowSentence owner={owner} flow={flow} />

        {deprecation && (
          <div className="not-content">
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>Deprecated</AlertTitle>
              <AlertDescription>{deprecation}</AlertDescription>
            </Alert>
          </div>
        )}

        {draft && (
          <div className="not-content">
            <Alert>
              <PencilLineIcon />
              <AlertTitle>Draft</AlertTitle>
              <AlertDescription>
                This contract may still change. Agree it with the owner before depending on it.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
      </div>

      <div className="not-content flex flex-col gap-8">
        <Graph
          id="message-flow"
          label="Message flow"
          visualiser={visualiser}
          fallback={<FlowStrip label="Message flow" {...flow} />}
        />

        {/* The contract on the left: what the event is. What was seen of it, and
            where to read more, on the right. */}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <SchemaSection
              nodes={schema}
              href={schemaHref}
              note="schema.json is the contract a consumer validates against."
            />
            {versions.length > 1 && <EventVersions versions={versions} changesHtml={changesHtml} />}
            {details}
          </div>

          <div className="flex flex-col gap-6">
            <RuntimeEvidence evidence={evidence} />
            <Examples examples={examples} />
            <ResourceLinks id="documents" heading="Documents" links={documents} />
            {!inlineDiagram && diagramCard}
          </div>
        </div>

        {inlineDiagram && diagramCard}
      </div>
    </div>
  );
}

/** Who produces, consumes and owns the event, said rather than counted. */
function FlowSentence({ owner, flow }: Pick<EventPageProps, 'owner' | 'flow'>) {
  return (
    <p className="not-content m-0 max-w-prose">
      {flow.from.length > 0 ? (
        <>
          Produced by <Names links={flow.from} />.
        </>
      ) : (
        'No producer is declared.'
      )}{' '}
      {flow.to.length > 0 ? (
        <>
          Consumed by <Names links={flow.to} />.
        </>
      ) : (
        'Nothing consumes it yet.'
      )}
      {owner && (
        <>
          {' '}
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
    </p>
  );
}

/** "A", "A and B", "A, B and C", each linked when it has a page. */
function Names({ links }: { links: FlowStripProps['from'] }) {
  return links.map((link, i) => (
    <span key={link.href ?? link.label}>
      {i > 0 && (i === links.length - 1 ? ' and ' : ', ')}
      {link.href ? (
        <a
          className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          href={link.href}
        >
          {link.label}
        </a>
      ) : (
        link.label
      )}
    </span>
  ));
}

export default EventPage;
