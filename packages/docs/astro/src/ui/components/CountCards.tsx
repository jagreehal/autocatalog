/** @jsxImportSource react */
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import { kindIcon } from '../../icons';
import { Icon } from './Icon';
import type { Stat } from './Stats';

export interface CountCardsProps {
  items: Stat[];
  /** What a screen reader calls the row. */
  label?: string;
}

// A card has room for six digits; a count past that reads as 1.3M, its exact
// number a hover away. The row follows the room it is given, not the window:
// two, three, or six across, so six cards always fill whole rows.
// Compact in the form a dashboard writes it, 1.3M, whatever the page's locale.
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const count = (value: number) =>
  value >= 100_000 ? compact.format(value) : value.toLocaleString('en-GB');

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the catalog holds, a card per kind: its name and icon, the count, and
 * the whole card a link to the list when there is one. A kind with none has
 * no card.
 */
export function CountCards({ items, label = 'What the catalog holds' }: CountCardsProps) {
  const shown = items.filter(({ value }) => value > 0);

  if (shown.length === 0) return null;

  return (
    <div className="not-content @container">
      <ul
        aria-label={label}
        className="not-content m-0 grid list-none grid-cols-2 gap-4 p-0 @xl:grid-cols-3 @5xl:grid-cols-6"
      >
        {shown.map((item) => {
          const card = (
            <Card size="sm" className="h-full">
              <CardHeader>
                <CardDescription>
                  <span className="wrap-break-word group-hover:underline group-hover:underline-offset-4">
                    {sentenceCase(item.label)}
                  </span>
                </CardDescription>
                <CardTitle>
                  <span
                    className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl"
                    title={item.value.toLocaleString('en-GB')}
                  >
                    {count(item.value)}
                  </span>
                </CardTitle>
                {item.kind && (
                  <CardAction>
                    <span className="text-muted-foreground">
                      <Icon name={kindIcon(item.kind)} />
                    </span>
                  </CardAction>
                )}
              </CardHeader>
            </Card>
          );

          return (
            <li key={item.label}>
              {item.href ? (
                <a
                  href={item.href}
                  className="group block h-full rounded-xl no-underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {card}
                </a>
              ) : (
                card
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CountCards;
