/** @jsxImportSource react */
import { useEffect, useRef, useState } from 'react';
import { eventCatalogPath } from '../../eventcatalog-path';

export interface ArchitecturePageProps {
  /** The site base, ending in a slash. */
  base: string;
  /** EventCatalog's own front page, relative to the base. */
  defaultPath: string;
}

/**
 * EventCatalog runs whole, its own header included, inside the site. `?at=`
 * names the EventCatalog page to open, so other pages link straight to a
 * diagram here. Without JavaScript the link opens EventCatalog directly.
 */
export function ArchitecturePage({ base, defaultPath }: ArchitecturePageProps) {
  const frame = useRef<HTMLIFrameElement>(null);

  // No src until the page is running, so without JavaScript only the link shows.
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    const at = eventCatalogPath(new URLSearchParams(location.search).get('at'));

    // EventCatalog keeps its own theme. Hosted here it follows the site's,
    // set before it loads and switched in place when the reader toggles.
    const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

    const syncTheme = () => {
      try {
        localStorage.setItem('eventcatalog-theme', theme());
      } catch {
        // Storage can be off; EventCatalog then keeps its default.
      }

      frame.current?.contentDocument?.documentElement.setAttribute('data-theme', theme());
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    setSrc(`${base}${at ?? defaultPath}`);

    return () => observer.disconnect();
  }, [base, defaultPath]);

  // Same origin, so the address bar can follow EventCatalog as the reader moves
  // around it: a reload or a shared link reopens the same diagram.
  const onLoad = () => {
    let inner = '';

    try {
      inner = frame.current?.contentWindow?.location.pathname ?? '';
    } catch {
      // A catalog on another origin cannot be read; the address bar stays put.
      return;
    }

    const path = eventCatalogPath(inner.startsWith(base) ? inner.slice(base.length) : null);

    if (!path) return;

    const url = new URL(location.href);

    url.searchParams.set('at', path);

    history.replaceState(null, '', url);
  };

  return (
    // data-eventcatalog gives EventCatalog the whole content column and sizes
    // the frame to the viewport (theme.css).
    <div className="not-content" data-eventcatalog data-base={base} data-default={defaultPath}>
      <iframe
        ref={frame}
        title="EventCatalog"
        src={src}
        className="min-h-128 w-full rounded-xl border bg-card"
        hidden={src === undefined}
        onLoad={onLoad}
      />
      <p hidden={src !== undefined}>
        <a href={`${base}${defaultPath}`}>Open EventCatalog</a>
      </p>
    </div>
  );
}

export default ArchitecturePage;
