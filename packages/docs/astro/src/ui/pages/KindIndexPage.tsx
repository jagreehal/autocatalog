/** @jsxImportSource react */
import { ArrowRightIcon, ListFilterIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { ToggleGroup, ToggleGroupItem } from '#ui/components/ui/toggle-group.tsx';
import { statusVariant } from '../lib/status';

/** One value in a kind's column: text, a link, or a state shown as a badge. */
export interface KindCell {
  text: string;
  href?: string;
  /** True for the kind's status field, drawn as a Badge. */
  status?: boolean;
}

export interface KindRow {
  id: string;
  title: string;
  href: string;
  summary?: string;
  repository: string;
  /** The kind's status field, which the status filter reads. */
  status?: string;
  /** One cell per configured column; null when the document leaves it out. */
  cells: Record<string, KindCell | null>;
}

/** One document in a line of succession. */
export interface KindChainLink {
  title: string;
  href: string;
  status?: string;
}

export interface KindIndexPageProps {
  /** The frontmatter fields the organisation shows for this kind, in order. */
  columns: Array<{ field: string; heading: string }>;
  /** Newest first by the kind's date field. */
  rows: KindRow[];
  /** The states present, in the order the kind's schema lists them. */
  statuses: string[];
  repositories: string[];
  /** Each line of succession, oldest first. Empty for a kind nothing supersedes. */
  chains: KindChainLink[][];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

function Count({ children }: { children: number }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{children}</span>;
}

/** A single-choice filter: All, then each value with how many rows have it. */
function Filter({
  label,
  values,
  counts,
  total,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  counts: Map<string, number>;
  total: number;
  /** Undefined for All. */
  selected: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <ToggleGroup
        variant="outline"
        size="sm"
        className="flex-wrap"
        aria-label={`Filter by ${label.toLowerCase()}`}
        selectionMode="single"
        // One choice is always made; All is the choice of every value.
        disallowEmptySelection
        selectedKeys={[selected === undefined ? ALL : keyOf(selected)]}
        onSelectionChange={(keys) => {
          const key = String([...keys][0] ?? ALL);

          onChange(key === ALL ? undefined : key.slice(keyOf('').length));
        }}
      >
        <ToggleGroupItem id={ALL}>
          All <Count>{total}</Count>
        </ToggleGroupItem>
        {values.map((value) => (
          <ToggleGroupItem key={value} id={keyOf(value)}>
            {value} <Count>{counts.get(value) ?? 0}</Count>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

// Each value's key carries a prefix All's does not, so a status or repository
// can be named anything, `all` included.
const ALL = 'all';

const keyOf = (value: string) => `value:${value}`;

function tally(values: Array<string | undefined>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);

  return counts;
}

/**
 * One kind's documents across every repository: a table of the columns the
 * organisation chose, filtered by state and repository, and for a kind whose
 * documents replace each other, each line of succession.
 */
export function KindIndexPage({
  columns,
  rows,
  statuses,
  repositories,
  chains,
}: KindIndexPageProps) {
  const [status, setStatus] = useState<string>();
  const [repository, setRepository] = useState<string>();

  const isVisible = (row: KindRow) =>
    (status === undefined || row.status === status) &&
    (repository === undefined || row.repository === repository);

  const shown = rows.filter(isVisible).length;

  const clear = () => {
    setStatus(undefined);
    setRepository(undefined);
  };

  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      <section className="flex flex-col gap-4" aria-label="Documents">
        {(statuses.length > 0 || repositories.length > 1) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            {statuses.length > 0 && (
              <Filter
                label="Status"
                values={statuses}
                counts={tally(rows.map((row) => row.status))}
                total={rows.length}
                selected={status}
                onChange={setStatus}
              />
            )}
            {repositories.length > 1 && (
              <Filter
                label="Repository"
                values={repositories}
                counts={tally(rows.map((row) => row.repository))}
                total={rows.length}
                selected={repository}
                onChange={setRepository}
              />
            )}
            <p
              className="m-0 ml-auto text-xs whitespace-nowrap text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {shown === rows.length
                ? plural(rows.length, 'document', 'documents')
                : `${shown} of ${plural(rows.length, 'document', 'documents')}`}
            </p>
          </div>
        )}

        <Card>
          <CardContent>
            <Table aria-label="Documents" hidden={shown === 0}>
              <TableHeader>
                <TableHead isRowHeader>Title</TableHead>
                {columns.map(({ field, heading }) => (
                  <TableHead key={field}>{heading}</TableHead>
                ))}
                <TableHead>Repository</TableHead>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} id={row.id} hidden={!isVisible(row)}>
                    <TableCell className="min-w-64 whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <a className={`font-medium ${link}`} href={row.href} data-kind="doc">
                          {row.title}
                        </a>
                        {row.summary && (
                          <span className="text-muted-foreground">{row.summary}</span>
                        )}
                      </div>
                    </TableCell>
                    {columns.map(({ field }) => (
                      <TableCell key={field} className="align-top">
                        <Cell cell={row.cells[field] ?? null} />
                      </TableCell>
                    ))}
                    <TableCell className="align-top">
                      <span className="text-muted-foreground">{row.repository}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {shown === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListFilterIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nothing matches both filters</EmptyTitle>
                  <EmptyDescription>
                    No document has that status in that repository.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onPress={clear}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </CardContent>
        </Card>
      </section>

      {chains.length > 0 && (
        <Card id="supersede-chains">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Supersede chains
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">
                {plural(chains.length, 'chain', 'chains')}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {chains.map((chain) => (
                <li
                  key={chain[0]!.href}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                >
                  {chain.map((step, index) => (
                    <Fragment key={step.href}>
                      {index > 0 && (
                        <ArrowRightIcon
                          aria-label="superseded by"
                          className="size-4 text-muted-foreground"
                        />
                      )}
                      <span className="inline-flex items-center gap-2">
                        <a className={link} href={step.href}>
                          {step.title}
                        </a>
                        {step.status && (
                          <Badge variant={statusVariant(step.status)}>{step.status}</Badge>
                        )}
                      </span>
                    </Fragment>
                  ))}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Cell({ cell }: { cell: KindCell | null }) {
  if (!cell) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not set</span>
      </span>
    );
  }

  if (cell.status) return <Badge variant={statusVariant(cell.text)}>{cell.text}</Badge>;

  if (cell.href) {
    return (
      <a className={link} href={cell.href} data-kind="owner">
        {cell.text}
      </a>
    );
  }

  return cell.text;
}

export default KindIndexPage;
