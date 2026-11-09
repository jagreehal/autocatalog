/** @jsxImportSource react */
import { isIcon } from '../../icons';
import type { NavLinkView } from '../../nav';
import { Icon } from '../components/Icon';

export interface SectionRailProps {
  /** The site's sections, as `navLinks` reads them for this page. */
  links: NavLinkView[];
}

/**
 * The site's sections as a slim rail beside the sidebar: an icon each, named
 * in a tooltip on hover and focus, the current one highlighted. Plain links
 * and CSS, so it needs no script; the sidebar beside it is headed with the
 * current section's name.
 */
export function SectionRail({ links }: SectionRailProps) {
  if (links.length === 0) return null;

  return (
    <nav aria-label="Sections" data-icon-rail="">
      <ul className="m-0 flex list-none flex-col items-center gap-1 px-0 py-2">
        {links.map((link) => (
          <li key={`${link.label} ${link.href}`} className="group relative">
            <a
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
              rel={link.external ? 'external noopener' : undefined}
              className="grid size-9 place-items-center rounded-md text-muted-foreground no-underline transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
            >
              <Icon name={link.icon && isIcon(link.icon) ? link.icon : 'doc'} className="size-4" />
              {/* Its name: read by a screen reader, shown as a tooltip on hover and focus. */}
              <span className="pointer-events-none absolute start-full top-1/2 z-10 ms-2 -translate-y-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-has-focus-visible:opacity-100">
                {link.label}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default SectionRail;
