import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { expect, it } from 'vitest';
import { MERMAID_SCRIPT, MERMAID_URL, remarkMermaid } from '../src/mermaid';

it('turns a mermaid fence into its source, indentation kept, and leaves other code alone', async () => {
  const processor = await createMarkdownProcessor({ remarkPlugins: [remarkMermaid] });

  const { code } = await processor.render(
    '```mermaid\ngraph LR\n  A --> B\n```\n\n```js\nconst a = 1;\n```\n',
  );

  expect(code).toContain('<pre class="mermaid not-content">graph LR\n  A --> B</pre>');
  expect(code).toContain('const');
  expect(code).not.toContain('language-mermaid');
});

it('loads an exact Mermaid version, and only on a page with a diagram', () => {
  expect(MERMAID_URL).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@\d+\.\d+\.\d+\//);
  expect(MERMAID_SCRIPT).toContain("document.querySelectorAll('pre.mermaid')");
  expect(MERMAID_SCRIPT.indexOf('nodes.length > 0')).toBeLessThan(
    MERMAID_SCRIPT.indexOf('import('),
  );
});
