/** Past forms that do not end in -ed. */
const IRREGULAR = new Set([
  'begun',
  'bought',
  'broken',
  'built',
  'chosen',
  'done',
  'drawn',
  'found',
  'frozen',
  'given',
  'held',
  'kept',
  'left',
  'lost',
  'made',
  'met',
  'paid',
  'sent',
  'sold',
  'spent',
  'taken',
  'thrown',
  'won',
  'written',
]);

/** Words that end in -ed and are not past forms. */
const NOT_PAST = new Set([
  'bed',
  'bleed',
  'breed',
  'embed',
  'feed',
  'hundred',
  'need',
  'red',
  'sacred',
  'seed',
  'shed',
  'speed',
]);

/** The words in an id or a name: `order.placed`, `OrderPlaced` and `Order placed` give the same. */
export const nameWords = (name: string): string[] =>
  name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * Whether a message's id or name says something happened: `order.placed`,
 * `PaymentSucceeded`, `invoice.sent`. A heuristic, so it only ever informs.
 */
export function readsAsPastTense(...names: string[]): boolean {
  return names
    .flatMap(nameWords)
    .some(
      (word) =>
        IRREGULAR.has(word) || (word.length > 3 && word.endsWith('ed') && !NOT_PAST.has(word)),
    );
}
