/** @jsxImportSource react */
import { useFieldValue } from '#ui/lib/field.ts';
import { cn } from 'cn';
import { ChevronRightIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Key, SortDescriptor } from 'react-aria-components';
import { Button } from '#ui/components/ui/button.tsx';
import { Card, CardContent } from '#ui/components/ui/card.tsx';
import { Collapsible, CollapsibleContent } from '#ui/components/ui/collapsible.tsx';
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
import { Toggle } from '#ui/components/ui/toggle.tsx';
import { ToggleGroup, ToggleGroupItem } from '#ui/components/ui/toggle-group.tsx';
import { kindIcon } from '../../icons';
import { pageOf, pageOfIndex, rangeLabel, readSort, sortRows, writeSort } from '../lib/paging';
import type { ExplorerModel, ExplorerRow } from './catalog-explorer-model';
import { Code } from './Code';
import { Evidence, isMethod, rule, tone } from './Evidence';
import type { ProvenanceMethod } from './Evidence';
import { Icon } from './Icon';
import { IconTile } from './IconTile';
import { ExpandButton, SortableHead, TablePager } from './PagedTable';
import { Stats } from './Stats';

export interface CatalogExplorerProps {
  /** The graph, ready to draw; see `explorerModel`, which builds it where autocatalog-core can run. */
  model: ExplorerModel;
}

interface Filters {
  kind: string;
  query: string;
  reviewOnly: boolean;
}

const everything: Filters = { kind: 'all', query: '', reviewOnly: false };

function filterRows(rows: Array<ExplorerRow>, { kind, query, reviewOnly }: Filters) {
  const needle = query.trim().toLocaleLowerCase();

  return rows.filter(
    (row) =>
      (kind === 'all' || row.kind === kind) &&
      (!needle || row.searchText.includes(needle)) &&
      (!reviewOnly || row.needsReview),
  );
}

function sortValue(row: ExplorerRow, column: Key) {
  if (column === 'name') {
    return row.title.toLocaleLowerCase();
  }

  if (column === 'owner') {
    return row.owner;
  }

  if (column === 'source') {
    return row.at;
  }

  return row.key;
}

const byKey: SortDescriptor = { column: 'key', direction: 'ascending' };

const SORT_COLUMNS = ['name', 'key', 'owner', 'source'] as const;

// Anchors are percent-encoded keys; a hand-typed fragment may not be.
const isAnchorOf = (row: ExplorerRow, hash: string) =>
  hash === row.anchor || hash === decodeURIComponent(row.anchor);

export function CatalogExplorer({ model }: CatalogExplorerProps) {
  const { value: query, setValue: setQuery, field: queryField } = useFieldValue();

  const [kind, setKind] = useState('all');

  const [reviewOnly, setReviewOnly] = useState(false);

  const [sort, setSort] = useState(byKey);

  const [page, setPage] = useState(1);

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // The row a fragment named, scrolled to once its page has drawn.
  const [landing, setLanding] = useState<string | null>(null);

  const filters: Filters = { kind, query, reviewOnly };

  const apply = (next: Filters) => {
    setKind(next.kind);
    setQuery(next.query);
    setReviewOnly(next.reviewOnly);
    setPage(1);
  };

  // `#resource-…` names one row, which may sit on a later page or behind the
  // current filters: show the whole graph if it must, turn to the row's page
  // and open it.
  const land = (from: Filters, by: SortDescriptor = sort) => {
    const hash = location.hash.slice(1);

    const row = hash ? model.rows.find((candidate) => isAnchorOf(candidate, hash)) : undefined;

    if (!row) {
      return;
    }

    const view = filterRows(model.rows, from).includes(row) ? from : everything;

    apply(view);
    setPage(pageOfIndex(sortRows(filterRows(model.rows, view), by, sortValue).indexOf(row)));
    setOpen((was) => new Set(was).add(row.key));
    setLanding(row.anchor);
  };

  // `?kind=service` opens the explorer on one kind, which is how the rail's
  // Services entry lands here; `?q=` and `?review=1` arrive from wiki links and
  // the homepage's review count, and `?page=` from the pager.
  useEffect(() => {
    const params = new URLSearchParams(location.search);

    const named = params.get('kind') ?? 'all';

    const initial: Filters = {
      kind: model.kinds.includes(named) ? named : 'all',
      query: params.get('q') ?? '',
      reviewOnly: params.get('review') === '1',
    };

    const sorted = readSort(params, SORT_COLUMNS, byKey);

    apply(initial);
    setSort(sorted);
    setPage(Number(params.get('page')) || 1);
    land(initial, sorted);
  }, [model]);

  // A connection, the datastore table or any other link on the page can name
  // a row by its fragment. Registered each render, so it sees the current view.
  useEffect(() => {
    const onHashChange = () => land(filters);

    addEventListener('hashchange', onHashChange);

    return () => removeEventListener('hashchange', onHashChange);
  });

  const shown = sortRows(filterRows(model.rows, filters), sort, sortValue);

  const current = pageOf(shown, page);

  const hrefOf = (target: number) => {
    const params = new URLSearchParams();

    if (kind !== 'all') {
      params.set('kind', kind);
    }

    if (query) {
      params.set('q', query);
    }

    if (reviewOnly) {
      params.set('review', '1');
    }

    writeSort(params, sort, byKey);
    params.set('page', String(target));

    return `?${params}`;
  };

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);

      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });

  const noun = shown.length === 1 ? 'resource' : 'resources';

  const range = rangeLabel(current.page, shown.length);

  return (
    <section className="not-content flex flex-col gap-4" data-catalog-explorer>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6">
        <Stats
          label="Graph totals"
          items={[
            { label: 'Resources', value: model.rows.length },
            { label: 'Relationships', value: model.relationships },
            { label: 'Need review', value: model.review },
          ]}
        />
        <p className="m-0 text-xs text-muted-foreground">
          Graph format <code className="font-mono">autocatalog/graph-v1</code>
        </p>
      </div>

      {/* Nothing to filter in an empty graph. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3" hidden={model.rows.length === 0}>
        <InputGroup className="max-w-md flex-1 basis-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Find anything"
            placeholder="Filter by name, owner, kind…"
            autoComplete="off"
            {...queryField}
            onChange={(event) => {
              queryField.onChange(event);
              setPage(1);
            }}
          />
        </InputGroup>
        {model.kinds.length > 0 && (
          <ToggleGroup
            variant="outline"
            size="sm"
            className="flex-wrap"
            aria-label="Filter by resource kind"
            selectionMode="single"
            // One kind is always shown; All is the kind that is every kind.
            disallowEmptySelection
            selectedKeys={[kind]}
            onSelectionChange={(keys) => {
              setKind(String([...keys][0] ?? 'all'));
              setPage(1);
            }}
          >
            <ToggleGroupItem id="all">
              All <Count>{model.rows.length}</Count>
            </ToggleGroupItem>
            {model.kinds.map((candidate) => (
              <ToggleGroupItem key={candidate} id={candidate} data-kind={candidate}>
                <Icon name={kindIcon(candidate)} className="text-muted-foreground" />
                <span className="capitalize">{candidate}</span>{' '}
                <Count>{model.countByKind[candidate]}</Count>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {model.review > 0 && (
          // The review queue: what the tool guessed and wants a person to confirm.
          // Automation earns trust by making its own uncertainty the easiest thing
          // on the page to find.
          <Toggle
            variant="outline"
            size="sm"
            isSelected={reviewOnly}
            onChange={(selected) => {
              setReviewOnly(selected);
              setPage(1);
            }}
          >
            Needs review <Count>{model.review}</Count>
          </Toggle>
        )}
        <p
          className="m-0 ml-auto text-xs whitespace-nowrap text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {reviewOnly ? `${range} ${noun} to review` : `${range} ${noun}`}
        </p>
      </div>

      {/* Every other row's fragment, so a link to a row on a later page still
          names a target in the page as built; landing turns to its page. */}
      <div hidden>
        {model.rows
          .filter((row) => !current.rows.includes(row))
          .map((row) => (
            <span key={row.key} id={row.anchor} />
          ))}
      </div>

      <Card>
        <CardContent>
          {shown.length > 0 ? (
            <Table
              aria-label="Resources"
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
                  Name
                </SortableHead>
                <SortableHead id="key" className="hidden md:table-cell">
                  Key
                </SortableHead>
                <SortableHead id="owner" className="hidden sm:table-cell">
                  Owner
                </SortableHead>
                <SortableHead id="source" className="hidden xl:table-cell">
                  Source
                </SortableHead>
              </TableHeader>
              <TableBody>
                {current.rows.flatMap((row) => {
                  const expanded = open.has(row.key);

                  const line = (
                    <ResourceRow
                      key={row.key}
                      row={row}
                      expanded={expanded}
                      onToggle={() => toggle(row.key)}
                      onLanded={landing === row.anchor ? () => setLanding(null) : undefined}
                    />
                  );

                  return expanded
                    ? [line, <ResourceDetails key={`${row.key}#details`} row={row} />]
                    : [line];
                })}
              </TableBody>
            </Table>
          ) : model.rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name="event" />
                </EmptyMedia>
                <EmptyTitle>The catalog is empty</EmptyTitle>
                <EmptyDescription>
                  Run <code>ac scan</code> in a repository to compile its events, services and
                  agents into the graph.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>No resource matches this view</EmptyTitle>
                <EmptyDescription>
                  Nothing fits the search and filters together. Clear them to see the whole graph.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    apply(everything);
                    queryField.ref.current?.focus();
                  }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>

      <TablePager
        label="Resource pages"
        page={current.page}
        pages={current.pages}
        hrefOf={hrefOf}
        onPage={setPage}
      />
    </section>
  );
}

function Count({ children }: { children: number | undefined }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{children}</span>;
}

/** A stored provenance as this design draws it; anything unrecognised is treated as a guess. */
const methodOf = (value: string): ProvenanceMethod => (isMethod(value) ? value : 'inferred');

/** Muted, because an absence is secondary to the values around it. */
function None() {
  return <span className="text-muted-foreground">Not recorded</span>;
}

/** One line per resource: what it is, its key, who owns it and where it was read. */
function ResourceRow({
  row,
  expanded,
  onToggle,
  onLanded,
}: {
  row: ExplorerRow;
  expanded: boolean;
  onToggle: () => void;
  /** Set on the row a fragment named; called once it is scrolled to. */
  onLanded?: (() => void) | undefined;
}) {
  return (
    <TableRow
      id={row.key}
      data-resource
      data-kind={row.kind}
      data-review={row.needsReview ? 'true' : undefined}
    >
      <TableCell>
        <ExpandButton expanded={expanded} label={row.title} onToggle={onToggle} />
      </TableCell>
      <TableCell className="whitespace-normal md:whitespace-nowrap">
        {/* The fragment target, kept below the sticky header. The table draws
            its rows a pass after the page state changes, so the row scrolls
            itself into view when it arrives. */}
        <span
          id={row.anchor}
          className="flex scroll-mt-20 items-center gap-3"
          ref={
            onLanded &&
            ((node) => {
              if (!node) {
                return;
              }

              node.scrollIntoView({ block: 'start' });
              onLanded();
            })
          }
        >
          <IconTile name={kindIcon(row.kind)} kind={row.kind} />
          <a
            href={row.href}
            className="font-medium text-foreground no-underline underline-offset-4 hover:underline"
          >
            {row.title}
          </a>
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <code
          className="block max-w-xs truncate font-mono text-xs text-muted-foreground"
          title={row.key}
        >
          {row.key}
        </code>
      </TableCell>
      <TableCell className="hidden sm:table-cell">{row.owner ?? <None />}</TableCell>
      <TableCell className="hidden xl:table-cell">
        {row.at ? (
          <code
            className="block max-w-xs truncate font-mono text-xs text-muted-foreground"
            title={row.at}
          >
            {row.at}
          </code>
        ) : (
          <None />
        )}
      </TableCell>
    </TableRow>
  );
}

/** What a row opens to: the summary, where it was read and how sure, its schema and connections. */
function ResourceDetails({ row }: { row: ExplorerRow }) {
  return (
    <TableRow id={`${row.key}#details`}>
      <TableCell colSpan={5} className="whitespace-normal">
        <div className="grid gap-4 py-2 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
            {/* The columns a narrow screen hides. */}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground md:hidden">
              <code className="font-mono break-all">{row.key}</code>
              <span className="sm:hidden">Owned by {row.owner ?? 'nobody on record'}</span>
            </div>
            {row.summary && <p className="m-0 text-sm">{row.summary}</p>}
            <Evidence
              method={methodOf(row.provenance)}
              location={row.at}
              symbol={null}
              confidence={null}
              needsReview={row.needsReview}
            />
            {(row.commit || row.evidence || row.notableFields.length > 0) && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {row.commit && (
                  <p className="m-0">
                    At commit{' '}
                    <code className="font-mono" title={row.commit}>
                      {row.commit.slice(0, 12)}
                    </code>
                  </p>
                )}
                {row.evidence && <p className="m-0">{row.evidence}</p>}
                {row.notableFields.length > 0 && (
                  // Field-level evidence, so "extracted" on the row never hides a
                  // guessed owner underneath it.
                  <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                    {row.notableFields.map(([field, value]) => (
                      <li key={field}>
                        <code className="font-mono">{field}</code>{' '}
                        <span className={tone[methodOf(value)]}>{value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {row.schemaJson && (
              <Collapsible>
                <Disclosure>Payload or document schema</Disclosure>
                <CollapsibleContent>
                  <div className="pt-2">
                    <Code code={row.schemaJson} language="json" label={`${row.title} schema`} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2" data-relations>
            <p className="m-0 text-xs text-muted-foreground">
              {row.connections.length === 0
                ? 'No connections'
                : `${row.connections.length} ${row.connections.length === 1 ? 'connection' : 'connections'}`}
            </p>
            {row.connections.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {row.connections.map((connection) => (
                  <li
                    key={connection.key}
                    className={cn(
                      'flex flex-col gap-0.5 border-0 border-l-2 pl-3 text-xs',
                      rule[methodOf(connection.provenance)],
                    )}
                  >
                    {connection.target ? (
                      <a
                        href={`#${connection.target.anchor}`}
                        className="break-all text-foreground underline underline-offset-4"
                      >
                        {connection.target.title}
                      </a>
                    ) : (
                      <code className="font-mono break-all">{connection.targetKey}</code>
                    )}
                    <span className="text-muted-foreground">
                      {connection.direction === 'in' ? 'Inbound' : 'Outbound'}{' '}
                      <code className="font-mono">{connection.type}</code>,{' '}
                      <span className={tone[methodOf(connection.provenance)]}>
                        {connection.provenance}
                      </span>
                    </span>
                    {connection.evidence && (
                      <span className="text-muted-foreground">{connection.evidence}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** A collapsible's trigger: a ghost button whose chevron turns as it opens. */
function Disclosure({ children }: { children: ReactNode }) {
  return (
    // Disclosure gives its "trigger" slot to whichever button claims it.
    // Pulled left by its padding, so the chevron lines up with the text above it.
    <Button variant="ghost" size="xs" slot="trigger" className="-ml-2">
      <ChevronRightIcon className="transition-transform group-aria-expanded/button:rotate-90" />
      {children}
    </Button>
  );
}

export default CatalogExplorer;
