import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { icons, type IconName } from './icons';

/** The attributes that draw a sidebar link's icon: a type, so Starlight's attribute record takes it. */
export type SidebarIconAttrs = {
  'data-icon': IconName;
  style: string;
};

/**
 * A sidebar link's icon, as attributes Starlight puts on the link: the Lucide
 * icon as an SVG the stylesheet paints in the link's own colour, so it follows
 * hover, the current page and the theme. Rendered at build time, so no icon
 * code reaches the browser.
 */
export function sidebarIconAttrs(name: IconName): SidebarIconAttrs {
  const svg = renderToStaticMarkup(createElement(icons[name], { 'aria-hidden': true }));

  return {
    'data-icon': name,
    style: `--ac-icon: url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
  };
}
