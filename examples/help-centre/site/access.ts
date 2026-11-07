// Who is reading. autocatalog does the rest: a guide opens when the reader's
// `access` holds everything its frontmatter's `access:` lists, and the pages,
// sidebar, home page and assistant all follow that one rule.
import type { SiteAccess } from 'autocatalog-docs-astro';
import { findReader, type Reader, readers } from './readers.ts';

export default {
  reader: ({ cookies }) => findReader(cookies.get('reader')?.value),
  // The build prints what each opens, and `ac site dev` can view the site as each.
  readers: Object.fromEntries(readers.map((reader) => [reader.name, reader])),
} satisfies SiteAccess<Reader>;
