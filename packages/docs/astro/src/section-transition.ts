/**
 * Marks a move between sections, so the view transition slides the sidebar
 * (styles/index.css) instead of swapping it in place. Each page names its
 * section on `<html>` (route-middleware.ts); the page being left records its
 * own, and the page arriving compares. Runs in `<head>`, before the first paint.
 */
export const SECTION_TRANSITION_SCRIPT = `
(() => {
  const KEY = 'autocatalog-section';
  addEventListener('pageswap', (event) => {
    if (event.viewTransition) sessionStorage.setItem(KEY, document.documentElement.dataset.section ?? '');
  });
  addEventListener('pagereveal', (event) => {
    const from = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (event.viewTransition && from !== null && from !== (document.documentElement.dataset.section ?? '')) {
      event.viewTransition.types.add('ac-section');
    }
  });
})();
`;
