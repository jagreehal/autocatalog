/** @jsxImportSource react */
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Evidence, type EvidenceView } from '../components/Evidence';
import { Icon } from '../components/Icon';
import { ServiceList, type ServiceLink } from './DataModelsPage';

export interface DataModelField {
  /** Dotted for a field of an embedded type: `address.city`. */
  name: string;
  /** As the schema declares it, `[]` for a list. */
  type: string;
  required: boolean;
  /** The database's own name, when it differs. */
  column?: string;
  primary?: boolean;
  unique?: boolean;
  default?: string;
  updatedAt?: boolean;
  values?: string[];
  doc?: string;
  /** The model whose key this column holds. */
  references?: string;
  /** Set on a relation rather than a column. */
  relation?: {
    model: string;
    href?: string | undefined;
    many: boolean;
    /** This side stores the related key. */
    holdsKey: boolean;
    name?: string;
  };
}

export interface DataModelPageProps {
  store: 'table' | 'collection';
  /** Its own name in the database. */
  name: string;
  /** `datastore/database`, when the code names one. */
  datastore?: string;
  adapter?: string | undefined;
  repository: string;
  provenance: EvidenceView;
  /** The definition on the repository's host, at its line. */
  sourceHref?: string;
  owner?: { team: string; href?: string | undefined };
  fields: DataModelField[];
  indexes: Array<{ fields: string[]; unique: boolean; primary?: boolean; name?: string }>;
  readers: ServiceLink[];
  writers: ServiceLink[];
  /** Mermaid `erDiagram` source: the model and the models one relation away. */
  diagram?: string | undefined;
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function FieldName({ field }: { field: DataModelField }) {
  return (
    <div className="flex flex-col gap-0.5">
      <code className="font-medium">{field.name}</code>
      {field.doc && <span className="text-muted-foreground">{field.doc}</span>}
    </div>
  );
}

export function DataModelPage({
  store,
  name,
  datastore,
  adapter,
  repository,
  provenance,
  sourceHref,
  owner,
  fields,
  indexes,
  readers,
  writers,
  diagram,
}: DataModelPageProps) {
  const columns = fields.filter((field) => !field.relation);
  const relations = fields.filter((field) => field.relation);

  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <Evidence {...provenance} />

      <p className="m-0 max-w-prose">
        The <code>{name}</code> {store}
        {datastore && (
          <>
            {' '}
            in <code>{datastore}</code>
          </>
        )}
        {adapter && <>, read from its {adapter} definition</>} in the {repository} repository
        {sourceHref && (
          <>
            {' '}
            (
            <a className={link} href={sourceHref}>
              view source
            </a>
            )
          </>
        )}
        .
        {owner && (
          <>
            {' '}
            Owned by{' '}
            {owner.href ? (
              <a className={link} href={owner.href} data-kind="owner">
                {owner.team}
              </a>
            ) : (
              owner.team
            )}
            .
          </>
        )}{' '}
        {readers.length > 0 ? (
          <>
            Read by <ServiceList services={readers} />
            {writers.length > 0 ? '; written by ' : '.'}
          </>
        ) : (
          writers.length > 0 && 'Written by '
        )}
        {writers.length > 0 && (
          <>
            <ServiceList services={writers} />.
          </>
        )}
        {readers.length === 0 &&
          writers.length === 0 &&
          'No code that reads or writes it was found.'}
      </p>

      <Card id="fields">
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Fields
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground">{count(columns.length, 'field')}</span>
          </CardAction>
        </CardHeader>
        <CardContent>
          {columns.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name="data" />
                </EmptyMedia>
                <EmptyTitle>No fields recorded</EmptyTitle>
                <EmptyDescription>
                  The catalog knows this {store} by name only. Run <code>ac resources scan</code> in
                  the repository whose Prisma, Drizzle or Mongoose code defines it, and its fields
                  appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table aria-label="Fields">
              <TableHeader>
                <TableHead isRowHeader>Field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Constraints</TableHead>
              </TableHeader>
              <TableBody>
                {columns.map((field) => (
                  <TableRow key={field.name}>
                    <TableCell>
                      <FieldName field={field} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <code>{field.type}</code>
                        {field.values && (
                          <span className="text-muted-foreground">
                            One of{' '}
                            {field.values.map((value, i) => (
                              <span key={value}>
                                {i > 0 && ', '}
                                <code>{value}</code>
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{field.required ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {(field.primary || field.unique || field.references) && (
                          <div className="flex flex-wrap gap-1">
                            {field.primary && <Badge variant="secondary">Primary key</Badge>}
                            {field.unique && <Badge variant="outline">Unique</Badge>}
                            {field.references && (
                              <Badge variant="outline">Key of {field.references}</Badge>
                            )}
                          </div>
                        )}
                        {field.default !== undefined && (
                          <span className="text-muted-foreground">
                            Defaults to <code>{field.default}</code>
                          </span>
                        )}
                        {field.updatedAt && (
                          <span className="text-muted-foreground">Set on every update</span>
                        )}
                        {field.column && (
                          <span className="text-muted-foreground">
                            Stored as <code>{field.column}</code>
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {relations.length > 0 && (
        <Card id="relations">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Relations
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">{count(relations.length, 'relation')}</span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table aria-label="Relations">
              <TableHeader>
                <TableHead isRowHeader>Field</TableHead>
                <TableHead>Related model</TableHead>
                <TableHead>Holds</TableHead>
              </TableHeader>
              <TableBody>
                {relations.map(({ relation, ...field }) => (
                  <TableRow key={field.name}>
                    <TableCell>
                      <FieldName field={field} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {relation!.href ? (
                          <a className={link} href={relation!.href}>
                            {relation!.model}
                          </a>
                        ) : (
                          relation!.model
                        )}
                        {relation!.name && (
                          <span className="text-muted-foreground">
                            Named <code>{relation!.name}</code>
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {relation!.many ? 'Many' : field.required ? 'One' : 'One or none'}
                        <span className="text-muted-foreground">
                          {relation!.holdsKey ? 'Key stored here' : `Key on ${relation!.model}`}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {diagram && (
        <Card id="diagram">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Entity relationships
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">One relation away</span>
            </CardAction>
          </CardHeader>
          <CardContent>
            {/* Drawn by the site's Mermaid script; without it, the source reads as text. */}
            <pre className="mermaid not-content m-0 overflow-x-auto">{diagram}</pre>
          </CardContent>
        </Card>
      )}

      {indexes.length > 0 && (
        <Card id="indexes">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Indexes
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">
                {count(indexes.length, 'index', 'indexes')}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table aria-label="Indexes">
              <TableHeader>
                <TableHead isRowHeader>Fields</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Name</TableHead>
              </TableHeader>
              <TableBody>
                {indexes.map((index) => (
                  <TableRow key={`${index.fields.join(',')}|${index.unique}`}>
                    <TableCell>
                      {index.fields.map((field, i) => (
                        <span key={field}>
                          {i > 0 && ', '}
                          <code>{field}</code>
                        </span>
                      ))}
                    </TableCell>
                    <TableCell>
                      {index.primary ? 'Primary key' : index.unique ? 'Unique' : 'Index'}
                    </TableCell>
                    <TableCell>
                      {index.name ? (
                        <code>{index.name}</code>
                      ) : (
                        <span className="text-muted-foreground">Unnamed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DataModelPage;
