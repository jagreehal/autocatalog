/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
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
}

export interface FlowPageProps {
  repository: string;
  /** Where the repository keeps it. */
  file: string;
  visualiser: VisualiserGraph;
  steps: FlowPageStep[];
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
            </ItemContent>
          </Item>
        </li>
      ))}
    </ol>
  );
}

/** A business process: the map, grouped by domain or team on request, then each step in order. */
export function FlowPage({ repository, file, visualiser, steps, narrativeHtml }: FlowPageProps) {
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

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default FlowPage;
