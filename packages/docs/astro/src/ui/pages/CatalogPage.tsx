/** @jsxImportSource react */
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert.tsx';
import { Badge } from '#ui/components/ui/badge.tsx';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
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
import type { VisualiserGraph } from '../lib/visualiser';
import type { ExplorerModel } from '../components/catalog-explorer-model';
import { CatalogExplorer } from '../components/CatalogExplorer';
import { Graph } from '../components/Graph';
import { Icon } from '../components/Icon';

/** A repository whose own catalog did not compile, and the file its owners would open. */
export interface CatalogFailure {
  repository: string;
  source: string;
  message: string;
}

/** Who writes and reads one collection or table. */
export interface DatastoreRow {
  /** The row's anchor in the explorer below. */
  anchor: string;
  id: string;
  namespace?: string | undefined;
  owner: string | null;
  writers: string[];
  readers: string[];
  evidence: { count: number; environment?: string | undefined } | null;
}

export interface CatalogPageProps {
  failures: CatalogFailure[];
  datastores: DatastoreRow[];
  /** Undefined when there is nothing worth drawing. */
  map?: VisualiserGraph | undefined;
  /** The graph's rows, for the explorer below the map. */
  explorer: ExplorerModel;
}

const link =
  'font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

export function CatalogPage({ failures, datastores, map, explorer }: CatalogPageProps) {
  return (
    <div className="not-content flex flex-col gap-8" data-wide>
      {failures.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle role="heading" aria-level={2}>
            {`${failures.length} ${failures.length === 1 ? 'repository is' : 'repositories are'} missing from this graph`}
          </AlertTitle>
          <AlertDescription>
            <p>
              Their own catalogs did not compile, so nothing from them is shown here. A gap you can
              see beats a graph that quietly looks complete.
            </p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {failures.map((failure) => (
                <li key={`${failure.repository}|${failure.source}`}>
                  <code>{failure.repository}</code>, from <code>{failure.source}</code>:{' '}
                  {failure.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Without JavaScript the explorer below is the whole catalog; the map is
          only ever an addition to it. */}
      {map && <Graph id="catalog-map" label="Catalog map" visualiser={map} height="30rem" />}

      {explorer.rows.length > 0 ? (
        <CatalogExplorer model={explorer} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="catalog" />
            </EmptyMedia>
            <EmptyTitle>The catalog is empty</EmptyTitle>
            <EmptyDescription>
              Nothing was found to list. Run <code>npx autocatalog .</code> in a repository with
              event contracts, documentation or agents, then rebuild the site.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {datastores.length > 0 && (
        <Card id="datastore-ownership">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Datastore ownership
            </CardTitle>
            <CardDescription>
              Who writes and reads each collection or table, from code and runtime evidence. An
              unassigned owner needs a team decision.
            </CardDescription>
            <CardAction>
              <span className="text-muted-foreground">
                {datastores.length} {datastores.length === 1 ? 'datastore' : 'datastores'}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table aria-label="Datastore ownership">
              <TableHeader>
                <TableHead isRowHeader>Resource</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Writers</TableHead>
                <TableHead>Readers</TableHead>
                <TableHead>Observed accesses</TableHead>
              </TableHeader>
              <TableBody>
                {datastores.map((row) => (
                  <DatastoreRowView key={row.anchor} row={row} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Muted, because an absence is secondary to the names around it. */
function None({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function DatastoreRowView({ row }: { row: DatastoreRow }) {
  return (
    <TableRow>
      <TableCell>
        {/* The resource's entry in the explorer above. */}
        <a href={`#${row.anchor}`} className={link}>
          {row.id}
        </a>
        {row.namespace && (
          <span className="block text-xs text-muted-foreground">{row.namespace}</span>
        )}
      </TableCell>
      <TableCell>{row.owner ?? <None>Unassigned</None>}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          {row.writers.join(', ') || <None>None identified</None>}
          {row.writers.length > 1 && <Badge variant="destructive">Multiple writers</Badge>}
        </div>
      </TableCell>
      <TableCell>{row.readers.join(', ') || <None>None identified</None>}</TableCell>
      <TableCell>
        {row.evidence ? (
          <>
            {row.evidence.count.toLocaleString('en-GB')}
            <span className="block text-xs text-muted-foreground">
              {row.evidence.environment ?? 'Environment unspecified'}; coverage unknown
            </span>
          </>
        ) : (
          <None>No runtime evidence</None>
        )}
      </TableCell>
    </TableRow>
  );
}

export default CatalogPage;
