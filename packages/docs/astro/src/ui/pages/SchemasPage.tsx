/** @jsxImportSource react */
import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '#ui/components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/components/ui/input-group.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { Icon } from '../components/Icon';

export interface SchemaRow {
  name: string;
  id: string;
  version: string;
  domain: string;
  repository: string;
  /** What the contract was written in: JSON Schema, Avro, Protobuf or OpenAPI. */
  format: string;
  owner?: { team: string; href?: string | undefined } | undefined;
  href: string;
  schemaHref: string;
  /** Lower-cased text the filter matches. */
  search: string;
}

export interface SchemasPageProps {
  schemas: SchemaRow[];
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const plural = (count: number) => `${count} ${count === 1 ? 'schema' : 'schemas'}`;

export function SchemasPage({ schemas }: SchemasPageProps) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();

  const isVisible = (row: SchemaRow) => !needle || row.search.includes(needle);

  const shown = schemas.filter(isVisible).length;

  if (schemas.length === 0) {
    return (
      <div className="not-content" data-wide>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="braces" />
            </EmptyMedia>
            <EmptyTitle>No event schemas yet</EmptyTitle>
            <EmptyDescription>
              A repository publishes a schema by committing <code>contracts/</code> or an{' '}
              <code>events/</code> catalog. Each event&apos;s schema appears here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-4" data-wide>
      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Filter schemas"
          placeholder="Filter by event, domain, format or owner"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </InputGroup>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            Schemas
          </CardTitle>
          <CardAction>
            <span className="text-muted-foreground" role="status">
              {shown === schemas.length
                ? plural(schemas.length)
                : `${shown} of ${plural(schemas.length)}`}
            </span>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table aria-label="Schemas" hidden={shown === 0}>
            <TableHeader>
              <TableHead isRowHeader>Event</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Schema</TableHead>
            </TableHeader>
            <TableBody>
              {schemas.map((row) => (
                <TableRow key={row.href} id={row.href} hidden={!isVisible(row)}>
                  <TableCell>
                    <div className="flex flex-col">
                      <a className={`font-medium ${link}`} href={row.href} data-kind="event">
                        {row.name}
                      </a>
                      <code className="text-muted-foreground">{row.id}</code>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code>{row.version}</code>
                  </TableCell>
                  <TableCell>{row.domain}</TableCell>
                  <TableCell>{row.format}</TableCell>
                  <TableCell>
                    {row.owner ? (
                      row.owner.href ? (
                        <a className={link} href={row.owner.href} data-kind="owner">
                          {row.owner.team}
                        </a>
                      ) : (
                        row.owner.team
                      )
                    ) : (
                      <span className="text-muted-foreground">No owner declared</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <a className={link} href={row.schemaHref}>
                      <code>schema.json</code>
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {shown === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>No schema matches</EmptyTitle>
                <EmptyDescription>
                  Try an event name or id, a domain, a format or a team.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onPress={() => setQuery('')}>
                  Clear filter
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SchemasPage;
