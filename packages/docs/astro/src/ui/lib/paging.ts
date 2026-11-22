import type { Key, SortDescriptor } from 'react-aria-components';

/** Rows on one page of a long table. */
export const PAGE_SIZE = 25;

export const pageCount = (total: number): number => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** One page of a long table: its rows, which page it is, and how many there are. */
export interface TablePage<T> {
  rows: Array<T>;
  page: number;
  pages: number;
}

/** The rows on a page, counted from 1; a page past the end shows the last one. */
export function pageOf<T>(rows: Array<T>, page: number): TablePage<T> {
  const pages = pageCount(rows.length);

  // A page from the address can be anything: `?page=1.5` or `?page=x` means the nearest whole page.
  const whole = Number.isFinite(page) ? Math.trunc(page) : 1;

  const current = Math.min(Math.max(1, whole), pages);

  return {
    rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
  };
}

/** The page a row sits on, given its position in the sorted, filtered list. */
export const pageOfIndex = (index: number): number => Math.floor(index / PAGE_SIZE) + 1;

/**
 * The pages a pager offers: the first, the last, and the current one with its
 * neighbours. `null` is a gap; a gap of one page shows that page instead.
 */
export function pageList(page: number, pages: number): Array<number | null> {
  const wanted = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((candidate) => candidate >= 1 && candidate <= pages)
    .sort((a, b) => a - b);

  return wanted.flatMap((candidate, index) => {
    const gap = index === 0 ? 0 : candidate - wanted[index - 1]!;

    if (gap === 2) {
      return [candidate - 1, candidate];
    }

    return gap > 2 ? [null, candidate] : [candidate];
  });
}

/** What the results count says: every row, or which of them this page holds. */
export function rangeLabel(page: number, total: number): string {
  if (total <= PAGE_SIZE) {
    return total.toLocaleString('en-GB');
  }

  const first = (page - 1) * PAGE_SIZE + 1;

  const last = Math.min(page * PAGE_SIZE, total);

  return `${first} to ${last} of ${total.toLocaleString('en-GB')}`;
}

/** Sorted by one column; an empty value sorts last whichever way the column runs. */
export function sortRows<T>(
  rows: Array<T>,
  { column, direction }: SortDescriptor,
  valueOf: (row: T, column: Key) => string | number | null,
): Array<T> {
  const sign = direction === 'descending' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = valueOf(a, column);

    const right = valueOf(b, column);

    if (left === right) {
      return 0;
    }

    if (left === null) {
      return 1;
    }

    if (right === null) {
      return -1;
    }

    // Numeric collation, so counts sort as numbers and "item 10" after "item 9".
    return sign * String(left).localeCompare(String(right), 'en', { numeric: true });
  });
}

/**
 * A table's sort in the address, `sort=owner&dir=desc`, so a pager link shows
 * the same rows wherever it is opened. The default sort writes nothing.
 */
export function writeSort(
  params: URLSearchParams,
  sort: SortDescriptor,
  fallback: SortDescriptor,
): void {
  if (sort.column === fallback.column && sort.direction === fallback.direction) {
    return;
  }

  params.set('sort', String(sort.column));
  params.set('dir', sort.direction === 'descending' ? 'desc' : 'asc');
}

/** The sort the address names, when it names one of these columns; the fallback otherwise. */
export function readSort(
  params: URLSearchParams,
  columns: ReadonlyArray<string>,
  fallback: SortDescriptor,
): SortDescriptor {
  const column = params.get('sort');

  if (column === null || !columns.includes(column)) {
    return fallback;
  }

  return { column, direction: params.get('dir') === 'desc' ? 'descending' : 'ascending' };
}
