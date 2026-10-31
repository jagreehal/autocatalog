/** @jsxImportSource react */
import '@eventcatalog/visualiser/styles-core.css';
import { cn } from 'cn';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import type { VisualiserGraph } from '#ui/lib/visualiser.ts';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '#ui/components/ui/button.tsx';

// React Flow, dagre and mermaid come to a quarter of a megabyte gzipped, so
// the map's code loads only as it nears the viewport, never with the page.
const Visualiser = lazy(() => import('./Visualiser'));

export interface GraphProps {
  id: string;
  label: string;
  visualiser?: VisualiserGraph;
  /** The live map's height; a one-hop flow needs less than the whole catalog. */
  height?: keyof typeof heights;
  /** The static picture (a flow strip): for a reader without JavaScript, and when there is no map. */
  fallback?: ReactNode;
}

const heights = { '20rem': 'h-80', '30rem': 'h-120' };

/**
 * A map of resources and the messages between them. With JavaScript it is
 * EventCatalog's interactive visualiser, in a box sized up front so nothing on
 * the page moves when it arrives. The fallback is the static picture for a
 * reader without JavaScript, and for when the map cannot run.
 */
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

  return (
    <div ref={box} className="not-content" data-graph="">
      {/* In place: keeps the page height while fullscreen is portalled to body. */}
      <div className={cn('noscript:hidden', heights[height])}>
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
