/** @jsxImportSource react */
import { Item } from '#ui/components/ui/item.tsx';

/** An event's delivery promise, with maximum lateness already in words. */
export interface DeliveryView {
  guarantee?: 'at-least-once' | 'at-most-once' | 'exactly-once' | undefined;
  orderingKey?: string | undefined;
  idempotencyKey?: string | undefined;
  maxLateness?: string | undefined;
  /** The field a journey is traced by. */
  correlationKey?: string | undefined;
}

export interface DeliveryFactsProps {
  delivery?: DeliveryView | undefined;
}

// What each guarantee asks of a consumer, which is what a reader needs.
const GUARANTEE = {
  'at-least-once': 'At least once, so expect duplicates',
  'at-most-once': 'At most once, so an event can be lost',
  'exactly-once': 'Exactly once',
} as const;

/**
 * What a consumer may rely on about arrival, one promise a line: the
 * guarantee, the ordering and idempotency keys, and how late an event can be.
 * A row of the facts list, or nothing when the event makes no promise.
 */
export function DeliveryFacts({ delivery }: DeliveryFactsProps) {
  const { guarantee, orderingKey, idempotencyKey, maxLateness, correlationKey } = delivery ?? {};

  if (!guarantee && !orderingKey && !idempotencyKey && !maxLateness && !correlationKey) return null;

  return (
    <Item size="xs" className="items-start">
      <dt className="w-32 text-muted-foreground">Delivery</dt>
      <dd className="m-0 min-w-0 flex-1 break-words">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {guarantee && <li>{GUARANTEE[guarantee]}</li>}
          {orderingKey && (
            <li>
              In order by <code>{orderingKey}</code>
            </li>
          )}
          {idempotencyKey && (
            <li>
              Repeats share <code>{idempotencyKey}</code>
            </li>
          )}
          {maxLateness && <li>Up to {maxLateness} late</li>}
          {correlationKey && (
            <li>
              Traced by <code>{correlationKey}</code>
            </li>
          )}
        </ul>
      </dd>
    </Item>
  );
}

export default DeliveryFacts;
