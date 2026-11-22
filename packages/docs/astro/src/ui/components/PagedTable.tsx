/** @jsxImportSource react */
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RouterProvider } from 'react-aria-components';
import type { ColumnProps } from 'react-aria-components';
import { Button } from '#ui/components/ui/button.tsx';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '#ui/components/ui/pagination.tsx';
import { TableHead } from '#ui/components/ui/table.tsx';
import { pageList } from '../lib/paging';

/** A column a reader can sort by; the arrow says which way it runs. */
export function SortableHead({ children, ...props }: ColumnProps & { children: ReactNode }) {
  return (
    <TableHead allowsSorting {...props}>
      {({ sortDirection }) => (
        <span className="inline-flex items-center gap-1">
          {children}
          {sortDirection === 'ascending' ? (
            <ArrowUpIcon className="size-3" aria-hidden="true" />
          ) : sortDirection === 'descending' ? (
            <ArrowDownIcon className="size-3" aria-hidden="true" />
          ) : (
            <ChevronsUpDownIcon className="size-3 text-muted-foreground" aria-hidden="true" />
          )}
        </span>
      )}
    </TableHead>
  );
}

/** Opens a row's details below it; the chevron turns as it opens. */
export function ExpandButton({
  expanded,
  label,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-expanded={expanded}
      aria-label={`Details of ${label}`}
      onPress={onToggle}
    >
      <ChevronRightIcon className="transition-transform group-aria-expanded/button:rotate-90" />
    </Button>
  );
}

/**
 * Previous, the page numbers and next. Each is a real link to `?page=n`, so
 * one opens in a new tab; a plain click turns the page in place.
 */
export function TablePager({
  page,
  pages,
  hrefOf,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  hrefOf: (page: number) => string;
  onPage: (page: number) => void;
  label: string;
}) {
  if (pages <= 1) {
    return null;
  }

  const navigate = (href: string) => {
    history.replaceState(history.state, '', href);
    onPage(Number(new URLSearchParams(href.split('?')[1]).get('page') ?? 1));
  };

  return (
    <RouterProvider navigate={navigate}>
      <Pagination aria-label={label}>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href={hrefOf(page - 1)} isDisabled={page === 1} />
          </PaginationItem>
          {pageList(page, pages).map((candidate, index) => (
            <PaginationItem key={candidate ?? `gap-${index}`}>
              {candidate === null ? (
                <PaginationEllipsis />
              ) : (
                <PaginationLink
                  href={hrefOf(candidate)}
                  isActive={candidate === page}
                  aria-label={`Page ${candidate}`}
                >
                  {candidate}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext href={hrefOf(page + 1)} isDisabled={page === pages} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </RouterProvider>
  );
}
