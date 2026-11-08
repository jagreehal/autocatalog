import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const searchRequest = (query: string) =>
  new Request('https://docs.example.com/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search_docs', arguments: { query } },
    }),
  });

it('answers each reader from the documents that reader may open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-route-'));

  try {
    await fs.mkdir(path.join(root, 'help/docs'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'help/docs/open.md'),
      '---\ntitle: Refunds open\nowner: support\n---\n\nRefunds take five days.\n',
    );
    await fs.writeFile(
      path.join(root, 'help/docs/paid.md'),
      '---\ntitle: Refunds paid\nowner: support\naccess: [payments]\n---\n\nRefunds for payments staff.\n',
    );

    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);
    vi.stubEnv('AUTOCATALOG_SITE_ACCESS', JSON.stringify({ module: 'site/access.ts' }));
    vi.stubEnv('AUTOCATALOG_DOCS_OPEN', JSON.stringify(['help/open']));

    const { serveMcp, notAllowed } = await import('../src/pages/mcp');
    const { readerView } = await import('../src/reader-view');

    const search = async () => {
      const response = await serveMcp(searchRequest('refunds'));

      return JSON.stringify(await response.json());
    };

    const signedOut = await search();

    expect(signedOut).toContain('Refunds open');
    expect(signedOut).not.toContain('Refunds paid');
    expect(await readerView.run(() => true, search)).toContain('Refunds paid');

    const stream = notAllowed();

    expect(stream.status).toBe(405);
    expect(stream.headers.get('allow')).toBe('POST, OPTIONS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
