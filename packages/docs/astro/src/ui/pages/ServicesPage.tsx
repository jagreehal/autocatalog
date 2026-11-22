/** @jsxImportSource react */
import { useFieldValue } from '#ui/lib/field.ts';
import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Key, SortDescriptor } from 'react-aria-components';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import {
  Empty,
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
import { IconTile } from '../components/IconTile';
import { ExpandButton, SortableHead, TablePager } from '../components/PagedTable';
import { pageOf, rangeLabel, readSort, sortRows, writeSort } from '../lib/paging';

export interface ServiceLink {
  label: string;
  href: string;
}

export interface ServicesPageRow {
  name: string;
  href: string;
  summary?: string | undefined;
  owner?: { team: string; href?: string | undefined } | undefined;
  domains: Array<string>;
  /** The OpenAPI specs it serves. */
  apis: Array<ServiceLink>;
  endpoints: number;
  /** Events it consumes. */
  receives: Array<ServiceLink>;
  /** Events it produces. */
  sends: Array<ServiceLink>;
  /** Other services it calls. */
  calls: Array<ServiceLink>;
  /** Other services that call it. */
  calledBy?: Array<ServiceLink> | undefined;
}

export interface ServicesPageProps {
  services: Array<ServicesPageRow>;
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

/** What reaches the service: the events it consumes and the services that call it. */
const inbound = (row: ServicesPageRow) => [
  ...row.receives,
  ...(row.calledBy ?? []).map((caller) => ({ ...caller, label: `Called by ${caller.label}` })),
];

/** What leaves it: the events it produces and the services it calls. */
const outbound = (row: ServicesPageRow) => [
  ...row.sends,
  ...row.calls.map((call) => ({ ...call, label: `Calls ${call.label}` })),
];

const matches = (row: ServicesPageRow, query: string) =>
  [
    row.name,
    row.summary,
    row.owner?.team,
    ...row.domains,
    ...row.apis.map(({ label }) => label),
    ...inbound(row).map(({ label }) => label),
    ...outbound(row).map(({ label }) => label),
  ].some((value) => value?.toLowerCase().includes(query));

function sortValue(row: ServicesPageRow, column: Key) {
  if (column === 'domain') {
    return row.domains[0] ?? null;
  }

  if (column === 'owner') {
    return row.owner?.team ?? null;
  }

  if (column === 'sends') {
    return outbound(row).length;
  }

  if (column === 'receives') {
    return inbound(row).length;
  }

  return row.name.toLocaleLowerCase();
}

const byName: SortDescriptor = { column: 'name', direction: 'ascending' };

const SORT_COLUMNS = ['name', 'domain', 'owner', 'sends', 'receives'] as const;

/**
 * Every service, one line each: its domain, who owns it, and how much it sends
 * and receives. A row opens to the names behind those counts. Read from events
 * and OpenAPI specs alike, so a catalog with either has a full list.
 */
export function ServicesPage({ services }: ServicesPageProps) {
  const { value: query, setValue: setQuery, field: queryField } = useFieldValue();

  const [sort, setSort] = useState(byName);

  const [page, setPage] = useState(1);

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // `?page=`, `?q=` and the sort from the pager, so a page survives a reload
  // or a new tab showing the same rows.
  useEffect(() => {
    const params = new URLSearchParams(location.search);

    setQuery(params.get('q') ?? '');
    setSort(readSort(params, SORT_COLUMNS, byName));
    setPage(Number(params.get('page')) || 1);
  }, [setQuery]);

  if (services.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="service" />
            </EmptyMedia>
            <EmptyTitle>No services yet</EmptyTitle>
            <EmptyDescription>
              A service appears here once an event names it as a producer or consumer, or an OpenAPI
              spec under <code>contracts/</code> serves it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();

  const shown = sortRows(
    needle ? services.filter((row) => matches(row, needle)) : services,
    sort,
    sortValue,
  );

  const current = pageOf(shown, page);

  const unowned = services.filter((row) => !row.owner).length;

  const toggle = (href: string) =>
    setOpen((was) => {
      const next = new Set(was);

      if (!next.delete(href)) {
        next.add(href);
      }

      return next;
    });

  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <p className="m-0 max-w-prose">
        {plural(services.length, 'service', 'services')}
        {unowned > 0
          ? `, ${plural(unowned, 'with no owner', 'with no owner')} yet.`
          : ', each with an owner.'}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <InputGroup className="max-w-md flex-1 basis-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Filter services"
            placeholder="Filter by service, owner, domain, API or event"
            autoComplete="off"
            {...queryField}
            onChange={(event) => {
              queryField.onChange(event);
              setPage(1);
            }}
          />
        </InputGroup>
        <p
          className="m-0 ml-auto text-xs whitespace-nowrap text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {rangeLabel(current.page, shown.length)} {shown.length === 1 ? 'service' : 'services'}
        </p>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <p className="m-0 text-muted-foreground">No service matches “{query}”.</p>
          ) : (
            <Table
              aria-label="Services"
              sortDescriptor={sort}
              onSortChange={(next) => {
                setSort(next);
                setPage(1);
              }}
            >
              <TableHeader>
                <TableHead id="details">
                  <span className="sr-only">Details</span>
                </TableHead>
                <SortableHead id="name" isRowHeader>
                  Service
                </SortableHead>
                <SortableHead id="domain" className="hidden md:table-cell">
                  Domain
                </SortableHead>
                <SortableHead id="owner" className="hidden sm:table-cell">
                  Owner
                </SortableHead>
                <SortableHead id="sends">Sends</SortableHead>
                <SortableHead id="receives">Receives</SortableHead>
              </TableHeader>
              <TableBody>
                {current.rows.flatMap((row) => {
                  const expanded = open.has(row.href);

                  const line = (
                    <ServiceRow
                      key={row.href}
                      row={row}
                      expanded={expanded}
                      onToggle={() => toggle(row.href)}
                    />
                  );

                  return expanded
                    ? [line, <ServiceDetails key={`${row.href}#details`} row={row} />]
                    : [line];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TablePager
        label="Service pages"
        page={current.page}
        pages={current.pages}
        hrefOf={(target) => {
          const params = new URLSearchParams();

          if (query.trim()) {
            params.set('q', query.trim());
          }

          writeSort(params, sort, byName);
          params.set('page', String(target));

          return `?${params}`;
        }}
        onPage={setPage}
      />
    </div>
  );
}

function Owner({ owner }: { owner: ServicesPageRow['owner'] }) {
  if (!owner) {
    return <span className="text-muted-foreground">Unowned</span>;
  }

  if (!owner.href) {
    return owner.team;
  }

  return (
    <a className={link} href={owner.href}>
      {owner.team}
    </a>
  );
}

function ServiceRow({
  row,
  expanded,
  onToggle,
}: {
  row: ServicesPageRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow id={row.href} data-service>
      <TableCell>
        <ExpandButton expanded={expanded} label={row.name} onToggle={onToggle} />
      </TableCell>
      <TableCell className="whitespace-normal md:whitespace-nowrap">
        <span className="flex items-center gap-3">
          {/* Every row is a service, so a phone spends the tile's width on the counts. */}
          <span className="hidden sm:contents">
            <IconTile name="service" kind="service" />
          </span>
          <a className={`${link} font-medium`} href={row.href}>
            {row.name}
          </a>
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {row.domains.length > 0 ? (
          row.domains.join(', ')
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Owner owner={row.owner} />
      </TableCell>
      <TableCell>{outbound(row).length}</TableCell>
      <TableCell>{inbound(row).length}</TableCell>
    </TableRow>
  );
}

function Names({ title, items, none }: { title: string; items: Array<ServiceLink>; none: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-xs text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <span className="text-muted-foreground">{none}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((item) => (
            <li key={item.href + item.label} className="break-words">
              <a className={link} href={item.href}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a row opens to: the summary, and every name behind its counts. */
function ServiceDetails({ row }: { row: ServicesPageRow }) {
  return (
    <TableRow id={`${row.href}#details`}>
      <TableCell colSpan={6} className="whitespace-normal">
        <div className="flex flex-col gap-4 py-2">
          {row.summary && <p className="m-0 max-w-prose">{row.summary}</p>}
          {/* The columns a narrow screen hides. */}
          <p className="m-0 text-xs text-muted-foreground md:hidden">
            {row.domains.length > 0 ? `In ${row.domains.join(', ')}. ` : ''}
            <span className="sm:hidden">Owned by {row.owner?.team ?? 'nobody yet'}.</span>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Names title="Sends and calls" items={outbound(row)} none="Nothing" />
            <Names title="Receives and is called by" items={inbound(row)} none="Nothing" />
            <div className="flex min-w-0 flex-col gap-1">
              <Names title="Serves" items={row.apis} none="No API" />
              {row.endpoints > 0 && (
                <span className="text-xs text-muted-foreground">
                  {plural(row.endpoints, 'endpoint', 'endpoints')}
                </span>
              )}
            </div>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default ServicesPage;
