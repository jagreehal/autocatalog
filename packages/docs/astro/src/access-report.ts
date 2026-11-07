import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Doc } from 'autocatalog-docs-core';
import { z } from 'zod';
import { accessRule, SIGNED_OUT, type SiteAccess } from './access';
import { docPage } from './ui/lib/docs';

const moduleSchema = z.object({
  default: z.custom<SiteAccess<unknown>>(
    (value) => z.object({ reader: z.function() }).safeParse(value).success,
    'must default-export { reader, canRead?, readers? }',
  ),
});

/**
 * The site's access module, so the build can try its rule. Call it while
 * Astro loads its config, as `astro.config.mjs` does, so a TypeScript module
 * loads as the site's other code does: Astro's loader has closed by the time
 * the plugin runs.
 */
export async function loadSiteAccess(file: string): Promise<SiteAccess<unknown>> {
  const parsed = moduleSchema.safeParse(
    // The site's own module, named at build time; nothing for Vite to bundle.
    await import(/* @vite-ignore */ pathToFileURL(file).href),
  );

  if (!parsed.success) throw new Error(`access.module ${file}: ${z.prettifyError(parsed.error)}`);

  return parsed.data.default;
}

/** Which documents each sample reader may open: `opens[i]` is `readers[i]`. */
export interface AccessTable {
  readers: string[];
  rows: Array<{ id: string; opens: boolean[] }>;
}

/** Which documents each sample reader may open, signed out first. */
export function accessTable(docs: readonly Doc[], access: SiteAccess<unknown>): AccessTable {
  const readers: Array<[string, unknown]> = [
    [SIGNED_OUT, undefined],
    ...Object.entries(access.readers ?? {}),
  ];

  const rules = readers.map(([, reader]) => accessRule(access, reader));

  return {
    readers: readers.map(([name]) => name),
    rows: docs.map((doc) => ({ id: doc.id, opens: rules.map((canRead) => canRead(doc)) })),
  };
}

/** A table past this many documents prints as a count per reader. */
const TABLE_ROWS = 40;

/** The table as the build prints it: each document, or past a few dozen, how many each reader opens. */
export function formatAccessTable({ readers, rows }: AccessTable): string {
  if (rows.length > TABLE_ROWS) {
    return readers
      .map(
        (reader, i) =>
          `${reader}: ${rows.filter((row) => row.opens[i]).length} of ${rows.length} documents`,
      )
      .join('\n');
  }

  const width = Math.max(...rows.map((row) => row.id.length), 'document'.length);

  return [
    ['document'.padEnd(width), ...readers].join('  '),
    ...rows.map((row) =>
      [
        row.id.padEnd(width),
        ...row.opens.map((opens, i) => (opens ? 'opens' : '-').padEnd(readers[i]!.length)),
      ].join('  '),
    ),
  ].join('\n');
}

const RELATED = z.array(z.string()).catch([]);

/** The documents one links to, by `related` or by a Markdown link in its body. */
export function linkedDocs(doc: Doc, ids: ReadonlySet<string>): string[] {
  const byPage = new Map([...ids].map((id) => [docPage(id), id]));
  const folder = path.posix.dirname(doc.id);

  const targets = [...doc.body.matchAll(/\]\(([^)\s]+)/g)].flatMap(([, href]) => {
    if (!href || /^[a-z]+:|^#/.test(href)) return [];

    const page = href
      .split('#')[0]!
      .replace(/\.mdx?$/, '')
      .replace(/\/$/, '');

    const id = page.startsWith('/') ? page.slice(1) : path.posix.join(folder, page);

    return [ids.has(id) ? id : byPage.get(id)].filter((found) => found !== undefined);
  });

  return [...new Set([...RELATED.parse(doc.data.related), ...targets])].filter(
    (id) => id !== doc.id && ids.has(id),
  );
}

/** Each link a sample reader may follow to a document they may not open. */
export function closedLinks(docs: readonly Doc[], table: AccessTable): string[] {
  const opens = new Map(table.rows.map((row) => [row.id, row.opens]));
  const ids = new Set(docs.map((doc) => doc.id));

  return docs.flatMap((doc) =>
    linkedDocs(doc, ids).flatMap((target) => {
      const blocked = table.readers.filter(
        (_, i) => opens.get(doc.id)?.[i] && !opens.get(target)?.[i],
      );

      return blocked.length > 0
        ? [`${doc.id} links to ${target}, which ${blocked.join(', ')} may not open`]
        : [];
    }),
  );
}
