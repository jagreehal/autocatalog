/** @jsxImportSource react */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '#ui/components/ui/badge.tsx';
import { Button, LinkButton } from '#ui/components/ui/button.tsx';
import { ButtonGroup } from '#ui/components/ui/button-group.tsx';
import { Separator } from '#ui/components/ui/separator.tsx';
import { COPY_MARKDOWN_LABEL, type PageAction, type PillTone } from '../../shell';
import { Icon } from '../components/Icon';
import { statusVariant } from '../lib/status';
import { FavoriteToggle } from './Favorites';

export interface PageTitleChromeProps {
  /** `doc`, or the resource kind; drives Search's Kind tabs. */
  kind?: string;
  /** The kind as a reader says it ("Document", "Event"), for Search's Kind tabs. */
  kindLabel?: string;
  /** The resource's key in the catalog, such as `event:payments/payment.captured`. */
  catalogKey?: string;
  /** A call to action level with the title, such as "Explore catalog". */
  primary?: { label: string; href: string };
  /** The page's title, as a pin in the sidebar names it. */
  title?: string;
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

/**
 * Markdown for a page that has no twin: the title, key, summary and the article
 * body as plain paragraphs, enough for an agent to quote without the chrome.
 */
export function pageAsMarkdown(root: ParentNode = document): string {
  const title =
    root.querySelector('[data-page-title] h1')?.textContent?.trim() ||
    root.querySelector('h1')?.textContent?.trim() ||
    'Untitled';

  const key = root.querySelector('[data-page-title] code')?.textContent?.trim();
  const summary = root.querySelector('[data-page-title] p')?.textContent?.trim();

  const body =
    root.querySelector('main .sl-markdown-content') ??
    root.querySelector('main [data-catalog-explorer]') ??
    root.querySelector('main');

  const lines = [`# ${title}`, ''];

  if (key) lines.push(`\`${key}\``, '');

  if (summary) lines.push(summary, '');

  const text = body?.textContent?.replace(/\n{3,}/g, '\n\n').trim();

  if (text && text !== title && text !== summary) lines.push(text, '');

  return lines.join('\n');
}

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

/** Copies a twin when the page has one, else the page itself as Markdown. */
function CopyMarkdownButton({
  href,
  onStatus,
}: {
  href?: string;
  onStatus: (message: string) => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let result = 'Copied';

    try {
      const text = href
        ? await (async () => {
            const response = await fetch(href);

            if (!response.ok) throw new Error(String(response.status));

            return response.text();
          })()
        : pageAsMarkdown();

      await navigator.clipboard.writeText(text);
    } catch {
      result = 'Copy failed';
    }

    setMessage(result);
    onStatus(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), RESET_MS);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      data-copy-markdown=""
      {...(href ? { 'data-copy-from': href } : {})}
      onPress={copy}
    >
      <Icon name="copy" />
      <span data-label="">{message ?? COPY_MARKDOWN_LABEL}</span>
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
  title,
  summary,
  pills,
  status,
  facts = [],
  actions,
  children,
}: PageTitleChromeProps) {
  const [announcement, setAnnouncement] = useState('');

  const hasMarkdownCopy = actions.some(
    (action) => action.copy && action.label === COPY_MARKDOWN_LABEL,
  );

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
      <ButtonGroup aria-label="Page actions" data-pagefind-ignore="">
        {actions.map((action) =>
          action.copy && action.label === COPY_MARKDOWN_LABEL ? (
            <CopyMarkdownButton
              key={`${action.href}|${action.label}`}
              href={action.href}
              onStatus={setAnnouncement}
            />
          ) : action.copy ? (
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
        {/* Pages with no Markdown twin still get a copy of the page itself. */}
        {!hasMarkdownCopy && <CopyMarkdownButton onStatus={setAnnouncement} />}
        <FavoriteToggle catalogKey={catalogKey} label={title} />
      </ButtonGroup>
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
