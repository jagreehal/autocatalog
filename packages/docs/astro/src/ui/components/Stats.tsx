/** @jsxImportSource react */
import { Fragment } from 'react';

/** A count, linked when it has somewhere to go. */
export interface Stat {
  label: string;
  value: number;
  href?: string;
}

export interface StatsProps {
  items: Stat[];
  /** Names the counts for assistive technology; they are said, not titled. */
  label?: string;
}

/** ", " between counts and " and " before the last, as a sentence lists things. */
const joiner = (index: number, length: number) => {
  if (index === 0) return '';

  return index === length - 1 ? ' and ' : ', ';
};

/**
 * Counts said in a sentence ("12 events, 5 services and 2 agents."), not shown
 * as tiles: DESIGN.md. A count with somewhere to go is a link in the sentence.
 */
export function Stats({ items, label }: StatsProps) {
  if (items.length === 0) return null;

  return (
    <div role="group" aria-label={label} className="not-content my-6 text-sm text-muted-foreground">
      {items.map((item, index) => {
        // A linked count is one link, number and noun, in the link's colour.
        const count = (
          <>
            <span className={item.href ? 'font-medium' : 'font-medium text-foreground'}>
              {item.value}
            </span>{' '}
            {item.label.toLowerCase()}
          </>
        );

        return (
          <Fragment key={item.label}>
            {joiner(index, items.length)}
            {item.href ? (
              <a href={item.href} className="text-primary underline underline-offset-4">
                {count}
              </a>
            ) : (
              count
            )}
          </Fragment>
        );
      })}
      .
    </div>
  );
}

export default Stats;
