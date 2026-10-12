/** @jsxImportSource react */
import '@eventcatalog/visualiser/styles-core.css';
import type { DslGraph } from '@eventcatalog/visualiser';
import { cn } from 'cn';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

// React Flow, dagre and mermaid come to a quarter of a megabyte gzipped, so
// the map's code loads only as it nears the viewport, never with the page.
const Visualiser = lazy(() => import('./Visualiser'));

export interface GraphProps {
  id: string;
  label: string;
  visualiser?: { graph: DslGraph; hrefs: Record<string, string> };
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

  // Measured once, as the map is about to load: a narrow box lays the map out top to bottom.
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');

  useEffect(() => {
    if (!visualiser || !box.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        if (box.current && box.current.clientWidth < 640) setDirection('TB');

        setNear(true);
        observer.disconnect();
      },
      { rootMargin: '200px' },
    );

    observer.observe(box.current);

    return () => observer.disconnect();
  }, [visualiser]);

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

  return (
    <div ref={box} className="not-content" data-graph>
      {/* Without JavaScript the empty box steps aside for the static picture. */}
      <div className={cn('noscript:hidden', heights[height])}>
        {near ? (
          <Suspense fallback={placeholder}>
            <Visualiser
              id={id}
              label={label}
              graph={visualiser.graph}
              hrefs={visualiser.hrefs}
              direction={direction}
            />
          </Suspense>
        ) : (
          placeholder
        )}
      </div>
      <noscript>{fallback}</noscript>
    </div>
  );
}

export default Graph;
