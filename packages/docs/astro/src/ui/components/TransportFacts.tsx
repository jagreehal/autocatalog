/** @jsxImportSource react */
import { Item } from '#ui/components/ui/item.tsx';

export interface TransportEntry {
  address?: string | undefined;
  protocols: string[];
  deliveryMode?: string | undefined;
}

export interface TransportFactsProps {
  transport?: TransportEntry[] | undefined;
}

/** "kafka and amqp, at-least-once delivery": how one channel carries the event. */
function carriage({ protocols, deliveryMode }: TransportEntry): string {
  const over =
    protocols.length > 1
      ? `${protocols.slice(0, -1).join(', ')} and ${protocols.at(-1)}`
      : (protocols[0] ?? '');

  const delivery = deliveryMode ? `${deliveryMode} delivery` : '';

  return over && delivery ? `${over}, ${delivery}` : over || delivery;
}

/**
 * Where an event travels, as the spec it came from declares: the topic or
 * channel address, its protocols and delivery mode, one channel a line. A row
 * of the facts list, or nothing when no spec said.
 */
export function TransportFacts({ transport = [] }: TransportFactsProps) {
  if (transport.length === 0) return null;

  return (
    <Item size="xs" className="items-start">
      <dt className="w-32 text-muted-foreground">Travels on</dt>
      <dd className="m-0 min-w-0 flex-1 break-words">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {transport.map((entry, i) => {
            const how = carriage(entry);

            return (
              <li key={`${entry.address ?? ''}|${entry.protocols.join(',')}|${i}`}>
                {entry.address && <code>{entry.address}</code>}
                {entry.address && how && ' '}
                {how && <span className="text-muted-foreground">{how}</span>}
              </li>
            );
          })}
        </ul>
      </dd>
    </Item>
  );
}

export default TransportFacts;
