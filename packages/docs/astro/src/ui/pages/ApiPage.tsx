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
}

/** Scalar's API reference, pinned to one release. */
const SCALAR =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4/dist/browser/standalone.js';

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
function useScalar(specHref: string) {
  const target = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const configuration = {
      url: specHref,
      // The page around it has the site's own navigation, search and theme.
      showSidebar: false,
      hideSearch: true,
      hideDarkModeToggle: true,
      hideClientButton: true,
      withDefaultFonts: false,
      showDeveloperTools: 'never' as const,
      agent: { disabled: true },
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
  }, [specHref]);

  return { target, ready };
}

export function ApiPage({
  version,
  repository,
  file,
  specHref,
  services,
  operations,
}: ApiPageProps) {
  const { target, ready } = useScalar(specHref);

  return (
    <div className="not-content flex flex-col gap-8" data-wide>
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
