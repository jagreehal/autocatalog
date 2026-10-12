/** @jsxImportSource react */
import { type IconName, icons } from '../../icons';

export interface IconProps {
  name: IconName;
  className?: string;
}

/** Decoration only: whatever the icon means is said in text beside it. */
export function Icon({ name, className }: IconProps) {
  const Glyph = icons[name];

  return <Glyph className={className} aria-hidden="true" />;
}

export default Icon;
