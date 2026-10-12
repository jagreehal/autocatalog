import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rehypeDocsBase } from '../src/links';

const tree = () => ({
  type: 'root',
  children: [
    { tagName: 'a', properties: { href: '/payments-service/runbook' } },
    { tagName: 'a', properties: { href: 'https://example.test/x' } },
    { tagName: 'a', properties: { href: '//example.test/x' } },
    { tagName: 'a', properties: { href: '#symptoms' } },
    { tagName: 'a', properties: { href: './replay' } },
    { tagName: 'a', properties: { href: '/docs/already-based' } },
    {
      tagName: 'p',
      children: [{ tagName: 'img', properties: { src: '/payments-service/capture.png' } }],
    },
  ],
});

const hrefs = (root: ReturnType<typeof tree>): unknown[] =>
  root.children.flatMap((node) =>
    node.children ? node.children.map((child) => child.properties.src) : [node.properties.href],
  );

describe('rehypeDocsBase', () => {
  it('prefixes root-relative links and images, and nothing else', () => {
    const root = tree();
    rehypeDocsBase('/docs')()(root, {});

    expect(hrefs(root)).toEqual([
      '/docs/payments-service/runbook',
      'https://example.test/x',
      '//example.test/x',
      '#symptoms',
      './replay',
      // Already under the base: rewriting again would produce /docs/docs/...
      '/docs/already-based',
      '/docs/payments-service/capture.png',
    ]);
  });

  it('leaves every link alone when the site is served from the root', () => {
    const root = tree();
    rehypeDocsBase('/')()(root, {});
    expect(hrefs(root)[0]).toBe('/payments-service/runbook');
  });
});

describe('rehypeDocsBase on links written for GitHub', () => {
  afterEach(() => vi.unstubAllEnvs());

  // Two sibling repositories, each linking the way a file on GitHub would.
  const aggregate = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-links-'));

    for (const file of [
      'payments/docs/team.md',
      'payments/docs/runbook.md',
      'payments/docs/guides/replay.md',
      'reporter/docs/team.md',
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), '# x\n');
    }

    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);

    return root;
  };

  const render = (base: string, from: string, links: string[]) => {
    const tree = { children: links.map((href) => ({ tagName: 'a', properties: { href } })) };
    rehypeDocsBase(base)()(tree, { path: from });

    return tree.children.map((node) => node.properties.href);
  };

  it('points a relative link to a document at its page, under the base', () => {
    const root = aggregate();

    expect(
      render('/docs', path.join(root, 'payments/docs/guides/replay.md'), [
        '../runbook.md#symptoms',
        '../team.md',
      ]),
    ).toEqual(['/docs/payments/runbook#symptoms', '/docs/payments/team']);

    expect(render('/', path.join(root, 'payments/docs/team.md'), ['guides/replay.md'])).toEqual([
      '/payments/guides/replay',
    ]);
  });

  it('leaves a missing file and another repository for the checks to report', () => {
    const root = aggregate();

    expect(
      render('/', path.join(root, 'payments/docs/team.md'), [
        'missing.md',
        '../../reporter/docs/team.md',
        'https://example.test/x.md',
      ]),
    ).toEqual(['missing.md', '../../reporter/docs/team.md', 'https://example.test/x.md']);
  });
});
