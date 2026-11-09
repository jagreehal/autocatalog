import { unified } from '@astrojs/markdown-remark';
import { satteri } from '@astrojs/markdown-satteri';
import { describe, expect, it, vi } from 'vitest';
import { registerMarkdownPlugins } from '../src/markdown-plugins';

const DOC = `# Writing docs

Read [[service|orders]] first.

| A | B |
| - | - |
| 1 | 2 |

\`\`\`mermaid
flowchart LR
  a --> b
\`\`\`
`;

const logger = { warn: vi.fn() };

const engines = {
  satteri: () => satteri(),
  unified: () => unified(),
};

describe.each(Object.entries(engines))('on %s', (_name, make) => {
  const render = async (title: string) => {
    const processor = make();

    registerMarkdownPlugins(processor, '/docs/', logger);

    const renderer = await processor.createRenderer({ syntaxHighlight: false });

    return (await renderer.render(DOC, { frontmatter: { title } })).code;
  };

  it('drops an opening heading that repeats the title, and keeps one that does not', async () => {
    expect(await render('Writing docs')).not.toContain('<h1');
    expect(await render('Something else')).toContain('<h1');
  });

  const renderOwn = async (markdown: string, title: string) => {
    const processor = make();

    registerMarkdownPlugins(processor, '/docs/', logger);

    const renderer = await processor.createRenderer({ syntaxHighlight: false });

    return (await renderer.render(markdown, { frontmatter: { title } })).code;
  };

  it('drops the repeated title after a leading comment', async () => {
    expect(await renderOwn('<!-- generated -->\n\n# Runbook\n\nBody', 'Runbook')).not.toContain(
      '<h1',
    );
  });

  it('leaves a wiki ref inside a link as written', async () => {
    const html = await renderOwn('[**see [[service|orders]]**](/x)', 'Other');

    expect(html).not.toContain('/docs/services/orders/');
    expect(html).toContain('[[service|orders]]');
  });

  it('turns a wiki ref into a catalog link, a mermaid fence into a diagram, and focuses tables', async () => {
    const html = await render('Writing docs');

    expect(html).toMatch(/<a[^>]*href="\/docs\/services\/orders\/"[^>]*>orders<\/a>/);
    expect(html).toContain('data-wiki-ref="service"');
    expect(html).toContain('<pre class="mermaid not-content">');
    expect(html).toMatch(/<table[^>]*tabindex="0"/);
  });
});

it('says so when the site renders with an engine it cannot join', () => {
  const warn = vi.fn();

  registerMarkdownPlugins({ name: 'other', options: {} }, '/', { warn });

  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"other"'));
});
