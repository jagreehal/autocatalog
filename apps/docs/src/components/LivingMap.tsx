/** @jsxImportSource react */
import { rule, tone } from 'autocatalog-docs-astro/ui/components/Evidence.tsx';
import { Icon } from 'autocatalog-docs-astro/ui/components/Icon.tsx';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from 'autocatalog-docs-astro/ui/components/ui/alert.tsx';
import { Badge } from 'autocatalog-docs-astro/ui/components/ui/badge.tsx';
import { Toggle } from 'autocatalog-docs-astro/ui/components/ui/toggle.tsx';
import { cn } from 'cn';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  type Fact,
  type MapEdge,
  type MapNode,
  type Provenance,
  VIEW,
  edges,
  facts,
  joints,
  nodeHeight,
  nodes,
  regionOf,
  regions,
  spines,
} from './living-map-data';

const said: Record<Provenance, string> = {
  extracted: 'Extracted',
  declared: 'Declared',
  inferred: 'Inferred',
};

const kindName: Record<MapNode['kind'], string> = {
  service: 'Service',
  event: 'Event',
  api: 'API',
  table: 'Data model',
  doc: 'Document',
};

const stroke: Record<Provenance | 'breaking', string> = {
  extracted: 'stroke-extracted',
  declared: 'stroke-declared',
  inferred: 'stroke-inferred',
  breaking: 'stroke-destructive',
};

const fill: Record<Provenance | 'breaking', string> = {
  extracted: 'fill-extracted',
  declared: 'fill-declared',
  inferred: 'fill-inferred',
  breaking: 'fill-destructive',
};

const MAIN_REF = 'main @ 3f2a91c';

const PR_REF = 'pull request #482 @ 9be07d1';

const BREAKS = new Set(['LedgerService', 'NotificationService']);

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Corner ticks just outside a region, the way a drawing marks its frame. */
function ticks({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const t = 9;
  const x2 = x + w;
  const y2 = y + h;

  return (
    `M${x - 4} ${y + t}v${-t - 4}h${t + 4}` +
    `M${x2 - t} ${y - 4}h${t + 4}v${t + 4}` +
    `M${x2 + 4} ${y2 - t}v${t + 4}h${-t - 4}` +
    `M${x + t} ${y2 + 4}h${-t - 4}v${-t - 4}`
  );
}

const ink = 'fill-none stroke-foreground';

const label = 'fill-foreground';

const sub = 'fill-muted-foreground';

function Glyphs({ id, node }: { id: string; node: MapNode }) {
  const h = nodeHeight(id);
  const x = node.x - node.w / 2;
  const name = node.label ?? id;

  if (node.kind === 'service') {
    return (
      <>
        <rect className={ink} x={x + 13} y={node.y - 7} width={14} height={14} rx={2} />
        <path className={ink} d={`M${x + 17} ${node.y}h6`} />
        <text className={cn(label, 'font-bold')} fontSize={14} x={x + 36} y={node.y - 2}>
          {name}
        </text>
        <text className={sub} fontSize={10.5} x={x + 36} y={node.y + 14}>
          {node.sub}
        </text>
      </>
    );
  }

  if (node.kind === 'event') {
    return (
      <>
        <path className={ink} d={`M${x + 22} ${node.y - 7}l7 7-7 7-7-7Z`} />
        <text className={cn(label, 'font-medium')} fontSize={13} x={x + 36} y={node.y + 4.5}>
          {name}
        </text>
      </>
    );
  }

  const glyph: Record<'doc' | 'api' | 'table', ReactNode> = {
    // A page with a folded corner.
    doc: (
      <>
        <path
          className={ink}
          d={`M${x + node.w - 12} ${node.y - h / 2}V${node.y - h / 2 + 12}H${x + node.w}`}
        />
        <path
          className={ink}
          d={`M${x + 12} ${node.y - 6}h11M${x + 12} ${node.y}h11M${x + 12} ${node.y + 6}h7`}
        />
      </>
    ),
    api: (
      <text
        className={cn(label, 'font-bold')}
        fontSize={12}
        x={x + 17.5}
        y={node.y + 4}
        textAnchor="middle"
      >
        {'{}'}
      </text>
    ),
    // A table: a header band and a key column.
    table: (
      <path
        className={ink}
        d={`M${x + 10} ${node.y - 7}h16v14h-16Z M${x + 10} ${node.y - 2}h16 M${x + 16} ${node.y - 2}v9`}
      />
    ),
  };

  return (
    <>
      {glyph[node.kind]}
      <text className={cn(label, 'font-semibold')} fontSize={12} x={x + 34} y={node.y - 3}>
        {name}
      </text>
      <text className={sub} fontSize={10.5} x={x + 34} y={node.y + 12}>
        {node.sub}
      </text>
    </>
  );
}

/** Each kind has its own outline, so the kind reads without colour. */
function outline(id: string, node: MapNode) {
  const h = nodeHeight(id);
  const x = node.x - node.w / 2;
  const y = node.y - h / 2;
  const x2 = x + node.w;
  const y2 = y + h;
  const c = 9;

  if (node.kind === 'service') return { rect: { x, y, width: node.w, height: h, rx: 4 } };

  if (node.kind === 'event') return { rect: { x, y, width: node.w, height: h, rx: h / 2 } };

  if (node.kind === 'table') return { rect: { x, y, width: node.w, height: h, rx: 0 } };

  if (node.kind === 'doc') return { d: `M${x} ${y}H${x2 - 12}L${x2} ${y + 12}V${y2}H${x}Z` };

  return {
    d: `M${x + c} ${y}H${x2 - c}L${x2} ${y + c}V${y2 - c}L${x2 - c} ${y2}H${x + c}L${x} ${y2 - c}V${y + c}Z`,
  };
}

function Edge({ edge, lit, pr }: { edge: MapEdge; lit: boolean; pr: boolean }) {
  const breaking = pr && edge.breaking === true;
  const tip = breaking ? 'breaking' : edge.provenance;

  return (
    <path
      d={edge.path}
      className={cn(
        'fill-none transition duration-300',
        stroke[tip],
        !lit && !breaking && 'opacity-25',
      )}
      strokeWidth={breaking ? 2.25 : edge.stub ? 1.5 : 1.75}
      strokeDasharray={breaking ? '2 5' : edge.provenance === 'inferred' ? '6 5' : undefined}
      strokeLinecap={breaking ? 'round' : undefined}
      markerEnd={edge.stub ? undefined : `url(#arrow-${tip})`}
      data-flow={breaking || undefined}
    />
  );
}

function FactRow({ fact }: { fact: Fact }) {
  return (
    <li
      className={cn(
        'grid grid-cols-4 gap-x-2.5 border-0 border-l-2 py-px pl-3',
        rule[fact.provenance],
      )}
    >
      <span className="pt-px text-xs text-muted-foreground">{fact.label}</span>
      <span className="col-span-3 text-sm leading-snug font-semibold wrap-anywhere">
        {fact.value}
        {fact.badge && (
          <>
            {' '}
            <Badge variant={fact.badge === 'Suspicious' ? 'destructive' : 'outline'}>
              {fact.badge}
            </Badge>
          </>
        )}
      </span>
      <span className="col-span-3 col-start-2 mt-0.5 text-xs leading-normal text-muted-foreground italic">
        {fact.plain ? (
          fact.how
        ) : (
          <>
            <b className={cn('font-semibold', tone[fact.provenance])}>{said[fact.provenance]}</b>{' '}
            {fact.how}
          </>
        )}
      </span>
    </li>
  );
}

const keyItems: Array<{ name: string; glyph: ReactNode }> = [
  { name: 'service', glyph: <rect x="1" y="1" width="20" height="12" rx="2" /> },
  { name: 'event', glyph: <rect x="1" y="1" width="20" height="12" rx="6" /> },
  { name: 'document', glyph: <path d="M1 1h15l5 5v7H1Z M16 1v5h5" /> },
  { name: 'API', glyph: <path d="M6 1h10l5 5v2l-5 5H6L1 8V6Z" /> },
  {
    name: 'data model',
    glyph: (
      <>
        <rect x="1" y="1" width="20" height="12" />
        <path d="M1 5h20M8 5v8" />
      </>
    ),
  },
];

const legend: Array<{ tip: Provenance | 'breaking'; text: string }> = [
  { tip: 'extracted', text: 'extracted from code' },
  { tip: 'declared', text: 'declared by a person' },
  { tip: 'inferred', text: 'inferred, needs review' },
  { tip: 'breaking', text: 'breaks in this pull request' },
];

/**
 * The home page's hero: an example company's repositories, with what the
 * catalog knows about each node and where each fact came from. "Preview a pull
 * request" shows what the drift check sees in a change that renames a field.
 */
export function LivingMap() {
  const [current, setCurrent] = useState('PaymentService');
  const [pr, setPr] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<SVGSVGElement>(null);

  const preview = (on: boolean) => {
    setPr(on);

    if (on) setCurrent('payment.completed');
    // On a narrow screen the map scrolls inside its frame: bring the break into view.
    const scroller = canvas.current;

    if (on && scroller && map.current && scroller.scrollWidth > scroller.clientWidth + 4) {
      const unit = map.current.getBoundingClientRect().width / VIEW.width;
      scroller.scrollTo({ left: 300 * unit, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  };

  // "Preview it on the map", further down the page, is static markup.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-preview-pr]')) return;
      preview(true);
      frame.current?.scrollIntoView({
        behavior: reducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
    };

    document.addEventListener('click', onClick);

    return () => document.removeEventListener('click', onClick);
  });

  const sheet = facts.get(current)!;
  const rows = (pr && sheet.prFacts) || sheet.facts;
  const alert = pr ? sheet.prAlert : undefined;
  const ref = pr ? PR_REF : MAIN_REF;

  const onKey = (id: string) => (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setCurrent(id);
  };

  // The node with the diff label paints last, so the label sits on top.
  const order = [
    ...[...nodes.keys()].filter((id) => id !== 'payment.completed'),
    'payment.completed',
  ];

  return (
    <div
      id="map"
      ref={frame}
      className="mt-8 scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-xl lg:mt-12"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b py-2.5 pr-3 pl-4 text-xs">
        <span className="inline-flex items-center gap-2 font-semibold">
          <Icon name="repository" className="size-4 text-muted-foreground" />
          <span>{ref}</span>
        </span>
        <span className="min-w-0 flex-1 text-muted-foreground max-sm:order-3 max-sm:basis-full">
          {pr
            ? '1 breaking, 1 suspicious, 0 additive. The check fails and names both teams.'
            : 'Select any node to see where each fact came from.'}
        </span>
        <Toggle variant="outline" size="sm" isSelected={pr} onChange={preview}>
          <span
            className="relative h-4.5 w-7.5 flex-none rounded-full border border-muted-foreground bg-muted transition-colors group-aria-pressed/toggle:border-destructive group-aria-pressed/toggle:bg-destructive"
            aria-hidden="true"
          >
            <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-foreground transition-transform group-aria-pressed/toggle:translate-x-3 group-aria-pressed/toggle:bg-card" />
          </span>
          Preview a pull request
        </Toggle>
      </div>
      <div className="flex flex-col xl:flex-row">
        <div
          ref={canvas}
          data-blueprint
          className="relative grid min-w-0 flex-1 content-center overflow-x-auto overscroll-x-contain border-b bg-background xl:border-r xl:border-b-0"
        >
          <span className="sticky left-0 w-max px-3 pt-2 text-xs text-muted-foreground sm:hidden">
            Scroll the map sideways to see every repository.
          </span>
          <svg
            ref={map}
            className="block h-auto w-full min-w-225"
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            role="group"
            aria-label="Example catalog map of four repositories, payments-service, ledger, notifications and reporter, with their services, events, documents, API and data model"
          >
            <defs>
              {(['extracted', 'declared', 'inferred', 'breaking'] as const).map((tip) => (
                <marker
                  key={tip}
                  id={`arrow-${tip}`}
                  viewBox="0 0 10 10"
                  refX={9}
                  refY={5}
                  markerWidth={7}
                  markerHeight={7}
                  orient="auto-start-reverse"
                >
                  <path d="M1 1.5 9 5 1 8.5Z" className={fill[tip]} />
                </marker>
              ))}
            </defs>
            <g>
              {regions.map((region) => (
                <g key={region.name}>
                  <rect
                    className="fill-card/85 stroke-muted-foreground/60"
                    x={region.x}
                    y={region.y}
                    width={region.w}
                    height={region.h}
                    rx={6}
                  />
                  <path
                    className="fill-none stroke-muted-foreground/60"
                    strokeWidth={1.5}
                    d={ticks(region)}
                  />
                  <text
                    className="fill-foreground font-bold tracking-tighter"
                    fontSize={15}
                    x={region.x + 16}
                    y={region.y + 26}
                  >
                    {region.name}
                  </text>
                  <text
                    className="fill-muted-foreground"
                    fontSize={11.5}
                    x={region.x + 16}
                    y={region.y + 43}
                  >
                    acme/{region.name}
                  </text>
                </g>
              ))}
            </g>
            <g>
              {spines.map((spine) => (
                <path
                  key={spine.key}
                  className="fill-none stroke-muted-foreground/50"
                  strokeWidth={1.25}
                  d={spine.path}
                />
              ))}
              {edges.map((edge) => (
                <Edge
                  key={`${edge.from}-${edge.to}`}
                  edge={edge}
                  lit={edge.from === current || edge.to === current}
                  pr={pr}
                />
              ))}
              {joints.map((joint) => (
                <circle
                  key={joint.key}
                  className={fill[joint.provenance]}
                  cx={joint.x}
                  cy={joint.y}
                  r={2.5}
                />
              ))}
            </g>
            <g
              className={cn(
                'pointer-events-none transition duration-300',
                pr ? 'opacity-100' : 'translate-y-1.5 opacity-0',
              )}
              aria-hidden="true"
            >
              <path className="fill-none stroke-destructive" d="M540 160 H568 V444" />
              <circle className="fill-card stroke-destructive" cx={540} cy={160} r={3} />
              <rect
                className="fill-card stroke-destructive"
                x={20}
                y={444}
                width={560}
                height={88}
                rx={6}
              />
              <text className="fill-foreground" fontSize={12} x={36} y={470}>
                <tspan className="fill-destructive font-bold">breaking</tspan>
                <tspan>{'  payments/payment.completed'}</tspan>
              </text>
              <text className="fill-foreground" fontSize={12} x={36} y={491}>
                field `amount` (number) looks renamed to `amountMinor`
              </text>
              <text className="fill-muted-foreground" fontSize={12} x={36} y={512}>
                → breaks LedgerService, NotificationService.
              </text>
            </g>
            <g>
              {order.map((id) => {
                const node = nodes.get(id)!;
                const h = nodeHeight(id);
                const x = node.x - node.w / 2;
                const y = node.y - h / 2;
                const selected = id === current;
                const breaks = pr && BREAKS.has(id);
                const body = outline(id, node);

                const bodyClass = cn(
                  'transition-colors duration-300',
                  breaks
                    ? 'fill-destructive/10 stroke-destructive'
                    : selected
                      ? 'fill-extracted/15 stroke-foreground'
                      : 'fill-card stroke-foreground group-hover/node:fill-accent',
                );

                const bodyStroke = selected ? 2.25 : breaks ? 2 : 1.25;

                return (
                  <g
                    key={id}
                    className="group/node cursor-pointer outline-none"
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    aria-label={`${kindName[node.kind]} ${node.label ?? id}, show facts`}
                    onClick={() => setCurrent(id)}
                    onKeyDown={onKey(id)}
                  >
                    <rect
                      className="fill-none stroke-none group-focus-visible/node:stroke-ring"
                      strokeWidth={2}
                      x={x - 5}
                      y={y - 5}
                      width={node.w + 10}
                      height={h + 10}
                      rx={node.kind === 'event' ? h / 2 + 5 : 8}
                    />
                    {body.rect ? (
                      <rect className={bodyClass} strokeWidth={bodyStroke} {...body.rect} />
                    ) : (
                      <path className={bodyClass} strokeWidth={bodyStroke} d={body.d} />
                    )}
                    <Glyphs id={id} node={node} />
                    {id === 'payment.completed' && (
                      <g
                        className={cn('transition-opacity duration-300', !pr && 'opacity-0')}
                        aria-hidden="true"
                      >
                        <rect
                          className="fill-destructive/10 stroke-destructive"
                          x={x + 12}
                          y={y + h + 6}
                          width={168}
                          height={19}
                          rx={4}
                        />
                        <text
                          className="fill-muted-foreground"
                          fontSize={10.5}
                          x={x + 20}
                          y={y + h + 19.5}
                        >
                          <tspan className="line-through">amount</tspan>
                          <tspan className="fill-destructive"> → amountMinor</tspan>
                        </text>
                      </g>
                    )}
                    {BREAKS.has(id) && (
                      <g
                        className={cn('transition-opacity duration-300', !breaks && 'opacity-0')}
                        aria-hidden="true"
                      >
                        <rect
                          className="fill-destructive"
                          x={x + node.w - 54}
                          y={y - 10}
                          width={54}
                          height={18}
                          rx={9}
                        />
                        <text
                          className="fill-card font-bold"
                          fontSize={10}
                          x={x + node.w - 27}
                          y={y + 3}
                          textAnchor="middle"
                        >
                          breaks
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <aside
          className="flex min-w-0 flex-col gap-3.5 p-5 xl:w-90 xl:flex-none"
          aria-live="polite"
          aria-label="Fact sheet"
        >
          <div>
            <div className="text-xs text-muted-foreground">
              {sheet.kind} in acme/{regionOf(current)}
            </div>
            <h3 className="m-0 text-base font-bold tracking-tight wrap-anywhere">
              {sheet.title ?? current}
            </h3>
            <div className="mt-1 text-xs text-muted-foreground wrap-anywhere">{sheet.key}</div>
          </div>
          <p className="m-0 text-sm text-muted-foreground">{sheet.summary}</p>
          {alert && (
            <Alert variant="destructive">
              <AlertTitle>
                {BREAKS.has(current) ? 'Breaks in this pull request' : 'Breaking'}
              </AlertTitle>
              <AlertDescription>{alert}</AlertDescription>
            </Alert>
          )}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((fact) => (
              <FactRow key={fact.label} fact={fact} />
            ))}
          </ul>
        </aside>
      </div>
      <div className="flex flex-wrap border-t text-xs">
        <div className="flex flex-col gap-1 border-b px-4 py-2.5 max-sm:w-full sm:border-r">
          <span className="text-muted-foreground">Example</span>
          <span>acme, 4 repositories with the catalog topic</span>
        </div>
        <div className="flex flex-col gap-1 border-b px-4 py-2.5 max-sm:w-full sm:border-r">
          <span className="text-muted-foreground">Ref</span>
          <span>{ref}</span>
        </div>
        <div className="flex flex-1 flex-col gap-1 border-b px-4 py-2.5 max-sm:w-full sm:border-r">
          <span className="text-muted-foreground">Shapes</span>
          <span className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-muted-foreground">
            {keyItems.map((item) => (
              <span className="inline-flex items-center gap-2 whitespace-nowrap" key={item.name}>
                <svg
                  className="h-3.5 w-5.5 flex-none fill-none stroke-current"
                  viewBox="0 0 22 14"
                  aria-hidden="true"
                >
                  {item.glyph}
                </svg>
                {item.name}
              </span>
            ))}
          </span>
        </div>
        <div className="grid content-center gap-x-5.5 gap-y-1 border-b px-4 py-2.5 text-muted-foreground max-sm:w-full sm:grid-cols-2 xl:grid-cols-1">
          {legend.slice(0, pr ? 4 : 3).map((item) => (
            <span className="inline-flex items-center gap-2 whitespace-nowrap" key={item.tip}>
              <svg className="h-2 w-6" viewBox="0 0 24 8" aria-hidden="true">
                <path
                  className={stroke[item.tip]}
                  d="M1 4h22"
                  strokeWidth={2}
                  strokeDasharray={
                    item.tip === 'inferred' ? '5 4' : item.tip === 'breaking' ? '2 5' : undefined
                  }
                  strokeLinecap={item.tip === 'breaking' ? 'round' : undefined}
                />
              </svg>
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default LivingMap;
