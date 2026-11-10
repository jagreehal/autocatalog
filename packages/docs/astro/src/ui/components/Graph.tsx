/** @jsxImportSource react */
import '@eventcatalog/visualiser/styles-core.css';
import { cn } from 'cn';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { mapHeight, type VisualiserGraph } from '#ui/lib/visualiser.ts';
import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '#ui/components/ui/button.tsx';

// React Flow, dagre and mermaid come to a quarter of a megabyte gzipped, so
// the map's code loads only as it nears the viewport, never with the page.
const Visualiser = lazy(() => import('./Visualiser'));

export interface GraphProps {
  id: string;
  label: string;
  visualiser?: VisualiserGraph;
  /** The tallest the live map may be; a small graph takes less, sized to open near full size. */
  height?: keyof typeof heights;
  /** The static picture (a flow strip): for a reader without JavaScript, and when there is no map. */
  fallback?: ReactNode;
}

const heights = { '20rem': 20, '30rem': 30 };

// The row above the map: runtime evidence's modes and key, or a flow's walkthrough.
const TOOLBAR_REM = 2.5;

/**
 * A map of resources and the messages between them. With JavaScript it is
 * EventCatalog's interactive visualiser, in a box sized up front so nothing on
 * the page moves when it arrives. The fallback is the static picture for a
 * reader without JavaScript, and for when the map cannot run.
 */
/** Whether the map is a flow, which offers its walkthrough above the map. */
const isFlow = (visualiser: VisualiserGraph | undefined) =>
  visualiser?.graph.edges.some((edge) => edge.type === 'flow-step') ?? false;

export function Graph({ id, label, visualiser, height = '20rem', fallback }: GraphProps) {
  const box = useRef<HTMLDivElement>(null);

  const [near, setNear] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [portal, setPortal] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortal(document.body);
  }, []);

  useEffect(() => {
    if (!visualiser || !box.current || fullscreen) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        setNear(true);
        observer.disconnect();
      },
      { rootMargin: '200px' },
    );

    observer.observe(box.current);

    return () => observer.disconnect();
  }, [visualiser, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };

    document.documentElement.dataset.graphFullscreen = '';
    window.addEventListener('keydown', onKey);

    return () => {
      delete document.documentElement.dataset.graphFullscreen;
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  if (!visualiser) {
    return (
      <div className="not-content" data-graph>
        {fallback}
      </div>
    );
  }

  // The same sized, empty box the map draws into, so nothing moves when it arrives.
  const placeholder = (
    <div
      className="flex h-full items-center justify-center rounded-xl border bg-background text-xs text-muted-foreground"
      data-graph-portal
    >
      Loading map…
    </div>
  );

  const map = (open: boolean) => (
    <div className={cn('relative h-full', !open && 'noscript:hidden')}>
      <Button
        variant="outline"
        size="icon-sm"
        className="absolute top-2 right-2 z-10"
        aria-label={open ? 'Exit full screen' : 'Open map full screen'}
        aria-pressed={open}
        data-graph-fullscreen-toggle=""
        onPress={() => setFullscreen((value) => !value)}
      >
        {open ? <Minimize2Icon /> : <Maximize2Icon />}
      </Button>
      {near || open ? (
        <Suspense fallback={placeholder}>
          <Visualiser
            id={open ? `${id}-fullscreen` : id}
            label={label}
            graph={visualiser.graph}
            hrefs={visualiser.hrefs}
            evidence={visualiser.evidence}
            live={visualiser.live}
            steps={visualiser.steps}
            lanes={visualiser.lanes}
            levels={visualiser.levels}
            proposed={visualiser.proposed}
          />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  );

  // Sized before the map loads, from the graph's shape, so nothing below it moves.
  const toolbar = Boolean(visualiser?.evidence) || isFlow(visualiser);

  const boxHeight = visualiser
    ? mapHeight(visualiser.graph, heights[height]) + (toolbar ? TOOLBAR_REM : 0)
    : heights[height];

  return (
    <div ref={box} className="not-content" data-graph="">
      {/* In place: keeps the page height while fullscreen is portalled to body. */}
      <div
        className="h-(--ac-map-height) noscript:hidden"
        // SAFETY: a custom property is a valid inline style; React's type lists only standard ones.
        style={{ '--ac-map-height': `${boxHeight}rem` } as CSSProperties}
      >
        {fullscreen ? placeholder : map(false)}
      </div>
      <noscript>{fallback}</noscript>
      {fullscreen &&
        portal &&
        createPortal(
          <div
            data-graph=""
            data-graph-fullscreen=""
            role="dialog"
            aria-modal="true"
            aria-label={label}
          >
            {map(true)}
          </div>,
          portal,
        )}
    </div>
  );
}

export default Graph;
