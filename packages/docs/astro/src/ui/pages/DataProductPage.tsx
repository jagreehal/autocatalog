/** @jsxImportSource react */
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Graph } from '../components/Graph';
import type { VisualiserGraph } from '../lib/visualiser';

export interface DataProductPort {
  name: string;
  href?: string | undefined;
  /** As the frontmatter writes it. */
  reference: string;
  contract?: string | undefined;
}

export interface DataProductPageProps {
  repository: string;
  file: string;
  domain?: { name: string; href?: string | undefined } | undefined;
  visualiser: VisualiserGraph;
  inputs: DataProductPort[];
  outputs: DataProductPort[];
  narrativeHtml?: string | null | undefined;
}

function Ports({ title, id, ports }: { title: string; id: string; ports: DataProductPort[] }) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="m-0 flex flex-col gap-2 pl-4">
          {ports.map((port) => (
            <li key={port.reference}>
              {port.href ? (
                <a
                  href={port.href}
                  className="text-foreground underline underline-offset-4 hover:text-primary"
                >
                  {port.name}
                </a>
              ) : (
                port.name
              )}{' '}
              <code className="text-xs text-muted-foreground">{port.reference}</code>
              {port.contract && (
                <>
                  {' '}
                  under the contract <code>{port.contract}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** A data product: what feeds it, what it publishes, and the contract each output keeps. */
export function DataProductPage({
  repository,
  file,
  domain,
  visualiser,
  inputs,
  outputs,
  narrativeHtml,
}: DataProductPageProps) {
  const list = (
    <div className="not-content grid gap-4 md:grid-cols-2">
      {inputs.length > 0 && <Ports title="Inputs" id="inputs" ports={inputs} />}
      {outputs.length > 0 && <Ports title="Outputs" id="outputs" ports={outputs} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-8" data-wide>
      <p className="not-content m-0 max-w-prose">
        Declared in <code>{file}</code> in the {repository} repository
        {domain && (
          <>
            , in the{' '}
            {domain.href ? (
              <a href={domain.href} className="text-foreground underline underline-offset-4">
                {domain.name}
              </a>
            ) : (
              domain.name
            )}{' '}
            domain
          </>
        )}
        .
      </p>

      <Graph
        id="data-product"
        label="Data product"
        visualiser={visualiser}
        height="20rem"
        fallback={list}
      />

      {list}

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default DataProductPage;
