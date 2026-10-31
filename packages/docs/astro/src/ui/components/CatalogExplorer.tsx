/** @jsxImportSource react */
import { cn } from 'cn';
import { ChevronRightIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
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
import { Item, ItemContent, ItemMedia } from '#ui/components/ui/item.tsx';
import { Toggle } from '#ui/components/ui/toggle.tsx';
import { ToggleGroup, ToggleGroupItem } from '#ui/components/ui/toggle-group.tsx';
import { kindIcon } from '../../icons';
import type { ExplorerModel, ExplorerRow } from './catalog-explorer-model';
import { Code } from './Code';
import { Evidence, isMethod, rule, tone, type ProvenanceMethod } from './Evidence';
import { Icon } from './Icon';
import { Stats } from './Stats';
import { IconTile } from './IconTile';

export interface CatalogExplorerProps {
  /** The graph, ready to draw; see `explorerModel`, which builds it where autocatalog-core can run. */
  model: ExplorerModel;
}

export function CatalogExplorer({ model }: CatalogExplorerProps) {
  const [query, setQuery] = useState('');

  const [kind, setKind] = useState('all');

  const [reviewOnly, setReviewOnly] = useState(false);

  const search = useRef<HTMLInputElement>(null);

  // `?kind=service` opens the explorer on one kind, which is how the rail's
  // Services entry lands here; `?q=` and `?review=1` arrive from wiki links and
  // the homepage's review count.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const initialKind = params.get('kind');

    if (initialKind && model.kinds.includes(initialKind)) setKind(initialKind);
    setQuery(params.get('q') ?? '');

    if (params.get('review') === '1') setReviewOnly(true);
  }, [model.kinds]);

  const needle = query.trim().toLocaleLowerCase();

  const shown = model.rows.filter(
    (row) =>
      (kind === 'all' || row.kind === kind) &&
      (!needle || row.searchText.includes(needle)) &&
      (!reviewOnly || row.needsReview),
  );

  const showAll = () => {
    setKind('all');
    setReviewOnly(false);
    setQuery('');
  };

  // A connection can target a row hidden by the current view. Restore the
  // complete graph, synchronously, before the browser follows its fragment.
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return;

    if (!event.target.closest('[data-relations] a[href^="#resource-"]')) return;

    flushSync(showAll);
  };

  const noun = shown.length === 1 ? 'resource' : 'resources';

  return (
    <section
      className="not-content flex flex-col gap-4"
      data-catalog-explorer
      onClickCapture={onClickCapture}
    >
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
            ref={search}
            type="search"
            aria-label="Find anything"
            placeholder="Filter by name, owner, kind…"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            onSelectionChange={(keys) => setKind(String([...keys][0] ?? 'all'))}
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
          <Toggle variant="outline" size="sm" isSelected={reviewOnly} onChange={setReviewOnly}>
            Needs review <Count>{model.review}</Count>
          </Toggle>
        )}
        <p
          className="m-0 ml-auto text-xs whitespace-nowrap text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {reviewOnly ? `${shown.length} ${noun} to review` : `${shown.length} ${noun}`}
        </p>
      </div>

      <Card>
        <CardContent>
          {shown.length > 0 ? (
            <ol className="m-0 flex list-none flex-col divide-y p-0">
              {shown.map((row) => (
                <ResourceRow key={row.key} row={row} />
              ))}
            </ol>
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
                    showAll();
                    search.current?.focus();
                  }}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Count({ children }: { children: number | undefined }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{children}</span>;
}

/** A stored provenance as this design draws it; anything unrecognised is treated as a guess. */
const methodOf = (value: string): ProvenanceMethod => (isMethod(value) ? value : 'inferred');

function ResourceRow({ row }: { row: ExplorerRow }) {
  return (
    <li
      id={row.anchor}
      className="m-0 scroll-mt-20 target:bg-muted"
      data-resource
      data-kind={row.kind}
      data-review={row.needsReview ? 'true' : undefined}
      data-search={row.searchText}
    >
      <Item className="items-start">
        <ItemMedia>
          <IconTile name={kindIcon(row.kind)} />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-64">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-sm font-semibold">
                <a
                  href={row.href}
                  className="text-foreground no-underline underline-offset-4 hover:underline"
                >
                  {row.title}
                </a>
              </h2>
              <code className="font-mono text-xs break-all text-muted-foreground">{row.key}</code>
            </div>
            {row.summary && <p className="m-0 text-sm">{row.summary}</p>}
            <Evidence
              method={methodOf(row.provenance)}
              location={row.at}
              symbol={null}
              confidence={null}
              needsReview={row.needsReview}
            />
            {(row.owner || row.commit || row.evidence || row.notableFields.length > 0) && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {(row.owner || row.commit) && (
                  <p className="m-0">
                    {row.owner && (
                      <>
                        Owned by <span className="text-foreground">{row.owner}</span>
                      </>
                    )}
                    {row.owner && row.commit && ', at commit '}
                    {!row.owner && row.commit && 'At commit '}
                    {row.commit && (
                      <code className="font-mono" title={row.commit}>
                        {row.commit.slice(0, 12)}
                      </code>
                    )}
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
        </ItemContent>
        <ItemContent className="sm:w-56 sm:flex-none" data-relations>
          {row.connections.length > 0 ? (
            <Collapsible>
              <Disclosure>
                {row.connections.length}{' '}
                {row.connections.length === 1 ? 'connection' : 'connections'}
              </Disclosure>
              <CollapsibleContent>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 pt-2">
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
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="m-0 py-1 text-xs text-muted-foreground">No connections</p>
          )}
        </ItemContent>
      </Item>
    </li>
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
