/** @jsxImportSource react */
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Code } from './Code';
import { rule, tone } from './Evidence';

// The signature block: one real definition on the left, the catalog entry it
// produces on the right, and a tag on every field saying how it got there.
// This is the whole argument for the tool, so it is the only place on the page
// allowed to be loud.
const source = `import { defineEvent } from 'autocatalog-adapter-zod';
import { z } from 'zod';

export default [
  defineEvent(
    {
      domain: 'payments',
      producers: ['PaymentService'],
      consumers: ['LedgerService'],
    },
    z.object({
      id: z.string(),
      amount: z.number().positive(),
      currency: z.string(),
      completedAt: z.string().datetime(),
    }),
  ),
];`;

const inDefineEvent = (
  <>
    in <code className="font-mono">defineEvent()</code>
  </>
);

type Origin = 'declared' | 'extracted' | 'inferred';

const fields: Array<{
  name: string;
  value: string;
  origin: Origin;
  how: ReactNode;
  review?: true;
  /** The value is a description, not code, so it is not set in mono. */
  prose?: true;
}> = [
  { name: 'id', value: 'payment.completed', origin: 'extracted', how: 'from the export name' },
  { name: 'domain', value: 'payments', origin: 'declared', how: inDefineEvent },
  { name: 'producers', value: 'PaymentService', origin: 'declared', how: inDefineEvent },
  { name: 'consumers', value: 'LedgerService', origin: 'declared', how: inDefineEvent },
  {
    name: 'schema',
    value: '4 fields, all required',
    prose: true,
    origin: 'extracted',
    how: 'from zod, as JSON Schema',
  },
  {
    name: 'version',
    value: '1.0.0',
    origin: 'inferred',
    how: 'because none was declared',
    review: true,
  },
];

const legend: Array<{ origin: Origin; meaning: string }> = [
  { origin: 'extracted', meaning: 'read out of the code' },
  { origin: 'declared', meaning: 'a person wrote it down' },
  { origin: 'inferred', meaning: 'a guess, and flagged as one' },
];

const said: Record<Origin, string> = {
  extracted: 'Extracted',
  declared: 'Declared',
  inferred: 'Inferred',
};

export function ProvenanceStrip() {
  return (
    <section className="not-content @container flex flex-col gap-6" aria-labelledby="provenance">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold tracking-tight" id="provenance">
          One definition, and what the catalog knows about it
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          Every field says where it came from. The rule beside it is its provenance, dashed where
          the catalog had to guess.
        </p>
      </header>

      <div className="grid items-start gap-6 @3xl:grid-cols-2 @3xl:gap-10">
        <Code code={source} language="typescript" label="The event's definition" />

        <dl className="m-0 flex flex-col gap-3">
          {fields.map((field) => (
            <div
              className={cn(
                'grid gap-x-4 gap-y-1 border-0 border-l-2 py-0.5 pl-3 @md:grid-cols-4',
                rule[field.origin],
              )}
              key={field.name}
              data-origin={field.origin}
            >
              <dt className="font-mono text-sm text-muted-foreground">{field.name}</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2 text-sm @md:col-span-3">
                <span className={cn(!field.prose && 'font-mono', 'wrap-anywhere')}>
                  {field.value}
                </span>
                {field.review && <Badge variant="outline">Needs review</Badge>}
              </dd>
              <dd className="m-0 text-xs text-muted-foreground @md:col-span-3 @md:col-start-2">
                <span className={cn('font-medium', tone[field.origin])}>{said[field.origin]}</span>{' '}
                {field.how}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="m-0 flex list-none flex-wrap gap-x-8 gap-y-2 p-0 text-sm text-muted-foreground">
        {legend.map((item) => (
          <li className="flex items-center gap-2" key={item.origin} data-origin={item.origin}>
            <span className={cn('h-4 border-0 border-l-2', rule[item.origin])} aria-hidden="true" />
            <span className={cn('font-medium', tone[item.origin])}>{said[item.origin]}</span>
            {item.meaning}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ProvenanceStrip;
