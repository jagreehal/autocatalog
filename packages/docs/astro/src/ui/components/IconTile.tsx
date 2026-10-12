/** @jsxImportSource react */
import type { IconName } from '../../icons';
import { Icon } from './Icon';

export interface IconTileProps {
  name: IconName;
  /** `md` heads a card; `sm` leads a row. */
  size?: 'sm' | 'md';
}

const box = {
  sm: 'size-8 rounded-md',
  md: 'size-10 rounded-lg',
} as const;

/**
 * The one icon treatment (DESIGN.md): the icon on a tile tinted with the
 * accent, the same in every row and card. The accent is the same for every
 * kind; the icon says the kind.
 */
export function IconTile({ name, size = 'sm' }: IconTileProps) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-primary/10 text-primary ${box[size]}`}
      aria-hidden="true"
    >
      <Icon name={name} className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}

export default IconTile;
