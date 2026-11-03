/** The bits of mdast this walk touches. Typing the whole tree would need a dep. */
interface Node {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  name?: string;
  attributes?: Array<{ type: 'mdxJsxAttribute'; name: string; value: string | null }>;
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
  return (tree: Node, file?: { path?: string }) => {
    walk(tree, file?.path?.endsWith('.mdx') === true);
  };
}

function walk(node: Node, mdx: boolean): void {
  for (const [i, child] of (node.children ?? []).entries()) {
    const player = child.type === 'code' && child.lang === 'mermaid' && playerAttributes(child);

    if (player) {
      node.children![i] = mdx
        ? {
            type: 'mdxJsxFlowElement',
            name: 'mermaid-flow-player',
            attributes: Object.entries(player).map(([name, value]) => ({
              type: 'mdxJsxAttribute',
              name,
              value,
            })),
            children: [{ type: 'text', value: child.value ?? '' }],
          }
        : {
            type: 'html',
            value: `<mermaid-flow-player ${Object.entries(player)
              .map(([name, value]) => (value === null ? name : `${name}="${value}"`))
              .join(' ')}>${escape(child.value ?? '')}</mermaid-flow-player>`,
          };
    } else if (child.type === 'code' && child.lang === 'mermaid') {
      // Raw HTML, because a text node would lose each line's indentation,
      // which some diagrams (a mindmap) are drawn from. MDX has no raw HTML,
      // and its JSX keeps a text child exactly as written.
      node.children![i] = mdx
        ? {
            type: 'mdxJsxFlowElement',
            name: 'pre',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'className', value: 'mermaid not-content' },
            ],
            children: [{ type: 'text', value: child.value ?? '' }],
          }
        : {
            type: 'html',
            value: `<pre class="mermaid not-content">${escape(child.value ?? '')}</pre>`,
          };
    } else {
      walk(child, mdx);
    }
  }
}

/**
 * A diagram that tells a story: `%% narrate` lines are read aloud as it plays,
 * and ```` ```mermaid interactive ```` lets the reader click through its branches.
 */
function playerAttributes({ meta, value }: Node): Record<string, string | null> | undefined {
  const narrated = value?.includes('%% narrate') === true;
  const interactive = /\binteractive\b/.test(meta ?? '');

  if (!narrated && !interactive) return undefined;

  return {
    class: 'not-content',
    controls: null,
    ...(interactive && { mode: 'interactive' }),
    ...(narrated && { speak: null }),
  };
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pinned, so a page draws the same diagram tomorrow as it did today. */
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';

/** Pinned for the same reason. It brings its own copy of Mermaid. */
export const PLAYER_URL =
  'https://cdn.jsdelivr.net/npm/mermaid-flow-player@2.2.0/mermaid-flow-player.element.js';

/**
 * Draws every `pre.mermaid` on the page, and draws them again when the theme
 * changes. Loads Mermaid only on a page that has a diagram.
 */
export const MERMAID_SCRIPT = `
if (document.querySelector('mermaid-flow-player')) {
  const player = document.createElement('script');
  player.src = ${JSON.stringify(PLAYER_URL)};
  document.head.append(player);
}
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
