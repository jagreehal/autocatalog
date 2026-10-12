import fs from 'node:fs/promises';
import path from 'node:path';

/** An internal link in the built site with nothing behind it. */
export interface BrokenLink {
  /** The page the link is on, as served. */
  page: string;
  href: string;
  /** `page` when no file answers the path, `anchor` when the page has no such id. */
  kind: 'page' | 'anchor';
}

const ORIGIN = 'https://autocatalog.invalid';

/** EventCatalog's build, copied in by `ac site --eventcatalog`: its links are its own. */
const EVENTCATALOG = 'eventcatalog/';

/**
 * Every internal link in the built HTML that points at nothing: a body link to
 * a renamed document, an `/events/` or `/services/` href to a page that was
 * never built, a `#fragment` no heading carries.
 *
 * Read from the output rather than the sources because that is what a reader
 * clicks: links Starlight generates, links pages build, and links authors write
 * all end up here, after the base path has been applied.
 *
 * Attributes are read with a regex, which holds for the quoted markup Astro
 * emits. hast-util-from-html would also read hand-written unquoted attributes.
 */
export async function brokenLinks(outDir: string, base = '/'): Promise<BrokenLink[]> {
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');

  const files = new Set(
    (await fs.readdir(outDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(outDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
      ),
  );

  const pages = new Map<string, { ids: Set<string>; hrefs: string[] }>();

  const ours = (name: string) => name.endsWith('.html') && !name.startsWith(EVENTCATALOG);

  for (const file of [...files].filter(ours).sort()) {
    // Comments, scripts and styles can contain href-shaped text that is not a link.
    const html = (await fs.readFile(path.join(outDir, file), 'utf8'))
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');

    const attr = (pattern: RegExp) =>
      [...html.matchAll(pattern)].map((match) => unescape(match[1]!));

    pages.set(file, {
      ids: new Set(attr(/<[a-z][^>]*?\sid="([^"]*)"/gi)),
      hrefs: attr(/<(?:a|area)\s[^>]*?href="([^"]*)"/gi),
    });
  }

  const fileFor = (pathname: string): string | undefined => {
    const relative = decode(pathname).replace(/^\/+/, '');

    return [
      relative,
      path.posix.join(relative, 'index.html'),
      `${relative.replace(/\/$/, '')}.html`,
    ].find((candidate) => files.has(candidate));
  };

  const broken: BrokenLink[] = [];

  for (const [file, { hrefs }] of pages) {
    const page = `${prefix}/${file.replace(/(^|\/)index\.html$/, '$1')}`;

    for (const href of new Set(hrefs)) {
      let target: URL;

      try {
        target = new URL(href, `${ORIGIN}${page}`);
      } catch {
        broken.push({ page, href, kind: 'page' });
        continue;
      }

      // Outside the base is another site on the same host, not ours to judge,
      // and EventCatalog's output is not ours either, and is copied in later.
      const outside =
        (prefix !== '' &&
          target.pathname !== prefix &&
          !target.pathname.startsWith(`${prefix}/`)) ||
        target.pathname.startsWith(`${prefix}/${EVENTCATALOG}`);

      if (target.origin !== ORIGIN || outside) continue;
      const found = fileFor(target.pathname.slice(prefix.length) || '/');

      if (!found) {
        broken.push({ page, href, kind: 'page' });
        continue;
      }

      // A browser tries the fragment as written, then percent-decoded.
      const anchor = target.hash.slice(1);
      // Fragments into non-HTML files mean something else, so only pages are checked.
      const ids = pages.get(found)?.ids;

      // Browsers scroll `#top` to the start of the document without an element.
      const top = anchor.toLowerCase() === 'top';

      if (anchor && !top && ids && !ids.has(anchor) && !ids.has(decode(anchor))) {
        broken.push({ page, href, kind: 'anchor' });
      }
    }
  }

  return broken;
}

export function formatBrokenLinks(links: BrokenLink[]): string {
  return [
    `${links.length} broken internal ${links.length === 1 ? 'link' : 'links'}:`,
    ...links.map(
      (link) => `  ${link.page} → ${link.href}${link.kind === 'anchor' ? ' (no such anchor)' : ''}`,
    ),
  ].join('\n');
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unescape(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
