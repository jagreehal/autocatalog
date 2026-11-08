/** @jsxImportSource react */
import { SearchIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '#ui/components/ui/input-group.tsx';

export interface SiteSearchProps {
  /** The search page: `/search` under the site's base. */
  action: string;
  label: string;
  query?: string | undefined;
}

/**
 * The header's search on a site that renders per request, where Pagefind has
 * no pages to index: a plain form, so it needs no script and the server
 * answers with what this reader may open.
 */
export function SiteSearch({ action, label, query }: SiteSearchProps) {
  return (
    <form method="get" action={action} role="search" className="w-full max-w-sm">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          name="q"
          aria-label={label}
          placeholder={label}
          defaultValue={query}
          autoComplete="off"
        />
      </InputGroup>
    </form>
  );
}
