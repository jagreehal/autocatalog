/** @jsxImportSource react */
import type React from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';

interface Link {
  name: string;
  href?: string | undefined;
}

export interface EntityProperty {
  name: string;
  type: string;
  required: boolean;
  description?: string | undefined;
  enum?: string[] | undefined;
  references?: Link | undefined;
  properties: EntityProperty[];
}

export interface EntityPageProps {
  repository: string;
  file: string;
  aggregateRoot: boolean;
  identifier?: string | undefined;
  domains: Link[];
  services: Link[];
  properties: EntityProperty[];
  /** The events whose schema carries the identifier. */
  carriedBy: Link[];
  /** This entity and the ones it shares a reference with, as Mermaid. */
  diagram: string | null;
  narrativeHtml?: string | null | undefined;
}

const LinkTo = ({ link }: { link: Link }) =>
  link.href ? (
    <a href={link.href} className="text-foreground underline underline-offset-4 hover:text-primary">
      {link.name}
    </a>
  ) : (
    <span>{link.name}</span>
  );

const Links = ({ links }: { links: Link[] }) => (
  <>
    {links.map((link, index) => (
      <span key={link.name}>
        {index > 0 && ', '}
        <LinkTo link={link} />
      </span>
    ))}
  </>
);

// A nested property by its path, `card.last4`, as the field index names it.
function Rows({
  properties,
  parent,
}: {
  properties: EntityProperty[];
  parent?: string;
}): React.ReactElement[] {
  return properties.flatMap((property): React.ReactElement[] => [
    <TableRow key={`${parent ?? ''}.${property.name}`} id={parent ? undefined : property.name}>
      <TableCell>
        <code>{parent ? `${parent}.${property.name}` : property.name}</code>
        {property.required && <span className="text-muted-foreground"> required</span>}
      </TableCell>
      <TableCell>
        {property.references ? <LinkTo link={property.references} /> : <code>{property.type}</code>}
        {property.enum && (
          <span className="text-muted-foreground"> one of {property.enum.join(', ')}</span>
        )}
      </TableCell>
      <TableCell>{property.description}</TableCell>
    </TableRow>,
    ...Rows({
      properties: property.properties,
      parent: parent ? `${parent}.${property.name}` : property.name,
    }),
  ]);
}

/** One entity: its properties, who holds it, and the events its identifier travels in. */
export function EntityPage({
  repository,
  file,
  aggregateRoot,
  identifier,
  domains,
  services,
  properties,
  carriedBy,
  diagram,
  narrativeHtml,
}: EntityPageProps) {
  return (
    <div className="flex flex-col gap-8" data-wide>
      <div className="not-content flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {aggregateRoot && <Badge>Aggregate root</Badge>}
          <p className="m-0 max-w-prose">
            Defined in <code>{file}</code> in the {repository} repository
            {identifier && (
              <>
                , identified by <code>{identifier}</code>
              </>
            )}
            .
          </p>
        </div>
        {domains.length > 0 && (
          <p className="m-0">
            Domain: <Links links={domains} />
          </p>
        )}
        {services.length > 0 && (
          <p className="m-0">
            Held by <Links links={services} />
          </p>
        )}
      </div>

      {diagram && <pre className="mermaid not-content">{diagram}</pre>}

      <div className="not-content flex flex-col gap-4">
        {properties.length > 0 && (
          <Card id="properties">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Properties
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table aria-label="Properties">
                <TableHeader>
                  <TableHead isRowHeader>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                </TableHeader>
                <TableBody>{Rows({ properties })}</TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {identifier && (
          <Card id="events">
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Events that carry {identifier}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {carriedBy.length > 0 ? (
                <ul className="m-0 flex flex-col gap-1 pl-4">
                  {carriedBy.map((event) => (
                    <li key={event.href ?? event.name}>
                      <LinkTo link={event} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-muted-foreground">
                  No event schema in the catalog has a field named {identifier}.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {narrativeHtml && <div dangerouslySetInnerHTML={{ __html: narrativeHtml }} />}
    </div>
  );
}

export default EntityPage;
