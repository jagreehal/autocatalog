/** @jsxImportSource react */
import { ActivityIcon } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '#ui/components/ui/accordion.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { Evidence } from './Evidence';
import { IconTile } from './IconTile';

export interface RuntimeEvidenceSource {
  producer?: string | undefined;
  channel?: string | undefined;
  count: number;
}

/** A dead-letter queue one consumer declares for the event. */
export interface DeadLetterView {
  consumer: string;
  queue: string;
  maxAttempts?: number | undefined;
}

/** What happened to the deliveries one consumer received in the snapshot. */
export interface ConsumerOutcomeView {
  consumer: string;
  count: number;
  failed?: number | undefined;
  retried?: number | undefined;
  deadLettered?: number | undefined;
  replayed?: number | undefined;
  deadLetterReasons?:
    | Array<{
        reason: string;
        category?: string | undefined;
        queue?: string | undefined;
        count: number;
      }>
    | undefined;
}

interface RuntimeEvidenceBase {
  /** `domain/id`, named in the prompt offered to a coding agent. */
  ref: string;
  caveat: string;
  deadLetters: DeadLetterView[];
}

export interface RuntimeEvidenceSnapshot extends RuntimeEvidenceBase {
  status: 'snapshot';
  count: number;
  observedRange: { firstSeen?: string | undefined; lastSeen?: string | undefined };
  snapshot: { generatedAt?: string | undefined };
  declaredConsumers: string[];
  observedConsumers: string[];
  additionalConsumers: string[];
  neverObserved: string[];
  consumerEvidence: 'reported' | 'observed' | 'unknown';
  sources: RuntimeEvidenceSource[];
  consumerOutcomes: ConsumerOutcomeView[];
  sampleTraceIds: string[];
}

export interface RuntimeEvidenceNone extends RuntimeEvidenceBase {
  status: 'no-evidence';
}

/** What the card renders: the read model of `eventRuntimeEvidence`, plus the event it is about. */
export type RuntimeEvidenceView = RuntimeEvidenceSnapshot | RuntimeEvidenceNone;

export interface RuntimeEvidenceProps {
  evidence: RuntimeEvidenceView;
}

const number = (value: number) => value.toLocaleString('en-GB');

const counted = (count: number, one: string, many = `${one}s`) =>
  `${number(count)} ${count === 1 ? one : many}`;

/** "6 deliveries: 4 failed, 2 retried, 1 dead-lettered." */
function outcomeLine(outcome: ConsumerOutcomeView): string {
  const parts = [
    outcome.failed && `${number(outcome.failed)} failed`,
    outcome.retried && `${number(outcome.retried)} retried`,
    outcome.deadLettered && `${number(outcome.deadLettered)} dead-lettered`,
    outcome.replayed && `${number(outcome.replayed)} replayed`,
  ].filter(Boolean);

  return `${counted(outcome.count, 'delivery', 'deliveries')}: ${parts.join(', ')}.`;
}

/** Each consumer's outcomes summed across every channel it receives on. */
function outcomesByConsumer(outcomes: ConsumerOutcomeView[]): Map<string, ConsumerOutcomeView> {
  const totals = new Map<string, ConsumerOutcomeView>();

  for (const outcome of outcomes) {
    const total = totals.get(outcome.consumer);

    const sum = (field: 'failed' | 'retried' | 'deadLettered' | 'replayed') =>
      (total?.[field] ?? 0) + (outcome[field] ?? 0);

    totals.set(
      outcome.consumer,
      total
        ? {
            consumer: outcome.consumer,
            count: total.count + outcome.count,
            failed: sum('failed'),
            retried: sum('retried'),
            deadLettered: sum('deadLettered'),
            replayed: sum('replayed'),
            deadLetterReasons: mergeReasons([
              ...(total.deadLetterReasons ?? []),
              ...(outcome.deadLetterReasons ?? []),
            ]),
          }
        : outcome,
    );
  }

  return totals;
}

type DeadLetterReasonView = NonNullable<ConsumerOutcomeView['deadLetterReasons']>[number];

/** One entry per reason, category and queue, its counts summed, most frequent first. */
function mergeReasons(reasons: DeadLetterReasonView[]): DeadLetterReasonView[] {
  const merged = new Map<string, DeadLetterReasonView>();

  for (const reason of reasons) {
    const key = JSON.stringify([reason.reason, reason.category ?? '', reason.queue ?? '']);
    const existing = merged.get(key);

    merged.set(key, existing ? { ...existing, count: existing.count + reason.count } : reason);
  }

  return [...merged.values()].sort((a, b) => b.count - a.count);
}

/** "Dead letters go to ledger-dlq after 3 attempts." */
const deadLetterLine = ({ queue, maxAttempts }: DeadLetterView) =>
  `Dead letters go to ${queue}${maxAttempts ? ` after ${counted(maxAttempts, 'attempt')}` : ''}.`;

function DeadLetters({ deadLetters }: { deadLetters: DeadLetterView[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="runtime-dead-letters">
      <h3 className="m-0 text-sm font-medium" id="runtime-dead-letters">
        Dead-letter queues
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {deadLetters.map((entry) => (
          <li key={entry.consumer}>
            <Item variant="outline" size="sm">
              <ItemMedia>
                <IconTile name="service" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{entry.consumer}</ItemTitle>
                <ItemDescription>{deadLetterLine(entry)}</ItemDescription>
              </ItemContent>
            </Item>
          </li>
        ))}
      </ul>
    </section>
  );
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** A snapshot timestamp as a reader says it, in UTC so server and browser agree. */
function when(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? iso : `${dateTime.format(date)} UTC`;
}

/** "18,342 times between 1 Sep 2026, 00:00 UTC and 9 Oct 2026, 23:59 UTC". */
function seen(evidence: RuntimeEvidenceSnapshot): string {
  const { firstSeen, lastSeen } = evidence.observedRange;

  const times = `${number(evidence.count)} ${evidence.count === 1 ? 'time' : 'times'}`;

  if (firstSeen && lastSeen) return `${times} between ${when(firstSeen)} and ${when(lastSeen)}`;

  if (firstSeen) return `${times}, first on ${when(firstSeen)}`;

  if (lastSeen) return `${times}, last on ${when(lastSeen)}`;

  return times;
}

export function RuntimeEvidence({ evidence }: RuntimeEvidenceProps) {
  const generatedAt = evidence.status === 'snapshot' ? evidence.snapshot.generatedAt : undefined;

  return (
    <div className="not-content">
      <Card id="runtime">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Runtime evidence
          </CardTitle>
          {evidence.status === 'snapshot' && (
            <CardDescription>
              From a saved snapshot
              {generatedAt && (
                <>
                  {' '}
                  generated <time dateTime={generatedAt}>{when(generatedAt)}</time>
                </>
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {evidence.status === 'snapshot' ? (
            <SnapshotDetails evidence={evidence} />
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex border border-dashed">
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ActivityIcon aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No evidence attached</EmptyTitle>
                    <EmptyDescription>
                      Run <code>ac scan --snapshot &lt;file&gt;</code> with an autotel architecture
                      snapshot to record what this event did at runtime.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
              {evidence.deadLetters.length > 0 && (
                <DeadLetters deadLetters={evidence.deadLetters} />
              )}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs text-muted-foreground">{evidence.caveat}</p>
            <p className="m-0 text-sm">
              Ask your coding agent: “Investigate <code className="font-mono">{evidence.ref}</code>{' '}
              using autocatalog and autotel.”
            </p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

interface ConsumerRow {
  name: string;
  status: string;
  /** What happened to its deliveries, and where it puts those it gives up on. */
  outcome?: string | undefined;
}

/** Every consumer either side knows of, and what each side says about it. */
function consumerRows(evidence: RuntimeEvidenceSnapshot): ConsumerRow[] {
  const seenAs =
    evidence.consumerEvidence === 'observed' ? 'observed receiving' : 'reported in snapshot';

  const absent = new Set(evidence.neverObserved);

  const declared = evidence.declaredConsumers.map((name) => ({
    name,
    status: absent.has(name) ? 'Declared, absent from snapshot' : `Declared, and ${seenAs}`,
  }));

  const additional = evidence.additionalConsumers.map((name) => ({
    name,
    status: `${seenAs.charAt(0).toUpperCase()}${seenAs.slice(1)}, not declared`,
  }));

  const outcomes = outcomesByConsumer(evidence.consumerOutcomes);
  const queues = new Map(evidence.deadLetters.map((entry) => [entry.consumer, entry]));

  return [...declared, ...additional].map((row) => {
    const outcome = outcomes.get(row.name);
    const queue = queues.get(row.name);

    const lines = [outcome && outcomeLine(outcome), queue && deadLetterLine(queue)].filter(Boolean);

    return lines.length > 0 ? { ...row, outcome: lines.join(' ') } : row;
  });
}

function SnapshotDetails({ evidence }: { evidence: RuntimeEvidenceSnapshot }) {
  const consumers = consumerRows(evidence);

  // A queue declared in another repository, for a consumer neither list names.
  const listed = new Set(consumers.map((consumer) => consumer.name));
  const unlisted = evidence.deadLetters.filter((entry) => !listed.has(entry.consumer));

  const reasons = [...outcomesByConsumer(evidence.consumerOutcomes).values()].flatMap((outcome) =>
    (outcome.deadLetterReasons ?? []).map((reason) => ({ ...reason, consumer: outcome.consumer })),
  );

  return (
    <div className="flex flex-col gap-6">
      <Evidence
        method="observed"
        location={null}
        symbol={null}
        confidence={null}
        needsReview={false}
        basis={seen(evidence)}
      />

      <section className="flex flex-col gap-3" aria-labelledby="runtime-consumers">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="m-0 text-sm font-medium" id="runtime-consumers">
            Consumers
          </h3>
          <span className="text-xs text-muted-foreground">
            {consumers.length} {consumers.length === 1 ? 'service' : 'services'}
          </span>
        </div>
        {consumers.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {consumers.map((consumer) => (
              <li key={consumer.name}>
                <Item variant="outline" size="sm">
                  <ItemMedia>
                    <IconTile name="service" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{consumer.name}</ItemTitle>
                    <ItemDescription>{consumer.status}</ItemDescription>
                    {consumer.outcome && <ItemDescription>{consumer.outcome}</ItemDescription>}
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            None declared, and none in the snapshot.
          </p>
        )}
      </section>

      {unlisted.length > 0 && <DeadLetters deadLetters={unlisted} />}

      {(evidence.sources.length > 0 ||
        evidence.sampleTraceIds.length > 0 ||
        reasons.length > 0) && (
        <Accordion allowsMultipleExpanded>
          {reasons.length > 0 && (
            <AccordionItem id="dead-letter-reasons">
              <AccordionTrigger>Why deliveries were dead-lettered</AccordionTrigger>
              <AccordionContent>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {reasons.map((reason) => (
                    <li
                      key={JSON.stringify([
                        reason.consumer,
                        reason.reason,
                        reason.category ?? '',
                        reason.queue ?? '',
                      ])}
                    >
                      <Item variant="outline" size="xs">
                        <ItemContent>
                          <ItemTitle>{reason.reason}</ItemTitle>
                          <ItemDescription>
                            {reason.consumer}
                            {reason.category && `, ${reason.category}`}
                            {reason.queue && (
                              <>
                                {' '}
                                to <code className="font-mono">{reason.queue}</code>
                              </>
                            )}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {counted(reason.count, 'time')}
                          </span>
                        </ItemActions>
                      </Item>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          )}
          {evidence.sources.length > 0 && (
            <AccordionItem id="sources">
              <AccordionTrigger>Producer and channel observations</AccordionTrigger>
              <AccordionContent>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {evidence.sources.map((source) => (
                    <li key={`${source.producer ?? ''}|${source.channel ?? ''}`}>
                      <Item variant="outline" size="xs">
                        <ItemContent>
                          <ItemTitle>{source.producer ?? 'Unknown producer'}</ItemTitle>
                          <ItemDescription>
                            {source.channel ? (
                              <>
                                on <code className="font-mono">{source.channel}</code>
                              </>
                            ) : (
                              'on an unknown channel'
                            )}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {number(source.count)} observations
                          </span>
                        </ItemActions>
                      </Item>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          )}
          {evidence.sampleTraceIds.length > 0 && (
            <AccordionItem id="traces">
              <AccordionTrigger>Representative trace IDs</AccordionTrigger>
              <AccordionContent>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {evidence.sampleTraceIds.map((traceId) => (
                    <li key={traceId}>
                      <code className="font-mono text-xs break-all">{traceId}</code>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 mb-0 text-xs text-muted-foreground">
                  Use these with your connected telemetry backend after confirming the environment.
                  Retention may have expired.
                </p>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </div>
  );
}

export default RuntimeEvidence;
