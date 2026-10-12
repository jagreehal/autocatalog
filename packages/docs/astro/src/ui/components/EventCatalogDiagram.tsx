/** @jsxImportSource react */
import { ArrowUpRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LinkButton } from '#ui/components/ui/button.tsx';

export interface EventCatalogDiagramProps {
  /** Whether EventCatalog is built in its chrome-free embed mode, so a frame can show just the diagram. */
  embed: boolean;
  /** The embeddable page, with `embed=true` already on it. */
  iframeSrc: string;
  /** Where the diagram opens in the hosted EventCatalog. */
  openHref: string;
  title: string;
}

/**
 * Inline only in EventCatalog's chrome-free embed mode. Without it the frame
 * would hold EventCatalog's whole interface, so the reader opens the diagram
 * in the hosted EventCatalog on the Architecture page instead.
 */
export function EventCatalogDiagram({
  embed,
  iframeSrc,
  openHref,
  title,
}: EventCatalogDiagramProps) {
  // No src until the theme is known, so without JavaScript only the link shows.
  const [src, setSrc] = useState<string | undefined>(undefined);

  // EventCatalog takes the theme on the URL in embed mode, so the frame follows
  // Starlight's theme as the reader toggles it, without touching EventCatalog's
  // own saved preference.
  useEffect(() => {
    if (!embed) return;

    const sync = () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

      const url = new URL(iframeSrc, location.href);

      url.searchParams.set('theme', theme);
      setSrc(url.href);
    };

    sync();

    const observer = new MutationObserver(sync);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [embed, iframeSrc]);

  if (!embed) {
    return (
      <p className="not-content m-0">
        <LinkButton variant="outline" href={openHref}>
          Open the diagram in EventCatalog
          <ArrowUpRightIcon data-icon="inline-end" />
        </LinkButton>
      </p>
    );
  }

  return (
    <figure className="not-content m-0 flex flex-col gap-2">
      <iframe
        className="h-128 w-full rounded-xl border"
        src={src}
        title={title}
        loading="lazy"
        hidden={src === undefined}
      />
      <figcaption className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        {title}
        <a
          className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={openHref}
        >
          Open in EventCatalog
          <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

export default EventCatalogDiagram;
