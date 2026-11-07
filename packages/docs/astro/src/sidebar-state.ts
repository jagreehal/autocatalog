/** What the sidebar controls write to localStorage, and the head script reads back. */
export const SIDEBAR_WIDTH_KEY = 'autocatalog-sidebar-width';

export const SIDEBAR_COLLAPSED_KEY = 'autocatalog-sidebar-collapsed';

/** rem; a stored width outside these is ignored. */
export const SIDEBAR_MIN_WIDTH = 12;

export const SIDEBAR_MAX_WIDTH = 28;

/**
 * Applies the reader's sidebar width and collapsed state before the first
 * paint. The controls are an island that hydrates after it, so without this a
 * collapsed sidebar opens and closes again on every page.
 */
export const SIDEBAR_SCRIPT = `
(() => {
  try {
    const root = document.documentElement;
    const width = Number(localStorage.getItem('${SIDEBAR_WIDTH_KEY}'));
    if (width >= ${SIDEBAR_MIN_WIDTH} && width <= ${SIDEBAR_MAX_WIDTH}) root.style.setProperty('--ac-sidebar-width', width + 'rem');
    root.dataset.sidebar = localStorage.getItem('${SIDEBAR_COLLAPSED_KEY}') === '1' ? 'collapsed' : 'open';
  } catch {}
})();
`;
