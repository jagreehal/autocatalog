/** @jsxImportSource react */
import type { OdcsContract, TrackRecord } from 'autocatalog-docs-core';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';

const link = 'text-foreground underline underline-offset-4 hover:text-primary';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const date = (at: string) => new Date(at).toISOString().slice(0, 10);

/** "kept 29 of the last 30 runs", or nothing when no check measured it. */
function kept(record: TrackRecord | undefined, property: string, element: string | undefined) {
  const found = record?.slas.find(
    (s) => s.property === property && (element === undefined || s.element === element),
  );

  return found ? `kept ${found.kept} of the last ${found.measured}` : undefined;
}

/**
 * An ODCS contract as its reader needs it: an output's promises with how well
 * they were kept, or an input's expectations. The contract file is the source;
 * this is its product details page.
 */
/** The card's anchor: one per contract version, and apart for an input's expectation. */
export function contractAnchor(
  contract: Pick<OdcsContract, 'id' | 'version'>,
  expectation = false,
) {
  const slug = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, '-');

  return `${expectation ? 'expects' : 'contract'}-${slug(contract.id)}-v${slug(contract.version)}`;
}

export function DataContract({
  contract,
  file,
  trackRecord,
  expectation = false,
  about,
}: {
  contract: OdcsContract;
  file: string;
  trackRecord?: TrackRecord | undefined;
  /** An input's contract: what this product expects, not what it promises. */
  expectation?: boolean;
  /** The port it is on, for the heading. */
  about: string;
}) {
  const { terms, ai } = contract;
  const hasTerms = terms.purpose || terms.usage || terms.limitations;

  return (
    <Card id={contractAnchor(contract, expectation)}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {expectation ? `What it expects of ${about}` : `${contract.name ?? contract.id}`}{' '}
          <span className="font-normal text-muted-foreground">{contract.version}</span>
        </CardTitle>
        <CardAction>
          <span className="flex items-center gap-2">
            {contract.status && <Badge variant="outline">{contract.status}</Badge>}
            <code className="text-xs text-muted-foreground">{file}</code>
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {!expectation && trackRecord && trackRecord.runs > 0 && (
            <p className="m-0">
              Checked {trackRecord.runs} {trackRecord.runs === 1 ? 'time' : 'times'}: every promise
              kept on {trackRecord.passed}.
              {trackRecord.last && (
                <>
                  {' '}
                  Last checked {date(trackRecord.last.at)}:{' '}
                  <Badge
                    variant={trackRecord.last.status === 'failed' ? 'destructive' : 'secondary'}
                  >
                    {trackRecord.last.status}
                  </Badge>
                </>
              )}
            </p>
          )}

          {!expectation && hasTerms && (
            <Section title="Terms of use">
              <dl className="m-0 flex flex-col gap-1">
                {(['purpose', 'usage', 'limitations'] as const).map(
                  (key) =>
                    terms[key] && (
                      <div key={key} className="flex gap-4">
                        <dt className="text-muted-foreground capitalize">{key}</dt>
                        <dd className="m-0">{terms[key]}</dd>
                      </div>
                    ),
                )}
              </dl>
            </Section>
          )}

          {contract.slas.length > 0 && (
            <Section title={expectation ? 'Service levels it needs' : 'Service levels'}>
              <Table aria-label="Service levels">
                <TableHeader>
                  <TableHead isRowHeader>Promise</TableHead>
                  <TableHead>On</TableHead>
                  {!expectation && <TableHead>Track record</TableHead>}
                </TableHeader>
                <TableBody>
                  {contract.slas.map((sla) => (
                    <TableRow key={`${sla.property}:${sla.element ?? ''}`}>
                      <TableCell>
                        {sla.property} {sla.promise}
                        {sla.description && (
                          <span className="block text-muted-foreground">{sla.description}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {sla.element ? <code>{sla.element}</code> : 'every object'}
                      </TableCell>
                      {!expectation && (
                        <TableCell>
                          {kept(trackRecord, sla.property, sla.element) ?? (
                            <span className="text-muted-foreground">not checked</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Section>
          )}

          {contract.objects.map((object) => (
            <Section
              key={object.name}
              title={`${object.name}${object.physicalType ? ` (${object.physicalType})` : ''}${object.rules ? `, ${object.rules} quality ${object.rules === 1 ? 'rule' : 'rules'}` : ''}`}
            >
              {object.description && <p className="m-0">{object.description}</p>}
              {object.columns.length > 0 && (
                <Table aria-label={`${object.name} columns`}>
                  <TableHeader>
                    <TableHead isRowHeader>Column</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Meaning</TableHead>
                  </TableHeader>
                  <TableBody>
                    {object.columns.map((column) => (
                      <TableRow key={column.name}>
                        <TableCell>
                          <code>{column.name}</code>
                          {column.businessName && (
                            <span className="block text-muted-foreground">
                              {column.businessName}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-1">
                            {column.type ?? <span className="text-muted-foreground">any</span>}
                            {column.primaryKey ? (
                              <Badge variant="outline">key</Badge>
                            ) : (
                              column.required && <Badge variant="outline">required</Badge>
                            )}
                            {column.classification && (
                              <Badge variant="secondary">{column.classification}</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {column.description ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          ))}

          {!expectation &&
            (ai.instructions || ai.constraints.length > 0 || ai.verifiedStatements.length > 0) && (
              <Section title="For agents">
                {ai.instructions && <p className="m-0">{ai.instructions}</p>}
                {ai.constraints.length > 0 && (
                  <ul className="m-0 pl-4">
                    {ai.constraints.map((constraint) => (
                      <li key={constraint}>{constraint}</li>
                    ))}
                  </ul>
                )}
                {ai.verifiedStatements.map((statement) => (
                  <div key={statement.question}>
                    <p className="m-0 font-medium">{statement.question}</p>
                    {statement.answer && (
                      <pre className="m-0 mt-1 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                        <code>{statement.answer}</code>
                      </pre>
                    )}
                  </div>
                ))}
              </Section>
            )}

          {!expectation && (contract.team || contract.support.length > 0) && (
            <Section title="Owner and support">
              <p className="m-0">
                {contract.team && <>Owned by {contract.team}. </>}
                {contract.support.map((s, i) => (
                  <span key={`${s.channel ?? ''}${i}`}>
                    {i > 0 && ', '}
                    {s.url ? (
                      <a className={link} href={s.url}>
                        {s.channel ?? s.url}
                      </a>
                    ) : (
                      s.channel
                    )}
                    {s.tool && ` on ${s.tool}`}
                  </span>
                ))}
              </p>
            </Section>
          )}

          {!expectation &&
            (contract.servers.length > 0 || contract.roles.length > 0 || contract.price) && (
              <Section title="Access">
                <ul className="m-0 pl-4">
                  {contract.servers.map((s) => (
                    <li key={`server-${s.server}`}>
                      <code>{s.server}</code>
                      {[s.type, s.environment].filter(Boolean).length > 0 &&
                        `: ${[s.type, s.environment].filter(Boolean).join(', ')}`}
                    </li>
                  ))}
                  {contract.roles.map((r) => (
                    <li key={`role-${r.role}`}>
                      role <code>{r.role}</code>
                      {r.access && ` (${r.access})`}
                      {r.description && `: ${r.description}`}
                    </li>
                  ))}
                  {contract.price && <li>Price: {contract.price}</li>}
                </ul>
              </Section>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
