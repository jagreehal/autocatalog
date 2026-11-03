/** @jsxImportSource react */
import type { ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import { Item } from '#ui/components/ui/item.tsx';

export interface DeliveryHopView {
  name: string;
  /** `service`, or what the node is to its broker: exchange, topic, bus, rule, queue, subscription. */
  entity: string;
  href?: string | undefined;
  /** The binding that let the message through, as `currency = GBP`. */
  rule?: string | undefined;
  /** `file:line` of the configuration that says so. */
  source?: string | undefined;
}

export interface DeliveryRouteView {
  consumer: string;
  environment?: string | undefined;
  /** Producer, exchange, … queue, consumer. */
  hops: DeliveryHopView[];
  examples: Array<{
    name: string;
    headers: string;
    outcome: 'reaches' | 'excluded' | 'not evaluated';
  }>;
  /** Where a message the consumer rejects goes. */
  deadLetter?: { exchange: string; queues: string[] } | undefined;
  /** What the consumer's queue promises: retention, attempts, consumer group. */
  facts?: string[] | undefined;
}

export interface DeliveryFindingView {
  confidence: 'confirmed' | 'policy' | 'possible' | 'unknown';
  message: string;
  source?: string | undefined;
}

export interface DeliveryPathProps {
  routes: DeliveryRouteView[];
  findings: DeliveryFindingView[];
  /** False when part of a route was not evaluated. */
  complete: boolean;
}

const OUTCOME = {
  reaches: 'secondary',
  excluded: 'outline',
  'not evaluated': 'outline',
} as const;

const LINK =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const CONFIDENCE = {
  confirmed: 'destructive',
  policy: 'destructive',
  possible: 'secondary',
  unknown: 'outline',
} as const;

/**
 * How the event gets from its producer to each consumer, read from the
 * broker configuration the repository commits: every hop with the binding
 * that takes the message and the line that declares it, then what each
 * committed example does, then what the configuration gets wrong.
 */
export function DeliveryPath({ routes, findings, complete }: DeliveryPathProps) {
  if (routes.length === 0 && findings.length === 0) return null;

  return (
    <Card id="delivery-path">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Delivery path
        </CardTitle>
        <CardDescription>
          Read from the broker configuration, so it shows where messages are routed, not that they
          arrive. <code>ac delivery verify</code> checks that against a test broker.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {routes.map((route) => (
            <section key={route.consumer} className="flex flex-col gap-3">
              <h3 className="m-0 flex items-center gap-2 text-sm font-medium">
                To {route.consumer}
                {route.environment && <Badge variant="outline">{route.environment}</Badge>}
              </h3>
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {route.hops.map((hop, index) => (
                  <li
                    key={`${hop.entity}:${hop.name}`}
                    className={`flex flex-wrap items-baseline gap-2${index > 0 ? ' pl-4' : ''}`}
                  >
                    {index > 0 && <span aria-hidden="true">→</span>}
                    {hop.href ? (
                      <a className={LINK} href={hop.href}>
                        {hop.name}
                      </a>
                    ) : (
                      <code>{hop.name}</code>
                    )}
                    {hop.entity !== 'service' && (
                      <span className="text-muted-foreground text-xs">{hop.entity}</span>
                    )}
                    {hop.rule && <Badge variant="outline">{hop.rule}</Badge>}
                    {hop.source && (
                      <span className="text-muted-foreground text-xs">{hop.source}</span>
                    )}
                  </li>
                ))}
              </ol>
              {route.facts && route.facts.length > 0 && (
                <p className="m-0 text-sm text-muted-foreground">
                  {withNames(route.facts.join(' · '))}
                </p>
              )}
              {route.deadLetter && (
                <p className="m-0 text-sm">
                  <span className="text-muted-foreground">Rejected messages: </span>
                  <code>{route.deadLetter.exchange}</code> →{' '}
                  {route.deadLetter.queues.length > 0 ? (
                    route.deadLetter.queues.map((queue) => <code key={queue}>{queue}</code>)
                  ) : (
                    <span className="text-destructive">nowhere</span>
                  )}
                </p>
              )}
              <dl className="m-0 flex flex-col">
                {route.examples.map((example) => (
                  <Item key={example.name} size="xs">
                    <dt className="w-32 text-muted-foreground">{example.name}</dt>
                    <dd className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {example.headers && <code>{example.headers}</code>}
                      <Badge variant={OUTCOME[example.outcome]}>{example.outcome}</Badge>
                    </dd>
                  </Item>
                ))}
              </dl>
            </section>
          ))}
          {findings.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {findings.map((finding) => (
                <li
                  key={`${finding.confidence}:${finding.message}`}
                  className="flex items-start gap-2"
                >
                  <Badge variant={CONFIDENCE[finding.confidence]}>{finding.confidence}</Badge>
                  <span className="min-w-0 flex-1">
                    {withNames(finding.message)}
                    {finding.source && (
                      <span className="text-muted-foreground text-xs"> {finding.source}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!complete && (
            <p className="m-0 text-sm text-muted-foreground">
              Part of a route was not evaluated, so this is not a clean result.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default DeliveryPath;

/** A finding's text, with each name it quotes in backticks shown as code. */
export function withNames(message: string): ReactNode[] {
  const parts = message.split(/(`+)(.+?)\1/);

  return parts.flatMap((part, i): ReactNode[] => {
    if (i % 3 === 1) return [];

    if (i % 3 === 0) return part ? [part] : [];

    // A fence padded with a space holds a name that starts or ends with a backtick.
    const name = part.startsWith(' ') && part.endsWith(' ') ? part.slice(1, -1) : part;

    return [<code key={i}>{name}</code>];
  });
}
