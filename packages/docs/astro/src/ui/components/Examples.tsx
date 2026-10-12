/** @jsxImportSource react */
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Code } from './Code';

/** One example payload: its file name, its JSON, and the edge case it shows. */
export interface ExampleView {
  name: string;
  code: string;
  /** A name its author gave it, shown in place of the file name. */
  title?: string | undefined;
  case?: 'empty' | 'partial' | 'duplicate' | 'late' | 'invalid' | undefined;
  /** What it shows a consumer. */
  summary?: string | undefined;
}

const CASE_LABEL = {
  empty: 'Empty',
  partial: 'Partial',
  duplicate: 'Duplicate',
  late: 'Late',
  invalid: 'Invalid',
} as const;

export interface ExamplesProps {
  examples: ExampleView[];
}

/** A card of example payloads; nothing at all when there are none. */
export function Examples({ examples }: ExamplesProps) {
  if (examples.length === 0) return null;

  return (
    <div className="not-content">
      <Card id="examples">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            {examples.length === 1 ? 'Example' : 'Examples'}
          </CardTitle>
          {examples.length > 1 && (
            <CardAction>
              <span className="text-muted-foreground">{`${examples.length} payloads`}</span>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {examples.map((example, index) => (
              <section key={`${example.name}|${index}`} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {/* A title is words; a file name is literally code. */}
                  {example.title ? (
                    <h3 className="m-0 text-sm font-medium">{example.title}</h3>
                  ) : (
                    <h3 className="m-0 font-mono text-xs font-normal text-muted-foreground">
                      {example.name}
                    </h3>
                  )}
                  {example.case && <Badge variant="outline">{CASE_LABEL[example.case]}</Badge>}
                </div>
                {example.summary && (
                  <p className="m-0 text-sm text-muted-foreground">{example.summary}</p>
                )}
                <Code code={example.code} language="json" label={example.title ?? example.name} />
              </section>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Examples;
