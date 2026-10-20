/** @jsxImportSource react */
import type { ConsumerStanding, Retirement } from 'autocatalog-core';
import { Badge } from '#ui/components/ui/badge.tsx';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Icon } from '../components/Icon';

export interface RetirementRow extends Omit<Retirement, 'consumers'> {
  name: string;
  repository: string;
  href: string;
  /** When the event was deprecated, for a whole-event retirement. */
  since?: string;
  consumers: Array<Retirement['consumers'][number] & { href: string }>;
}

export interface RetirementsPageProps {
  retirements: RetirementRow[];
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const STANDING: Record<
  ConsumerStanding,
  { label: string; variant: 'destructive' | 'outline' | 'secondary' }
> = {
  reads: { label: 'Needs it', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
  unspecified: { label: 'Unspecified', variant: 'outline' },
  clear: { label: 'Clear', variant: 'secondary' },
};

export function RetirementsPage({ retirements }: RetirementsPageProps) {
  if (retirements.length === 0) {
    return (
      <div className="not-content" data-wide>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="fields" />
            </EmptyMedia>
            <EmptyTitle>Nothing is being retired</EmptyTitle>
            <EmptyDescription>
              Mark a field <code>deprecated: true</code> in its schema, or an event{' '}
              <code>status: deprecated</code>, and it appears here with where each consumer stands.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-4" data-wide>
      {retirements.map((retirement) => {
        const what = retirement.field ?? 'the whole event';
        const id = `${retirement.href}#${retirement.field ?? ''}`;

        return (
          <Card key={id}>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                <a className={link} href={retirement.href} data-kind="event">
                  {retirement.name}
                </a>
                {retirement.field && (
                  <>
                    {' '}
                    <code>{retirement.field}</code>
                  </>
                )}
              </CardTitle>
              <CardDescription>
                Removing {what} from <code>{retirement.event}</code> ({retirement.repository})
                {retirement.since ? `, deprecated since ${retirement.since}` : ''}
                {retirement.runtime ? `. Producer ${retirement.runtime}` : ''}.
              </CardDescription>
              <CardAction>
                <Badge variant={retirement.verdict === 'ready' ? 'secondary' : 'destructive'}>
                  {retirement.verdict === 'ready' ? 'Ready' : 'Blocked'}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {retirement.consumers.length > 0 && (
                  <Table aria-label={`Consumers of ${what}`}>
                    <TableHeader>
                      <TableHead isRowHeader>Consumer</TableHead>
                      <TableHead>Standing</TableHead>
                      <TableHead>Evidence</TableHead>
                    </TableHeader>
                    <TableBody>
                      {retirement.consumers.map((consumer) => (
                        <TableRow key={consumer.consumer}>
                          <TableCell>
                            <a className={link} href={consumer.href} data-kind="service">
                              {consumer.consumer}
                            </a>
                          </TableCell>
                          <TableCell>
                            <Badge variant={STANDING[consumer.standing].variant}>
                              {STANDING[consumer.standing].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {consumer.evidence.map((e) => `${e.says} (${e.source})`).join('; ')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="text-muted-foreground">Next: {retirement.next.join('. ')}.</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
