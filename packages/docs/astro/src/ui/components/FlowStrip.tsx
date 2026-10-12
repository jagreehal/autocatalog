/** @jsxImportSource react */
import { ArrowDownIcon, ArrowRightIcon, ArrowUpRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { kindIcon } from '../../icons';
import type { ShellLink } from '../../shell';
import { Icon } from './Icon';
import { IconTile } from './IconTile';

export type FlowNodeLink = ShellLink & { detail?: string };

export interface FlowStripProps {
  label: string;
  from: ShellLink[];
  /** Says how the left column reaches the centre: "publishes". */
  inbound: string;
  centre: FlowNodeLink;
  outbound: string;
  to: ShellLink[];
}

interface Missing {
  /** The kind of neighbour that is missing, for its icon. */
  kind: string;
  title: string;
  how: ReactNode;
}

interface MissingSides {
  from: Missing;
  to: Missing;
}

/**
 * What an empty side of the flow is missing, and where a person declares it.
 * An event's neighbours are services; a service's are the events naming it.
 */
function missing(centre: FlowNodeLink): MissingSides {
  if (centre.kind === 'event') {
    return {
      from: {
        kind: 'service',
        title: 'No producers',
        how: (
          <>
            Name the services that publish it in the event&apos;s <code>producers</code>{' '}
            frontmatter.
          </>
        ),
      },
      to: {
        kind: 'service',
        title: 'No consumers',
        how: (
          <>
            Name the services that subscribe in the event&apos;s <code>consumers</code> frontmatter.
          </>
        ),
      },
    };
  }

  if (centre.kind === 'service') {
    return {
      from: {
        kind: 'event',
        title: 'Consumes no events',
        how: (
          <>
            Add {centre.label} to an event&apos;s <code>consumers</code> frontmatter.
          </>
        ),
      },
      to: {
        kind: 'event',
        title: 'Produces no events',
        how: (
          <>
            Add {centre.label} to an event&apos;s <code>producers</code> frontmatter.
          </>
        ),
      },
    };
  }

  const nothing = { kind: 'document', title: 'Nothing declared', how: 'Nothing names it yet.' };

  return { from: nothing, to: nothing };
}

/**
 * One hop of the message flow around a resource: what feeds it, the resource
 * itself, and what it feeds. Read in order it is a sentence — "PaymentService
 * publishes Payment captured, subscribed by LedgerService" — so the edge labels
 * are text a screen reader hears, not decoration.
 */
export function FlowStrip({ label, from, inbound, centre, outbound, to }: FlowStripProps) {
  const empty = missing(centre);

  return (
    <section className="not-content @container" aria-label={label}>
      <Card>
        <CardContent>
          <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
            <Column nodes={from} empty={empty.from} />
            <Edge label={inbound} />
            <Column nodes={[centre]} isCentre />
            <Edge label={outbound} />
            <Column nodes={to} empty={empty.to} />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Column({
  nodes,
  empty,
  isCentre = false,
}: {
  nodes: FlowNodeLink[];
  empty?: Missing;
  isCentre?: boolean;
}) {
  if (nodes.length === 0 && empty) {
    // Wrapped, so the empty state's padding does not make its column wider than the rest.
    return (
      <div className="flex min-w-0 border border-dashed @2xl:flex-1">
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
    );
  }

  return (
    <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0 @2xl:flex-1">
      {nodes.map((node, index) => (
        <li key={`${node.label}|${index}`}>
          <FlowNode node={node} isCentre={isCentre} />
        </li>
      ))}
    </ul>
  );
}

/** The verb between two columns, with the way the message goes. */
function Edge({ label }: { label: string }) {
  return (
    <p className="m-0 flex shrink-0 items-center gap-2 pl-3 text-xs text-muted-foreground @2xl:pl-0">
      <ArrowDownIcon className="size-4 @2xl:hidden" aria-hidden="true" />
      <span className="hidden h-px w-3 bg-border @2xl:block" aria-hidden="true" />
      {label}
      <ArrowRightIcon className="hidden size-4 @2xl:block" aria-hidden="true" />
    </p>
  );
}

function FlowNode({ node, isCentre }: { node: FlowNodeLink; isCentre: boolean }) {
  const content = (
    <>
      {node.kind && (
        <ItemMedia>
          <IconTile name={kindIcon(node.kind)} />
        </ItemMedia>
      )}
      <ItemContent className="min-w-0">
        <ItemTitle>{node.label}</ItemTitle>
        {node.detail && <ItemDescription>{node.detail}</ItemDescription>}
      </ItemContent>
      {node.href && (
        <ItemActions>
          <ArrowUpRightIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground group-hover/item:text-foreground"
          />
        </ItemActions>
      )}
    </>
  );

  // The resource the page is about stands apart from its neighbours.
  const variant = isCentre ? 'muted' : 'outline';

  return node.href ? (
    <Item variant={variant} size="sm" href={node.href} data-kind={node.kind}>
      {content}
    </Item>
  ) : (
    <Item variant={variant} size="sm" data-kind={node.kind}>
      {content}
    </Item>
  );
}

export default FlowStrip;
