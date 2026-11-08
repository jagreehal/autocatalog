/**
 * Mirrors Starlight's `data-theme="dark"` onto a `.dark` class on `<html>`.
 * shadcn themes, and the apps they come from, write their dark tokens under
 * `.dark`; with the class kept in step, a brand's `theme.css` copied from one
 * of them works as it is, beside the `[data-theme='dark']` this site writes.
 */
export const DARK_CLASS_SCRIPT = `
(() => {
  const root = document.documentElement;
  const sync = () => root.classList.toggle('dark', root.dataset.theme === 'dark');
  sync();
  new MutationObserver(sync).observe(root, { attributeFilter: ['data-theme'] });
})();
`;
