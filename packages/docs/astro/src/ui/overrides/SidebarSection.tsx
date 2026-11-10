/** @jsxImportSource react */
import { isIcon } from '../../icons';
import { Icon } from '../components/Icon';

export interface SidebarSectionProps {
  /** The section's name, as the rail beside the sidebar names it. */
  label: string;
  icon?: string | undefined;
}

/**
 * The sidebar's heading: the section it holds, so when the sidebar changes
 * with the section, the reader sees which one they are in. Beside the rail
 * only; on a phone the sections lead the menu instead.
 */
export function SidebarSection({ label, icon }: SidebarSectionProps) {
  return (
    <p
      data-sidebar-section=""
      className="m-0 mb-2 flex items-center gap-2 border-b pb-3 text-sm font-semibold text-foreground"
    >
      <Icon name={icon && isIcon(icon) ? icon : 'doc'} className="size-4 text-muted-foreground" />
      {label}
    </p>
  );
}

export default SidebarSection;
