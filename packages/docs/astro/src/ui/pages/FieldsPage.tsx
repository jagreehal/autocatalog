/** @jsxImportSource react */
import { SearchIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button } from '#ui/components/ui/button.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import { Checkbox } from '#ui/components/ui/checkbox.tsx';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Field, FieldLabel } from '#ui/components/ui/field.tsx';
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

/** One event that carries a field. */
export interface FieldCarrier {
  eventId: string;
  /** Absent when the event has no page to link to. */
  href?: string | undefined;
  /** Named only when two repositories publish the same event id. */
  repository?: string | undefined;
  optional: boolean;
}

export interface FieldRow {
  path: string;
  /** Present when events disagree on the field's type or whether it is required. */
  conflict: string | null;
  types: string[];
  carriers: FieldCarrier[];
  /** Services a change to the field would reach. */
  consumers: Array<{ name: string; href: string }>;
  /** Lower-cased text the filter matches: the path, its events, its services. */
  search: string;
}

export interface FieldsPageProps {
  fields: FieldRow[];
  eventCount: number;
  /** How many fields disagree between events. */
  conflicts: number;
  /** Where the events are listed in the catalog. */
  eventsHref: string;
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function FieldsPage({ fields, eventCount, conflicts, eventsHref }: FieldsPageProps) {
  const [query, setQuery] = useState('');

  const [onlyConflicts, setOnlyConflicts] = useState(false);

  const needle = query.trim().toLowerCase();

  const isVisible = (field: FieldRow) =>
    (!needle || field.search.includes(needle)) && (!onlyConflicts || field.conflict !== null);

  const shown = fields.filter(isVisible).length;

  if (fields.length === 0) {
    return (
      <div className="not-content flex flex-col gap-8" data-wide>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="fields" />
            </EmptyMedia>
            <EmptyTitle>No fields to list yet</EmptyTitle>
            <EmptyDescription>
              Fields are read from each event&apos;s schema. Once an event has a{' '}
              <code>schema.json</code>, its fields and the services they reach appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <p className="m-0 max-w-prose">
        {plural(fields.length, 'field', 'fields')} across{' '}
        <a className={link} href={eventsHref}>
          {plural(eventCount, 'event', 'events')}
        </a>
        .{' '}
        {conflicts > 0
          ? `${plural(conflicts, 'field disagrees', 'fields disagree')} between events on its type or whether it is required.`
          : 'Every field agrees between the events that carry it.'}
      </p>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <InputGroup className="max-w-md flex-1 basis-72">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Filter fields"
              placeholder="Filter by field, event or service"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          {conflicts > 0 && (
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id="fields-conflicts"
                isSelected={onlyConflicts}
                onChange={setOnlyConflicts}
              />
              <FieldLabel htmlFor="fields-conflicts">Only fields that disagree</FieldLabel>
            </Field>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Fields
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground" role="status">
                {shown === fields.length
                  ? plural(fields.length, 'field', 'fields')
                  : `${shown} of ${plural(fields.length, 'field', 'fields')}`}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table aria-label="Fields" hidden={shown === 0}>
              <TableHeader>
                <TableHead isRowHeader>Field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Carried by</TableHead>
                <TableHead>Reaches</TableHead>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow
                    key={field.path}
                    id={field.path}
                    data-search={field.search}
                    hidden={!isVisible(field)}
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <code>{field.path}</code>
                        {field.conflict && <Badge variant="destructive">{field.conflict}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code>{field.types.join(' | ')}</code>
                    </TableCell>
                    <TableCell>
                      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 whitespace-normal">
                        {field.carriers.map((carrier) => (
                          <li
                            key={`${carrier.eventId}|${carrier.repository ?? ''}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            <Resource kind="event" href={carrier.href}>
                              <code>{carrier.eventId}</code>
                            </Resource>
                            {(carrier.repository || carrier.optional) && (
                              <span className="text-muted-foreground">
                                {[
                                  carrier.repository && `in ${carrier.repository}`,
                                  carrier.optional && 'optional',
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      {field.consumers.length === 0 ? (
                        <span className="text-muted-foreground">No consumer declared</span>
                      ) : (
                        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 whitespace-normal">
                          {field.consumers.map((consumer) => (
                            <li key={consumer.name}>
                              <Resource kind="service" href={consumer.href}>
                                {consumer.name}
                              </Resource>
                            </li>
                          ))}
                        </ul>
                      )}
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
                  <EmptyTitle>No field matches</EmptyTitle>
                  <EmptyDescription>
                    Nothing carries that name. Try a field path, an event id or a service.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => {
                      setQuery('');
                      setOnlyConflicts(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A resource named in a cell: its kind as an icon, linked when it has a page. */
function Resource({
  kind,
  href,
  children,
}: {
  kind: 'event' | 'service';
  href?: string | undefined;
  children: ReactNode;
}) {
  const content = (
    <>
      <Icon name={kind} className="size-3.5 shrink-0 text-muted-foreground" />
      {children}
    </>
  );

  return href ? (
    <a className={`inline-flex items-center gap-1 ${link}`} href={href} data-kind={kind}>
      {content}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1" data-kind={kind}>
      {content}
    </span>
  );
}

export default FieldsPage;
