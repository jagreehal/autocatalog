import { describe, expect, it } from 'vitest';
import { pageList, pageOf, rangeLabel, readSort, sortRows, writeSort } from '../src/ui/lib/paging';

describe('paging a long table', () => {
  it('reads a page number from the address as the nearest whole page', () => {
    const rows = Array.from({ length: 60 }, (_, n) => n);

    expect(pageOf(rows, 1.5)).toMatchObject({ page: 1, rows: rows.slice(0, 25) });
    expect(pageOf(rows, Number('x')).page).toBe(1);
    expect(pageOf(rows, 99).page).toBe(3);
  });

  it('writes a sort into the address and reads it back, leaving the default unwritten', () => {
    const byName = { column: 'name', direction: 'ascending' } as const;
    const params = new URLSearchParams();

    writeSort(params, byName, byName);
    expect(params.toString()).toBe('');

    writeSort(params, { column: 'owner', direction: 'descending' }, byName);
    expect(params.toString()).toBe('sort=owner&dir=desc');
    expect(readSort(params, ['name', 'owner'], byName)).toEqual({
      column: 'owner',
      direction: 'descending',
    });
    // A column the table does not have is the default.
    expect(readSort(new URLSearchParams('sort=nope'), ['name'], byName)).toBe(byName);
  });

  it('offers the first, the last and the neighbours of the current page', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    // A gap of one page shows that page rather than an ellipsis.
    expect(pageList(3, 12)).toEqual([1, 2, 3, 4, null, 12]);
    expect(pageList(12, 12)).toEqual([1, null, 11, 12]);
  });

  it('shows the last page for a page past the end', () => {
    const rows = Array.from({ length: 30 }, (_, index) => index);

    expect(pageOf(rows, 9)).toEqual({ rows: rows.slice(25), page: 2, pages: 2 });
    expect(pageOf([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
  });

  it('counts every row on one page, and the range on many', () => {
    expect(rangeLabel(1, 3)).toBe('3');
    expect(rangeLabel(12, 282)).toBe('276 to 282 of 282');
  });

  it('sorts numbers as numbers, and puts an empty value last either way', () => {
    const rows = [{ v: 'item 10' }, { v: null }, { v: 'item 9' }];

    const value = (row: { v: string | null }) => row.v;

    expect(sortRows(rows, { column: 'v', direction: 'ascending' }, value)).toEqual([
      { v: 'item 9' },
      { v: 'item 10' },
      { v: null },
    ]);
    expect(sortRows(rows, { column: 'v', direction: 'descending' }, value)).toEqual([
      { v: 'item 10' },
      { v: 'item 9' },
      { v: null },
    ]);
  });
});
