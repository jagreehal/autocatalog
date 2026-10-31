/**
 * Strip site chrome when a page is framed elsewhere (`?embed=1`). Sets
 * `data-embed` on `<html>` so CSS can hide the header, sidebar and footer.
 */

/** True when the query asks for an embeddable view. */
export function embedFromSearch(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get('embed');

  return value === '1' || value === 'true';
}

/**
 * Runs in the document head before paint: reads `?embed=` and stamps the flag
 * so the first frame already hides chrome.
 */
export const EMBED_SCRIPT = `
(() => {
  const params = new URLSearchParams(location.search);
  const value = params.get('embed');
  if (value === '1' || value === 'true') document.documentElement.dataset.embed = '1';
})();
`;
