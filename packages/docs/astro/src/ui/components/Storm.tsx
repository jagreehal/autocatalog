/** @jsxImportSource react */
import { RepeatIcon, ZoomInIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Checkbox } from '#ui/components/ui/checkbox.tsx';
import { Field, FieldLabel } from '#ui/components/ui/field.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';
import { cn } from 'cn';

/** The kinds of sticky on an EventStorming board. */
export type StickyKind =
  | 'actor'
  | 'system'
  | 'command'
  | 'aggregate'
  | 'event'
  | 'failure'
  | 'policy'
  | 'read-model'
  | 'hotspot';

/** Every kind, in the order the legend shows them. */
export const STICKY_KINDS: StickyKind[] = [
  'actor',
  'system',
  'command',
  'aggregate',
  'event',
  'failure',
  'policy',
  'read-model',
  'hotspot',
];

/** What each kind is called on the board and in its legend. */
export const STICKY_LABELS: Record<StickyKind, { name: string; means: string }> = {
  actor: { name: 'Actor', means: 'who starts it' },
  system: { name: 'System', means: 'a system it calls, or one outside' },
  command: { name: 'Command', means: 'a request, which can be refused' },
  aggregate: { name: 'Decided by', means: 'what decides whether it happens' },
  event: { name: 'Event', means: 'a fact, in the past tense' },
  failure: { name: 'Failure', means: 'still a fact' },
  policy: { name: 'Policy', means: '“whenever X, do Y”' },
  'read-model': { name: 'Read model', means: 'what people see' },
  hotspot: { name: 'Hotspot', means: 'a problem or an open question' },
};

const COLOURS: Record<StickyKind, string> = {
  actor: 'bg-storm-actor',
  system: 'bg-storm-system',
  command: 'bg-storm-command',
  aggregate: 'bg-storm-aggregate',
  event: 'bg-storm-event',
  failure: 'bg-storm-event outline-2 outline-dashed outline-offset-[-3px] outline-storm-hotspot',
  policy: 'bg-storm-policy',
  'read-model': 'bg-storm-read-model',
  hotspot: 'bg-storm-hotspot',
};

export interface StickyProps {
  kind: StickyKind;
  children: ReactNode;
  summary?: string | undefined;
  /** Open findings on it: a hotspot tag on the sticky. */
  hotspots?: number | undefined;
  /** Where the sticky leads, such as its step in the list below. */
  href?: string | undefined;
  /** The code behind it, shown when the reader asks for it. */
  code?: Array<{ file: string; contains?: string | undefined }> | undefined;
  showCode?: boolean | undefined;
  /** A chip in a sentence: its kind said to a screen reader and on hover, not printed. */
  inline?: boolean | undefined;
  className?: string | undefined;
}

/**
 * One sticky note. Its kind is said in words as well as colour, so a board
 * reads without colour and to a screen reader.
 */
export function Sticky({
  kind,
  children,
  summary,
  hotspots,
  href,
  code = [],
  showCode = false,
  inline = false,
  className,
}: StickyProps) {
  if (inline) {
    return (
      <span
        className={cn(
          'not-content inline box-decoration-clone rounded-sm px-1.5 py-0.5 font-semibold text-storm-ink',
          COLOURS[kind],
          className,
        )}
        title={STICKY_LABELS[kind].name}
        data-sticky={kind}
      >
        <span className="sr-only">{STICKY_LABELS[kind].name}: </span>
        {children}
      </span>
    );
  }

  const body = (
    <>
      <span className="text-xs leading-tight font-semibold opacity-75">
        {STICKY_LABELS[kind].name}
      </span>
      {hotspots ? (
        <Badge className="self-start">{hotspots === 1 ? 'Hotspot' : `${hotspots} hotspots`}</Badge>
      ) : null}
      <span className="text-sm leading-snug font-semibold">{children}</span>
      {summary && <span className="text-xs leading-snug opacity-80">{summary}</span>}
      {showCode && code.length > 0 && (
        <span className="flex flex-col gap-0.5 font-mono text-xs leading-tight opacity-75">
          {code.map(({ file, contains }) => (
            <span key={`${file}:${contains ?? ''}`} className="break-all">
              {file}
              {contains && ` · ${contains}`}
            </span>
          ))}
        </span>
      )}
    </>
  );

  const classes = cn(
    'not-content flex min-h-16 min-w-36 flex-col gap-1 rounded-sm p-2 text-storm-ink shadow-sm',
    COLOURS[kind],
    href && 'no-underline hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50',
    className,
  );

  return href ? (
    <a href={href} className={classes} data-sticky={kind}>
      {body}
    </a>
  ) : (
    <span className={classes} data-sticky={kind}>
      {body}
    </span>
  );
}

/** A sticky in a sentence, as MDX pages use `<Sticky>`. */
export function InlineSticky(props: Omit<StickyProps, 'inline'>) {
  return <Sticky {...props} inline />;
}

/** Every kind of sticky, with what it means. */
export function StormLegend({ kinds }: { kinds?: StickyKind[] | undefined }) {
  const shown = kinds ?? STICKY_KINDS;

  return (
    <ul className="not-content m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Sticky kinds">
      {shown.map((kind) => (
        <li key={kind}>
          <Sticky kind={kind} className="min-h-0 min-w-0 gap-0 px-2 py-1">
            {STICKY_LABELS[kind].means}
          </Sticky>
        </li>
      ))}
    </ul>
  );
}

/** The rows of a process-level board, top to bottom. */
export const STORM_ROW_LABELS = {
  who: 'People and systems',
  command: 'Command',
  decidedBy: 'Decided by',
  happy: 'Happy track',
  failure: 'Failure track',
  policy: 'Policy',
} as const;

export type StormRowName = keyof typeof STORM_ROW_LABELS;

export interface StormStickyView {
  kind: StickyKind;
  text: string;
  summary?: string | undefined;
  href?: string | undefined;
  hotspots?: number | undefined;
  code?: Array<{ file: string; contains?: string | undefined }> | undefined;
}

export interface StormColumnView {
  stage: string;
  repeats?: string | undefined;
  /** The board this stage zooms into. */
  subflow?: { title: string; href: string } | undefined;
  rows: Record<StormRowName, StormStickyView[]>;
}

export interface StormBoardProps {
  columns: StormColumnView[];
  /** What a screen reader calls the board. */
  label?: string | undefined;
  /** Offer a switch to show the code behind each sticky, when any has some. */
  codeToggle?: boolean | undefined;
}

function RowLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold text-muted-foreground">{children}</span>;
}

const ROWS: StormRowName[] = ['who', 'command', 'decidedBy', 'happy', 'failure', 'policy'];

/**
 * A process-level EventStorming board: a column per stage, read left to
 * right, with who takes part, the command, what decides, the facts on the
 * happy and failure tracks, and the policies under them. A table, so a screen
 * reader can move by stage and by row.
 */
export function StormBoard({ columns, label = 'Event storm', codeToggle = true }: StormBoardProps) {
  const [showCode, setShowCode] = useState(false);

  const hasCode = columns.some((column) =>
    ROWS.some((row) => column.rows[row].some((sticky) => (sticky.code?.length ?? 0) > 0)),
  );

  const rows = ROWS.filter((row) => columns.some((column) => column.rows[row].length > 0));

  return (
    <div className="not-content flex flex-col gap-3">
      {codeToggle && hasCode && (
        <Field orientation="horizontal" className="w-auto">
          <Checkbox id={`${label}-code`} isSelected={showCode} onChange={setShowCode} />
          <FieldLabel htmlFor={`${label}-code`}>Show the code behind each sticky</FieldLabel>
        </Field>
      )}
      <Table aria-label={label}>
        <TableHeader>
          {/* Every header, row and cell has an id, so React Aria's keys match from server to browser. */}
          <TableHead id="row" isRowHeader>
            <span className="sr-only">Row</span>
          </TableHead>
          {columns.map((column, index) => (
            <TableHead key={`${column.stage}-${index}`} id={`stage-${index}`} className="align-top">
              <span className="flex flex-col gap-1 py-1 whitespace-normal">
                <span className="text-muted-foreground">{index + 1}</span>
                <span className="font-semibold text-foreground">{column.stage}</span>
              </span>
            </TableHead>
          ))}
        </TableHeader>
        <TableBody>
          {columns.some((column) => column.repeats ?? column.subflow) && (
            <TableRow id="runs" data-row="runs">
              <TableCell id="runs:label" className="align-top whitespace-normal">
                <RowLabel>Runs</RowLabel>
              </TableCell>
              {columns.map((column, index) => (
                <TableCell
                  key={`${column.stage}-${index}`}
                  id={`runs:${index}`}
                  className="align-top"
                >
                  <span className="flex w-44 flex-col gap-1 text-xs whitespace-normal">
                    {column.repeats && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <RepeatIcon aria-hidden className="size-3 shrink-0" /> {column.repeats}
                      </span>
                    )}
                    {column.subflow && (
                      <a
                        href={column.subflow.href}
                        className="flex items-center gap-1 underline underline-offset-4"
                      >
                        <ZoomInIcon aria-hidden className="size-3 shrink-0" /> Inside:{' '}
                        {column.subflow.title}
                      </a>
                    )}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row} id={row} data-row={row}>
              <TableCell id={`${row}:label`} className="align-top whitespace-normal">
                <RowLabel>{STORM_ROW_LABELS[row]}</RowLabel>
              </TableCell>
              {columns.map((column, index) => (
                <TableCell
                  key={`${column.stage}-${index}`}
                  id={`${row}:${index}`}
                  className="align-top"
                >
                  {column.rows[row].length > 0 && (
                    <ul className="m-0 flex w-44 list-none flex-col gap-2 p-0 whitespace-normal">
                      {column.rows[row].map((sticky) => (
                        <li key={`${sticky.kind}:${sticky.text}`}>
                          <Sticky
                            kind={sticky.kind}
                            summary={sticky.summary}
                            href={sticky.href}
                            hotspots={sticky.hotspots}
                            code={sticky.code}
                            showCode={showCode}
                            className="w-full"
                          >
                            {sticky.text}
                          </Sticky>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export interface StormHotspotView {
  title: string;
  /** The finding that raised it. */
  href?: string | undefined;
  /** The step it is on, by title. */
  step?: string | undefined;
  nature?: string | undefined;
  status?: string | undefined;
  /** Raised by the board: a failure after which nothing happens. */
  derived: boolean;
}

/** The problems and open questions a board holds, each linked to what raised it. */
export function StormHotspots({ hotspots }: { hotspots: StormHotspotView[] }) {
  if (hotspots.length === 0) return null;

  return (
    <ul className="not-content m-0 flex list-none flex-col gap-2 p-0" aria-label="Hotspots">
      {hotspots.map((hotspot) => (
        <li key={`${hotspot.step ?? ''}:${hotspot.title}`}>
          <Item variant="outline" size="sm" {...(hotspot.href && { href: hotspot.href })}>
            <ItemContent>
              <ItemTitle>{hotspot.title}</ItemTitle>
              <ItemDescription>
                {hotspot.derived
                  ? 'Nothing handles this failure: no policy, no next step, and no status recorded.'
                  : hotspot.step
                    ? `On “${hotspot.step}”.`
                    : 'On the whole flow.'}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="destructive">Hotspot</Badge>
              {hotspot.nature && <Badge variant="outline">{hotspot.nature}</Badge>}
              {hotspot.status && <Badge variant="secondary">{hotspot.status}</Badge>}
            </ItemActions>
          </Item>
        </li>
      ))}
    </ul>
  );
}

export interface StormEndingView {
  title: string;
  track: 'happy' | 'failure';
  summary?: string | undefined;
  status: string;
  policies: string[];
}

/** Each way a run can end: the fact, when it happens, the status left, and what follows. */
export function StormEndings({ endings }: { endings: StormEndingView[] }) {
  if (endings.length === 0) return null;

  return (
    <Table aria-label="How it can end">
      <TableHeader>
        <TableHead id="fact" isRowHeader>
          Final fact
        </TableHead>
        <TableHead id="when">When</TableHead>
        <TableHead id="status">Status</TableHead>
        <TableHead id="next">What happens next</TableHead>
      </TableHeader>
      <TableBody>
        {endings.map((ending) => (
          <TableRow id={ending.title} key={ending.title}>
            <TableCell id={`${ending.title}:fact`} className="w-48 align-top whitespace-normal">
              <Sticky kind={ending.track === 'happy' ? 'event' : 'failure'} className="w-44">
                {ending.title}
              </Sticky>
            </TableCell>
            <TableCell id={`${ending.title}:when`} className="align-top whitespace-normal">
              {ending.summary}
            </TableCell>
            <TableCell id={`${ending.title}:status`} className="align-top">
              <code>{ending.status}</code>
            </TableCell>
            <TableCell id={`${ending.title}:next`} className="align-top whitespace-normal">
              {ending.policies.length > 0 ? (
                ending.policies.join(' ')
              ) : (
                <span className="font-semibold text-destructive">Nothing</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface StormScenarioView {
  given: string;
  when: string;
  then: string;
  expected?: string | undefined;
  /** The fact it ends on, by title. */
  outcome?: string | undefined;
  test?: string | undefined;
}

/**
 * Cases worth testing, read as Given, When, Then. Where what happens today is
 * not what should, both are shown.
 */
export function StormScenarios({ scenarios }: { scenarios: StormScenarioView[] }) {
  if (scenarios.length === 0) return null;

  return (
    <Table aria-label="Scenarios">
      <TableHeader>
        <TableHead id="given" isRowHeader>
          Given
        </TableHead>
        <TableHead id="when">When</TableHead>
        <TableHead id="then">Then</TableHead>
        <TableHead id="ends">Ends on</TableHead>
      </TableHeader>
      <TableBody>
        {scenarios.map((scenario, index) => (
          <TableRow id={`${scenario.given}-${index}`} key={`${scenario.given}-${index}`}>
            <TableCell
              id={`${scenario.given}-${index}:given`}
              className="align-top whitespace-normal"
            >
              {scenario.given}
            </TableCell>
            <TableCell
              id={`${scenario.given}-${index}:when`}
              className="align-top whitespace-normal"
            >
              {scenario.when}
            </TableCell>
            <TableCell
              id={`${scenario.given}-${index}:then`}
              className="align-top whitespace-normal"
            >
              {scenario.expected ? (
                <span className="flex flex-col gap-1">
                  <span>
                    <span className="font-semibold">Today:</span> {scenario.then}
                  </span>
                  <span>
                    <span className="font-semibold">Expected:</span> {scenario.expected}
                  </span>
                </span>
              ) : (
                scenario.then
              )}
              {scenario.test && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Tested in <code>{scenario.test}</code>
                </span>
              )}
            </TableCell>
            <TableCell
              id={`${scenario.given}-${index}:ends`}
              className="align-top whitespace-normal"
            >
              {scenario.outcome}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface BigPictureLaneView {
  title: string;
  href: string;
  repository: string;
  summary?: string | undefined;
  events: string[];
  failures: number;
  hotspots: number;
}

/**
 * Every flow as one lane of facts, left to right: the big picture, where a
 * reader sees what the business does before opening any one process.
 */
export function BigPicture({ lanes }: { lanes: BigPictureLaneView[] }) {
  if (lanes.length === 0) return null;

  return (
    <ul className="not-content m-0 flex list-none flex-col gap-4 p-0" aria-label="Big picture">
      {lanes.map((lane) => (
        <li key={lane.href} className="flex flex-col gap-2">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <a href={lane.href} className="font-semibold underline underline-offset-4">
              {lane.title}
            </a>
            <span className="text-xs text-muted-foreground">
              {lane.repository}
              {lane.failures > 0 &&
                ` · ${lane.failures} ${lane.failures === 1 ? 'way' : 'ways'} to fail`}
            </span>
            {lane.hotspots > 0 && (
              <Badge variant="destructive">
                {lane.hotspots === 1 ? '1 hotspot' : `${lane.hotspots} hotspots`}
              </Badge>
            )}
          </span>
          {lane.events.length > 0 && (
            // Focusable, so a keyboard can scroll a lane wider than the page.
            <ol
              className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-2"
              aria-label={`${lane.title}, in order`}
              tabIndex={0}
            >
              {lane.events.map((event, index) => (
                <li key={`${event}-${index}`} className="shrink-0">
                  <Sticky kind="event" className="w-40">
                    {event}
                  </Sticky>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}
