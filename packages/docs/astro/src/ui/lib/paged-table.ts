import { useCallback, useState } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import type { SortDescriptor } from 'react-aria-components';
import { useFieldValue } from './field';
import { readSort, writeSort } from './paging';

export interface PagedTable {
  query: string;
  setQuery: (query: string) => void;
  sort: SortDescriptor;
  page: number;
  setPage: (page: number) => void;
  /** The keys of the rows showing their details. */
  open: ReadonlySet<string>;
  expand: (key: string) => void;
  toggle: (key: string) => void;
  /** Spread onto the search input. */
  field: {
    ref: RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  };
  /** Spread onto the table. */
  sorting: { sortDescriptor: SortDescriptor; onSortChange: (next: SortDescriptor) => void };
  /** Takes the search, sort and page the address names; the sort is returned for use before it is drawn. */
  restore: (params: URLSearchParams) => SortDescriptor;
  /** A page's address, after any filters of the table's own in `params`. */
  hrefOf: (target: number, params?: URLSearchParams) => string;
}

/**
 * What a long table remembers: its search, sort, page and open rows. Searching
 * or sorting goes back to the first page. The address holds the first three, so
 * a pager link shows the same rows wherever it is opened.
 */
export function usePagedTable(
  columns: ReadonlyArray<string>,
  fallback: SortDescriptor,
): PagedTable {
  const { value: query, setValue: setQuery, field } = useFieldValue();

  const [sort, setSort] = useState(fallback);

  const [page, setPage] = useState(1);

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const restore = useCallback(
    (params: URLSearchParams) => {
      const sorted = readSort(params, columns, fallback);

      setQuery(params.get('q') ?? '');
      setSort(sorted);
      setPage(Number(params.get('page')) || 1);

      return sorted;
    },
    [columns, fallback, setQuery],
  );

  return {
    query,
    setQuery,
    sort,
    page,
    setPage,
    open,
    field: {
      ...field,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        field.onChange(event);
        setPage(1);
      },
    },
    sorting: {
      sortDescriptor: sort,
      onSortChange: (next: SortDescriptor) => {
        setSort(next);
        setPage(1);
      },
    },
    expand: (key: string) => setOpen((was) => new Set(was).add(key)),
    toggle: (key: string) =>
      setOpen((was) => {
        const next = new Set(was);

        if (!next.delete(key)) {
          next.add(key);
        }

        return next;
      }),
    restore,
    hrefOf: (target: number, params = new URLSearchParams()) => {
      if (query.trim()) {
        params.set('q', query.trim());
      }

      writeSort(params, sort, fallback);
      params.set('page', String(target));

      return `?${params}`;
    },
  };
}
