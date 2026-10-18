/** @jsxImportSource react */
import { Fragment } from 'react';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Icon } from '../components/Icon';

export interface ServiceLink {
  name: string;
  href: string;
}

export interface DataModelsPageProps {
  models: Array<{
    /** The name the code gives it. */
    title: string;
    href: string;
    store: 'table' | 'collection';
    /** The table or collection's own name in the database. */
    name: string;
    /** `datastore/database`, when the code names one. */
    datastore?: string;
    /** The library it was read from: prisma, drizzle, mongoose. */
    adapter?: string | undefined;
    repository: string;
    owner?: string | undefined;
    /** Its columns, relations left out. */
    fields: number;
    readers: ServiceLink[];
    writers: ServiceLink[];
  }>;
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

/** Services as a sentence's list: "a, b and c". */
export function ServiceList({ services }: { services: ServiceLink[] }) {
  return services.map((service, i) => (
    <Fragment key={service.name}>
      {i > 0 && (i === services.length - 1 ? ' and ' : ', ')}
      <a className={link} href={service.href} data-kind="service">
        {service.name}
      </a>
    </Fragment>
  ));
}

export function DataModelsPage({ models }: DataModelsPageProps) {
  return (
    <div className="not-content" data-wide>
      {models.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="data" />
            </EmptyMedia>
            <EmptyTitle>No data models yet</EmptyTitle>
            <EmptyDescription>
              Commit a Prisma schema, Drizzle tables or Mongoose models, or run{' '}
              <code>ac resources scan</code> in a repository, and its models appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table aria-label="Data models">
              <TableHeader>
                <TableHead isRowHeader>Model</TableHead>
                <TableHead>Stored in</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Read by</TableHead>
                <TableHead>Written by</TableHead>
              </TableHeader>
              <TableBody>
                {models.map((model) => (
                  <TableRow key={model.href} id={model.href}>
                    <TableCell>
                      <div className="flex flex-col">
                        <a
                          href={model.href}
                          className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
                        >
                          {model.title}
                        </a>
                        {model.name !== model.title && (
                          <code className="text-muted-foreground">{model.name}</code>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>
                          {model.store === 'collection' ? 'Collection' : 'Table'}
                          {model.adapter && `, from ${model.adapter}`}
                        </span>
                        {model.datastore && (
                          <code className="text-muted-foreground">{model.datastore}</code>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{model.repository}</TableCell>
                    <TableCell>
                      {model.owner ?? <span className="text-muted-foreground">Not declared</span>}
                    </TableCell>
                    <TableCell>{model.fields}</TableCell>
                    <TableCell>
                      {model.readers.length ? (
                        <ServiceList services={model.readers} />
                      ) : (
                        <span className="text-muted-foreground">None found</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {model.writers.length ? (
                        <ServiceList services={model.writers} />
                      ) : (
                        <span className="text-muted-foreground">None found</span>
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

export default DataModelsPage;
