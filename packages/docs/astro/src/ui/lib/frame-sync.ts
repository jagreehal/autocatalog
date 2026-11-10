/**
 * Keeps a framed API reference in step with the page around it: the same
 * theme, tokens and fonts, so a brand's `theme.css` reaches into the frame,
 * and the reader's place in the reference in the page's own address, so a
 * link to an operation can be shared and the back button walks through them.
 */

// The site's tokens the reference is themed from (ApiPage's SCALAR_THEME).
const TOKENS = [
  '--font-sans',
  '--font-mono',
  '--radius',
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--secondary',
  '--primary',
  '--primary-foreground',
  '--border',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-border',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
];

/** The framing page's document, when there is one this page may read. */
function framingDocument(): Document | undefined {
  if (window.parent === window) return undefined;

  try {
    return window.parent.document;
  } catch {
    // Framed by another origin: it keeps its own theme, and this page its own.
    return undefined;
  }
}

/** The framing page's `@font-face` rules, so a brand's own font draws here too. */
function fontFaces(outer: Document): string {
  const rules: string[] = [];

  for (const sheet of outer.styleSheets) {
    let list: CSSRuleList;

    try {
      list = sheet.cssRules;
    } catch {
      // A stylesheet from another origin cannot be read; its fonts stay there.
      continue;
    }

    for (const rule of list) if (rule.cssText.startsWith('@font-face')) rules.push(rule.cssText);
  }

  return rules.join('\n');
}

export function followFramingPage(): void {
  const outer = framingDocument();

  if (!outer) return;

  const root = document.documentElement;

  const copyTheme = () => {
    // The reference follows this page's theme (ApiPage), as on the site itself.
    root.dataset.theme = outer.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

    const styles = getComputedStyle(outer.documentElement);

    for (const token of TOKENS) {
      const value = styles.getPropertyValue(token).trim();

      if (value) root.style.setProperty(token, value);
    }
  };

  copyTheme();
  new MutationObserver(copyTheme).observe(outer.documentElement, {
    attributeFilter: ['data-theme', 'style', 'class'],
  });

  document.head.append(
    Object.assign(document.createElement('style'), { textContent: fontFaces(outer) }),
  );

  // Scalar moves through the reference with replaceState, which fires no event:
  // each move is passed on to the framing page's address as it happens.
  const report = () => {
    const url = new URL(window.parent.location.href);

    if (url.hash === location.hash) return;

    url.hash = location.hash;
    window.parent.history.replaceState(window.parent.history.state, '', url);
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);

    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      report();
    };
  }

  addEventListener('hashchange', report);
}
