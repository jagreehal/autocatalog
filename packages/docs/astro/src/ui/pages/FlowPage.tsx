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
import { Badge } from '#ui/components/ui/badge.tsx';
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
  /** The state change it records. A step that fails may make none. */
  transition?: { field: string; change: string; via?: string | undefined } | undefined;
  rules?: string[] | undefined;
  stuck?: { signs: string; recovery?: string | undefined } | undefined;
  notes?: FlowPageNote[] | undefined;
  evidence?: FlowPageEvidence[] | undefined;
}

/** A document attached here. Its nature and status stay beside it, so a draft reads as one. */
export interface FlowPageNote {
  title: string;
  href: string;
  nature?: string | undefined;
  status?: string | undefined;
  hotspot: boolean;
}

export interface FlowPageEvidence {
  label: string;
  value: string;
}

/** When the evidence was gathered, so old evidence does not look current. */
export interface FlowPageEvidenceSummary {
  checkedAt: string;
  commit?: string | undefined;
  window?: { from: string; to: string } | undefined;
  source?: string | undefined;
  stale: boolean;
  /** Recorded at runtime, and in no flow. */
  undeclared: string[];
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
  notes?: FlowPageNote[] | undefined;
  evidence?: FlowPageEvidenceSummary | undefined;
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

function Notes({ notes }: { notes: FlowPageNote[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Notes">
      {notes.map((note) => (
        <li key={note.href} className="flex flex-wrap items-center gap-2">
          {note.hotspot && <Badge variant="destructive">Hotspot</Badge>}
          <a href={note.href} className="underline underline-offset-4">
            {note.title}
          </a>
          {note.nature && <Badge variant="outline">{note.nature}</Badge>}
          {note.status && <Badge variant="secondary">{note.status}</Badge>}
        </li>
      ))}
    </ul>
  );
}

function StepFacts({ step }: { step: FlowPageStep }) {
  const { transition, rules = [], stuck, notes = [], evidence = [] } = step;

  if (!transition && rules.length + notes.length === 0 && !stuck) return null;

  return (
    <div className="flex flex-col gap-2 pt-1 text-sm">
      {transition && (
        <p className="m-0">
          <code>{transition.field}</code>: {transition.change}
          {transition.via && ` via ${transition.via}`}
        </p>
      )}
      {rules.length > 0 && (
        <ul className="m-0 pl-4" aria-label="Business rules">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
      {stuck && (
        <p className="m-0">
          Stuck when {stuck.signs}
          {stuck.recovery && `. Recovery: ${stuck.recovery}`}
        </p>
      )}
      {evidence.length > 0 && (
        <dl className="m-0 flex flex-col gap-1">
          {evidence.map(({ label, value }) => (
            <div key={label} className="flex flex-wrap gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {notes.length > 0 && <Notes notes={notes} />}
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: FlowPageEvidenceSummary }) {
  return (
    <div className="not-content">
      <Card id="evidence">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Evidence
          </CardTitle>
          <CardDescription>
            Checked {evidence.checkedAt}
            {evidence.commit && ` at ${evidence.commit.slice(0, 7)}`}
            {evidence.window &&
              `, from ${evidence.source ?? 'runtime'} over ${evidence.window.from} to ${evidence.window.to}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm">
            {evidence.stale && (
              <p className="m-0">
                <Badge variant="destructive">Old</Badge> This may no longer be true.
              </p>
            )}
            <p className="m-0 text-muted-foreground">
              Counts are best-effort, and a transition nobody instrumented is not a broken one.
            </p>
            {evidence.undeclared.map((line) => (
              <p className="m-0" key={line}>
                {line}
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
              <StepFacts step={step} />
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
  notes = [],
  evidence,
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

      {evidence && <EvidenceCard evidence={evidence} />}

      {notes.length > 0 && (
        <div className="not-content">
          <Card id="notes">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Notes on this flow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Notes notes={notes} />
            </CardContent>
          </Card>
        </div>
      )}

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default FlowPage;
