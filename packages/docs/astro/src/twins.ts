import path from 'node:path';
import { docToMarkdown, sourceUrl, type Doc, type DocsManifest } from 'autocatalog-docs-core';
import type { CatalogEvent } from './catalog';
import { docsSiteConfig } from './config';
import { eventPath } from './event-path';

/**
 * The raw Markdown beside each page, at its URL with `.md` in place of the
 * trailing slash: what an agent reads instead of the HTML, and what
 * `llms-full.txt` is made of.
 */
export function twinPath(pagePath: string): string {
  return `${pagePath.replace(/\/$/, '')}.md`;
}

/** Where a twin's page lives, for its `url` field. Absent without a `site`. */
export function pageUrl(site: URL | undefined, base: string, pagePath: string): string | undefined {
  return site && new URL(`${base}${pagePath}`, site).href;
}

/**
 * A document as authored, plus what an agent needs to cite it: when git last
 * saw it change, the file on its repository, and the page's own URL.
 */
export function docTwin(doc: Doc, manifest: DocsManifest, url?: string): string {
  const record = manifest[doc.id];

  return docToMarkdown(
    {
      // The kind its folder gave it, which the file itself may not say.
      ...(record?.kind && { kind: record.kind }),
      ...doc.data,
      ...(record?.updated && { updated: record.updated }),
      ...(record?.source && { source: record.source }),
      ...(url && { url }),
    },
    doc.body,
  );
}

/**
 * An event's contract as Markdown: who owns, produces and consumes it, the
 * team's narrative, then the schema a consumer validates against.
 */
export function eventTwin(
  { event }: CatalogEvent,
  links: { source?: string | null; url?: string | undefined },
): string {
  const fm = event.frontmatter;

  const body = [
    `# ${fm.name}`,
    '',
    fm.summary,
    '',
    ...(event.body.trim() ? [event.body.trim(), ''] : []),
    '## Schema',
    '',
    '```json',
    JSON.stringify(event.schema, null, 2),
    '```',
    '',
  ].join('\n');

  return docToMarkdown(
    {
      id: fm.id,
      version: fm.version,
      domain: fm.domain,
      status: fm.status,
      ...(fm.owner && { owner: fm.owner.team }),
      producers: fm.producers,
      consumers: fm.consumers,
      ...(links.source && { source: links.source }),
      ...(links.url && { url: links.url }),
    },
    body,
  );
}

/** The event's folder on its repository, when the catalog was committed there. */
export function eventSource({ event }: CatalogEvent): string | null {
  const { root } = docsSiteConfig();

  const folder = path.relative(root, event.folder.path).split(path.sep).join('/');

  return folder.startsWith('..') ? null : sourceUrl(root, folder, 'tree');
}

/**
 * A service as its events describe it: what it produces and consumes, each
 * linked to that event's own twin.
 */
export function serviceTwin(
  service: { name: string; summary?: string | undefined; owner?: string | undefined },
  lists: { produces: CatalogEvent[]; consumes: CatalogEvent[] },
  links: { base: string; repository?: string | undefined; url?: string | undefined },
): string {
  const section = (heading: string, events: CatalogEvent[]) =>
    events.length === 0
      ? []
      : [
          `## ${heading}`,
          '',
          ...events.map((entry) => {
            const { name, domain, id } = entry.event.frontmatter;

            return `- [${name}](${links.base}${twinPath(eventPath(entry))}): \`${domain}/${id}\``;
          }),
          '',
        ];

  const body = [
    `# ${service.name}`,
    '',
    service.summary ?? 'Inferred from the producers and consumers that each event declares.',
    '',
    ...section('Produces', lists.produces),
    ...section('Consumes', lists.consumes),
  ].join('\n');

  return docToMarkdown(
    {
      name: service.name,
      ...(service.owner && { owner: service.owner }),
      produces: lists.produces.map(
        ({ event }) => `${event.frontmatter.domain}/${event.frontmatter.id}`,
      ),
      consumes: lists.consumes.map(
        ({ event }) => `${event.frontmatter.domain}/${event.frontmatter.id}`,
      ),
      ...(links.repository && { source: links.repository }),
      ...(links.url && { url: links.url }),
    },
    body,
  );
}
