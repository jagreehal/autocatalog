/** @jsxImportSource react */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#ui/components/ui/table.tsx';

export interface ApiOperation {
  /** Upper-case, as a request line writes it. */
  method: string;
  path: string;
  summary?: string | undefined;
  deprecated: boolean;
}

export interface ApiPageProps {
  version?: string | undefined;
  repository: string;
  /** Where the repository keeps the spec. */
  file: string;
  /** The spec as JSON, published beside the page. */
  specHref: string;
  /** Services this API is matched to by its title or the events it defines. */
  services: Array<{ name: string; href: string }>;
  operations: ApiOperation[];
  /**
   * Read outside the company: the page leaves out where the spec lives and who
   * serves it, and readers can send requests from the reference.
   */
  outside?: boolean | undefined;
  /**
   * `full`: Scalar takes the page below the header, with its own sidebar,
   * search and request client. `embedded`: it sits in the site's navigation.
   */
  layout?: 'full' | 'embedded' | undefined;
  /** The site's MCP endpoint, which Scalar's Connect MCP button installs; without one the button is left out. */
  mcp?: { name: string; path: string } | undefined;
}

/** Scalar's API reference, pinned to one release. */
const SCALAR =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4/dist/browser/standalone.js';

/**
 * Scalar's colours, type and corners, read from the site's shadcn tokens, so a
 * brand's theme.css restyles the reference too. The tokens already change with
 * the theme, so one mapping serves light and dark. It comes after Scalar's own
 * theme, and wins at the same specificity.
 */
const SCALAR_THEME = `
.light-mode, .dark-mode {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono, var(--sl-font-mono));
  --scalar-radius: calc(var(--radius) * 0.6);
  --scalar-radius-lg: var(--radius);
  --scalar-radius-xl: calc(var(--radius) * 1.4);
  --scalar-background-1: var(--background);
  --scalar-background-2: var(--muted);
  --scalar-background-3: var(--secondary);
  --scalar-background-accent: color-mix(in oklab, var(--primary) 12%, transparent);
  --scalar-color-1: var(--foreground);
  --scalar-color-2: var(--muted-foreground);
  --scalar-color-3: color-mix(in oklab, var(--muted-foreground) 80%, var(--background));
  --scalar-color-accent: var(--primary);
  --scalar-border-color: var(--border);
  --scalar-button-1: var(--primary);
  --scalar-button-1-color: var(--primary-foreground);
  --scalar-button-1-hover: color-mix(in oklab, var(--primary) 88%, var(--foreground));
}
.light-mode .t-doc__sidebar, .dark-mode .t-doc__sidebar {
  --scalar-sidebar-background-1: var(--sidebar);
  --scalar-sidebar-color-1: var(--sidebar-foreground);
  --scalar-sidebar-color-2: color-mix(in oklab, var(--sidebar-foreground) 75%, var(--sidebar));
  --scalar-sidebar-border-color: var(--sidebar-border);
  --scalar-sidebar-item-hover-background: var(--sidebar-accent);
  --scalar-sidebar-item-active-background: var(--sidebar-accent);
  --scalar-sidebar-color-active: var(--sidebar-accent-foreground);
  --scalar-sidebar-search-background: var(--background);
  --scalar-sidebar-search-border-color: var(--sidebar-border);
}
`;

/** The part of Scalar's configuration this page sets. */
interface ScalarConfiguration {
  url: string;
  showSidebar: boolean;
  hideSearch: boolean;
  hideDarkModeToggle: boolean;
  hideClientButton: boolean;
  withDefaultFonts: boolean;
  showDeveloperTools: 'never';
  agent: { disabled: boolean };
  forceDarkModeState: 'dark' | 'light';
  customCss: string;
  mcp: { name?: string; url?: string; disabled?: boolean };
}

declare global {
  interface Window {
    Scalar?: {
      createApiReference: (element: HTMLElement, configuration: ScalarConfiguration) => void;
    };
  }
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

const isDark = () => document.documentElement.dataset.theme === 'dark';

/**
 * Draws the interactive reference once Scalar loads. Until then, and offline,
 * the operations table rendered on the server stands in.
 */
function useScalar(specHref: string, outside: boolean, full: boolean, mcp: ApiPageProps['mcp']) {
  const target = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const configuration = {
      url: specHref,
      // Embedded, the page around it has the site's own navigation and search.
      // Full, the reference is the navigation. The theme is always the site's.
      showSidebar: full,
      hideSearch: !full,
      hideDarkModeToggle: true,
      hideClientButton: !outside && !full,
      withDefaultFonts: false,
      showDeveloperTools: 'never' as const,
      agent: { disabled: true },
      customCss: SCALAR_THEME,
      // Scalar's own button offers to generate a server elsewhere; point it at this site's.
      mcp: mcp
        ? { name: mcp.name, url: new URL(mcp.path, window.location.href).href }
        : { disabled: true },
    };

    let observer: MutationObserver | undefined;

    const mount = () => {
      if (!window.Scalar || !target.current) return;

      window.Scalar.createApiReference(target.current, {
        ...configuration,
        forceDarkModeState: isDark() ? 'dark' : 'light',
      });
      setReady(true);

      // Starlight's theme switch sets data-theme. Scalar reads its mode from
      // these body classes, and only applies a forced mode when it mounts.
      observer = new MutationObserver(() => {
        document.body.classList.toggle('dark-mode', isDark());
        document.body.classList.toggle('light-mode', !isDark());
      });
      observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCALAR}"]`);

    if (window.Scalar) mount();
    else {
      script ??= Object.assign(document.createElement('script'), { src: SCALAR });
      script.addEventListener('load', mount);
      document.head.append(script);
    }

    return () => {
      script?.removeEventListener('load', mount);
      observer?.disconnect();
    };
  }, [specHref, outside, full, mcp?.name, mcp?.path]);

  return { target, ready };
}

export function ApiPage({
  version,
  repository,
  file,
  specHref,
  services,
  operations,
  outside = false,
  layout = 'embedded',
  mcp,
}: ApiPageProps) {
  const full = layout === 'full';

  const { target, ready } = useScalar(specHref, outside, full, mcp);

  return (
    <div
      className="not-content flex flex-col gap-8"
      {...(full ? { 'data-api-reference': 'full' } : { 'data-wide': '' })}
    >
      {!outside && (
        <p className="m-0 max-w-prose">
          {version && <>Version {version}, read </>}
          {version ? 'from' : 'Read from'} <code>{file}</code> in the {repository} repository.
          {services.length > 0 && (
            <>
              {' '}
              Served by{' '}
              {services.map((service, i) => (
                <Fragment key={service.name}>
                  {i > 0 && (i === services.length - 1 ? ' and ' : ', ')}
                  <a className={link} href={service.href} data-kind="service">
                    {service.name}
                  </a>
                </Fragment>
              ))}
              .
            </>
          )}
        </p>
      )}

      {!ready && (
        <Card id="operations">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Operations
            </CardTitle>
            <CardAction>
              <span className="text-muted-foreground">
                {operations.length} {operations.length === 1 ? 'operation' : 'operations'}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table aria-label="Operations">
              <TableHeader>
                <TableHead isRowHeader>Operation</TableHead>
                <TableHead>Summary</TableHead>
              </TableHeader>
              <TableBody>
                {operations.map((operation) => (
                  <TableRow key={`${operation.method} ${operation.path}`}>
                    <TableCell>
                      <code>
                        {operation.method} {operation.path}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {operation.summary ?? (
                          <span className="text-muted-foreground">No summary</span>
                        )}
                        {operation.deprecated && <Badge variant="outline">Deprecated</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 mb-0 text-muted-foreground">
              The full reference is the spec itself:{' '}
              <a className={link} href={specHref}>
                <code>openapi.json</code>
              </a>
              .
            </p>
          </CardContent>
        </Card>
      )}

      <div ref={target} />
    </div>
  );
}

export default ApiPage;
