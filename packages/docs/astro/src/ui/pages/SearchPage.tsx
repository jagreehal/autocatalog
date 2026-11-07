/** @jsxImportSource react */
import { SearchXIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '#ui/components/ui/item.tsx';

export interface SearchPageProps {
  query: string;
  /** The query's words, marked wherever a result shows them. */
  words: string[];
  results: Array<{ title: string; href: string; excerpt: string }>;
  /** How many pages matched, of which `results` are the best. */
  total: number;
  /** Shown when nothing matches, such as a button that asks the assistant. */
  empty?: ReactNode;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text with each of the words in it marked. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) return text;

  // Longest first, so `payee` marks all of “Payee” when `pay` is asked too.
  const longest = [...words].sort((a, b) => b.length - a.length);

  const pattern = new RegExp(`(${longest.map(escape).join('|')})`, 'gi');

  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="bg-transparent font-semibold text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** What a search found among the pages this reader may open. */
export function SearchPage({ query, words, results, total, empty }: SearchPageProps) {
  if (!query) {
    return <p>Type in the search box at the top to find a page.</p>;
  }

  if (results.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing matches “{query}”</EmptyTitle>
            <EmptyDescription>Try fewer words, or other words for the same thing.</EmptyDescription>
          </EmptyHeader>
          {empty && <EmptyContent>{empty}</EmptyContent>}
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" role="status">
        {total === 1 ? '1 page' : `${total} pages`}
        {total > results.length && `, showing the best ${results.length}`}
      </p>
      <ItemGroup>
        {results.map((result) => (
          <Item key={result.href} href={result.href} variant="outline">
            <ItemContent>
              <ItemTitle>
                <span>
                  <Marked text={result.title} words={words} />
                </span>
              </ItemTitle>
              <ItemDescription>
                <Marked text={result.excerpt} words={words} />
              </ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}
