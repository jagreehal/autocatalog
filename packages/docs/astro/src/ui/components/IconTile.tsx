/** @jsxImportSource react */
import type { IconName } from '../../icons';
import { kindTone } from '../lib/kind-tone';
import { Icon } from './Icon';

export interface IconTileProps {
  name: IconName;
  /** `md` heads a card; `sm` leads a row. */
  size?: 'sm' | 'md';
  /** The resource kind, for its hue; without one the tile keeps the accent. */
  kind?: string | undefined;
}

const box = {
  sm: 'size-8 rounded-md',
  md: 'size-10 rounded-lg',
} as const;

/**
 * The one icon treatment (DESIGN.md): the icon on a tinted tile, the same in
 * every row and card. A resource kind tints it with its own hue, so an event
 * reads apart from a service at a glance; the icon still says the kind.
 */
export function IconTile({ name, size = 'sm', kind }: IconTileProps) {
  return (
    <span
      className={`grid shrink-0 place-items-center ${kindTone(kind) ?? 'bg-primary/10 text-primary'} ${box[size]}`}
      aria-hidden="true"
    >
      <Icon name={name} className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}

export default IconTile;
