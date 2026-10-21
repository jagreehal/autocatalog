/** @jsxImportSource react */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button, LinkButton } from '#ui/components/ui/button.tsx';
import { ButtonGroup } from '#ui/components/ui/button-group.tsx';
import { Separator } from '#ui/components/ui/separator.tsx';
import type { PageAction, PillTone } from '../../shell';
import { Icon } from '../components/Icon';
import { statusVariant } from '../lib/status';

export interface PageTitleChromeProps {
  /** `doc`, or the resource kind; drives Search's Kind tabs. */
  kind?: string;
  /** The kind as a reader says it ("Document", "Event"), for Search's Kind tabs. */
  kindLabel?: string;
  /** The resource's key in the catalog, such as `event:payments/payment.captured`. */
  catalogKey?: string;
  /** A call to action level with the title, such as "Explore catalog". */
  primary?: { label: string; href: string };
  /** The sentence that says what the page is for. */
  summary?: string;
  /** States worth flagging beside the key: a version, deprecated. */
  pills: Array<{ text: string; tone?: PillTone }>;
  /** A decision's, runbook's or incident's state, such as `accepted`. */
  status?: string | undefined;
  /** What a document of a kind records about itself: its kind, date, what it applies to. */
  facts?: TitleFact[] | undefined;
  actions: PageAction[];
  /** Starlight's own `<h1>`, rendered by the Astro shell. */
  children?: ReactNode;
}

/** One labelled fact in the title block: text, or links to the pages it names. */
export interface TitleFact {
  term: string;
  text?: string;
  links?: Array<{ label: string; href: string }>;
}

const PILL_VARIANT = { warn: 'destructive', quiet: 'secondary', plain: 'outline' } as const;

/** How long "Copied" stays on the button before it says what it does again. */
const RESET_MS = 1600;

/** Copies what `href` serves, and says so on the button and to a screen reader. */
function CopyAction({
  action,
  onStatus,
}: {
  action: PageAction;
  onStatus: (message: string) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let result = 'Copied';

    try {
      const response = await fetch(action.href);

      if (!response.ok) throw new Error(String(response.status));

      await navigator.clipboard.writeText(await response.text());
    } catch {
      result = 'Copy failed';
    }

    setMessage(result);
    onStatus(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), RESET_MS);
  };

  return (
    <Button variant="outline" size="sm" data-copy-from={action.href} onPress={copy}>
      <Icon name={action.icon} />
      <span data-label="">{message ?? action.label}</span>
    </Button>
  );
}

/**
 * The head of every page: its title, then what the catalog calls it (its key,
 * which already says what kind of thing it is), the sentence that says what it
 * is for, and what a reader can do with the page itself.
 */
export function PageTitleChrome({
  kind,
  kindLabel,
  catalogKey,
  primary,
  summary,
  pills,
  status,
  facts = [],
  actions,
  children,
}: PageTitleChromeProps) {
  const [announcement, setAnnouncement] = useState('');

  return (
    <div className="mt-5 flex flex-col gap-4" data-page-title>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          {children}
          {(catalogKey || pills.length > 0 || status) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-pagefind-ignore="">
              {catalogKey && (
                <code className="font-mono text-sm break-all text-muted-foreground">
                  {catalogKey}
                </code>
              )}
              {status && (
                <Badge variant={statusVariant(status)} data-status={status}>
                  {status}
                </Badge>
              )}
              {pills.map((pill, index) => (
                <Badge
                  key={`${index}:${pill.text}`}
                  variant={PILL_VARIANT[pill.tone ?? 'plain']}
                  data-tone={pill.tone}
                >
                  {pill.text}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {primary && (
          <LinkButton variant="outline" href={primary.href}>
            {primary.label}
            <Icon name="arrow" />
          </LinkButton>
        )}
      </div>
      {summary && <p className="m-0 max-w-prose text-base text-foreground">{summary}</p>}
      {facts.length > 0 && (
        <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3" data-facts="">
          {facts.map((fact) => (
            <div
              key={fact.term}
              // A sentence-long fact (a root cause, a fix) gets the whole line.
              className={`m-0 flex flex-col gap-0.5 ${(fact.text?.length ?? 0) > 48 ? 'basis-full' : ''}`}
            >
              <dt className="text-xs text-muted-foreground">{fact.term}</dt>
              <dd className="m-0 max-w-prose text-sm text-foreground">
                {fact.links
                  ? fact.links.map((target, index) => (
                      <Fragment key={target.href}>
                        {index > 0 && ', '}
                        <a
                          href={target.href}
                          className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                        >
                          {target.label}
                        </a>
                      </Fragment>
                    ))
                  : fact.text}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {actions.length > 0 && (
        <ButtonGroup aria-label="Page actions" data-pagefind-ignore="">
          {actions.map((action) =>
            action.copy ? (
              <CopyAction
                key={`${action.href}|${action.label}`}
                action={action}
                onStatus={setAnnouncement}
              />
            ) : (
              <LinkButton
                key={`${action.href}|${action.label}`}
                variant="outline"
                size="sm"
                href={action.href}
              >
                <Icon name={action.icon} />
                {action.label}
              </LinkButton>
            ),
          )}
        </ButtonGroup>
      )}
      <Separator className="mt-1" />
      {/* A screen reader hears the result of a copy, not only a changed label. */}
      <span className="sr-only" role="status" aria-live="polite" data-copy-status="">
        {announcement}
      </span>
      {/* Search's Kind tabs read this; it has no content, so excerpts stay clean. */}
      {kind && <span hidden data-pagefind-filter={`kind:${kindLabel}`} />}
    </div>
  );
}

export default PageTitleChrome;
