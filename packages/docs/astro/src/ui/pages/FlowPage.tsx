/** @jsxImportSource react */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import type { IconName } from '../../icons';
import { Graph } from '../components/Graph';
import { IconTile } from '../components/IconTile';
import type { VisualiserGraph } from '../lib/visualiser';

export interface FlowPageStep {
  id: string;
  title: string;
  kind: 'event' | 'service' | 'agent' | 'actor' | 'external' | 'custom';
  summary?: string | undefined;
  href?: string | undefined;
  /** The steps it leads to, by title, with the branch each one is. */
  next: Array<{ title: string; label?: string | undefined }>;
  /** The step that undoes this one when a later step fails. */
  compensatedBy?: string | undefined;
  /** How its runs ended, when a runtime snapshot recorded the workflow. */
  runtime?: string | undefined;
}

/** The workflow that carries out the flow, as a runtime snapshot recorded it. */
export interface FlowRuntime {
  workflow: string;
  repository: string;
  /** "Ran 12 times: 10 completed, 2 compensated." */
  summary: string;
  /** Steps the workflow ran that no flow step names. */
  unnamed: string[];
  sampleTraceIds: string[];
}

export interface FlowPageProps {
  repository: string;
  /** Where the repository keeps it. */
  file: string;
  visualiser: VisualiserGraph;
  steps: FlowPageStep[];
  runtime?: FlowRuntime | undefined;
  /** The Markdown below the frontmatter, rendered to HTML. */
  narrativeHtml?: string | null | undefined;
}

const ICONS: Record<FlowPageStep['kind'], IconName> = {
  event: 'event',
  service: 'service',
  agent: 'agent',
  actor: 'owners',
  external: 'external',
  custom: 'flow',
};

function StepList({ steps }: { steps: FlowPageStep[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Steps">
      {steps.map((step, i) => (
        <li key={step.id}>
          <Item size="sm" {...(step.href && { href: step.href })} data-kind={step.kind}>
            <ItemMedia>
              <IconTile name={ICONS[step.kind]} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {i + 1}. {step.title}
              </ItemTitle>
              {(step.summary || step.next.length > 0) && (
                <ItemDescription>
                  {step.summary}
                  {step.summary && step.next.length > 0 && ' '}
                  {step.next.length > 0 &&
                    `Then ${step.next
                      .map((next) => (next.label ? `${next.title} (${next.label})` : next.title))
                      .join(', or ')}.`}
                </ItemDescription>
              )}
              {step.runtime && <ItemDescription>{step.runtime}</ItemDescription>}
              {step.compensatedBy && (
                <ItemDescription>
                  If a later step fails, {step.compensatedBy} undoes it.
                </ItemDescription>
              )}
            </ItemContent>
          </Item>
        </li>
      ))}
    </ol>
  );
}

/** A business process: the map, grouped by domain or team on request, then each step in order. */
function RuntimeCard({ runtime }: { runtime: FlowRuntime }) {
  return (
    <div className="not-content">
      <Card id="runtime">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            At runtime
          </CardTitle>
          <CardDescription>
            The {runtime.workflow} workflow, from the {runtime.repository} repository’s snapshot
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0">{runtime.summary}</p>
            {runtime.unnamed.length > 0 && (
              <p className="m-0">
                It also ran {runtime.unnamed.join(', ')}, which no step here names.
              </p>
            )}
            {runtime.sampleTraceIds.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">
                  Trace IDs, runs that did not complete first
                </span>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {runtime.sampleTraceIds.map((traceId) => (
                    <li key={traceId}>
                      <code className="font-mono text-xs break-all">{traceId}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function FlowPage({
  repository,
  file,
  visualiser,
  steps,
  runtime,
  narrativeHtml,
}: FlowPageProps) {
  return (
    <div className="flex flex-col gap-8" data-wide>
      <p className="not-content m-0 max-w-prose">
        Declared in <code>{file}</code> in the {repository} repository.
      </p>

      <Graph
        id="flow"
        label="Flow"
        visualiser={visualiser}
        height="30rem"
        fallback={<StepList steps={steps} />}
      />

      <div className="not-content">
        <Card id="steps">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Steps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepList steps={steps} />
          </CardContent>
        </Card>
      </div>

      {runtime && <RuntimeCard runtime={runtime} />}

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default FlowPage;
