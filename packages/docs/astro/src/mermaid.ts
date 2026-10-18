/** The bits of mdast this walk touches. Typing the whole tree would need a dep. */
interface Node {
  type: string;
  lang?: string | null;
  value?: string;
  children?: Node[];
}

/**
 * Turn each ```mermaid fence into `<pre class="mermaid">` holding its source,
 * which the script below draws in the browser.
 *
 * A remark step rather than a rehype one, so the fence skips the code
 * highlighter: what arrives in the page is the diagram's source as text, and a
 * reader without JavaScript still sees it as written. The `.md` twins publish
 * the body as authored, so they keep the fence.
 */
export function remarkMermaid() {
  return (tree: Node) => {
    walk(tree);
  };
}

function walk(node: Node): void {
  for (const [i, child] of (node.children ?? []).entries()) {
    if (child.type === 'code' && child.lang === 'mermaid') {
      // Raw HTML, because a text node would lose each line's indentation,
      // which some diagrams (a mindmap) are drawn from.
      node.children![i] = {
        type: 'html',
        value: `<pre class="mermaid not-content">${escape(child.value ?? '')}</pre>`,
      };
    } else {
      walk(child);
    }
  }
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pinned, so a page draws the same diagram tomorrow as it did today. */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';

/**
 * Draws every `pre.mermaid` on the page, and draws them again when the theme
 * changes. Loads Mermaid only on a page that has a diagram.
 */
export const MERMAID_SCRIPT = `
const nodes = [...document.querySelectorAll('pre.mermaid')];
if (nodes.length > 0) {
  const sources = nodes.map((node) => node.textContent);
  const { default: mermaid } = await import(${JSON.stringify(MERMAID_URL)});
  const draw = async () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'neutral',
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    nodes.forEach((node, i) => {
      node.removeAttribute('data-processed');
      node.textContent = sources[i];
    });
    await mermaid.run({ nodes, suppressErrors: true });
  };
  await draw();
  new MutationObserver(draw).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
`;
