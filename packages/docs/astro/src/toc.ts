/** A table-of-contents entry as Starlight's route data has it. */
export interface TocEntry {
  depth: number;
  slug: string;
  text: string;
  children: TocEntry[];
}

/**
 * The contents without a page's own first heading when it says what
 * Starlight's first entry already does: a page that opens with
 * `## Overview` lists "Overview" once. Starlight's entry stays, since it is the
 * one that goes back to the top.
 */
export function withoutRepeatedOverview<Entry extends TocEntry>(items: Entry[]): Entry[] {
  const [top, first, ...rest] = items;

  if (top?.slug !== '_top' || !first) return items;

  if (first.text.trim().toLowerCase() !== top.text.trim().toLowerCase()) return items;

  // Its subheadings keep their place, one level up.
  // SAFETY: an entry's children are entries of the same contents, so of the same type.
  return [top, ...(first.children as Entry[]), ...rest];
}
