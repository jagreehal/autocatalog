import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// Each test imports the endpoint afresh and builds a catalog: under a full
// parallel run that cold start can take longer than the default five seconds.
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const toolRequest = (
  tool: string,
  args: Record<string, string>,
  origin?: string,
  url = 'https://docs.example.com/mcp',
) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(origin && { origin }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });

const searchRequest = (query: string, origin?: string) =>
  toolRequest('search_docs', { query }, origin);

/** Two guides, one open to everyone and one only for payments staff. */
async function helpCentre(root: string) {
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
}

it('answers each reader from the documents that reader may open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-route-'));

  try {
    await helpCentre(root);

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

it('refuses another origin unless the site is for an audience, which any origin may call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-origin-'));

  vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);
  vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', '');

  const { serveMcp } = await import('../src/pages/mcp');

  const refused = await serveMcp(searchRequest('refunds', 'https://elsewhere.example'));

  expect(refused.status).toBe(403);

  const own = await serveMcp(searchRequest('refunds', 'https://docs.example.com'));

  expect(own.status).toBe(200);
  expect(own.headers.get('access-control-allow-origin')).toBeNull();

  vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', 'public');

  const open = await serveMcp(searchRequest('refunds', 'https://elsewhere.example'));

  expect(open.status).toBe(200);
  expect(open.headers.get('access-control-allow-origin')).toBe('*');
  await fs.rm(root, { recursive: true, force: true });
});

it('takes the site’s own pages behind a proxy that ends TLS', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-proxy-'));

  vi.stubEnv('AUTOCATALOG_DOCS_ROOT', root);
  vi.stubEnv('AUTOCATALOG_SITE_AUDIENCE', '');

  const { serveMcp } = await import('../src/pages/mcp');

  // The browser is on https; the server sees the request as http.
  const proxied = toolRequest(
    'search_docs',
    { query: 'refunds' },
    'https://docs.example.com',
    'http://docs.example.com/mcp',
  );

  expect((await serveMcp(proxied.clone(), 'https://docs.example.com')).status).toBe(200);
  expect((await serveMcp(proxied, undefined)).status).toBe(403);
  await fs.rm(root, { recursive: true, force: true });
});

it('keeps readers apart when their requests arrive together', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-together-'));

  try {
    await helpCentre(root);

    const { serveMcp } = await import('../src/pages/mcp');
    const { readerView } = await import('../src/reader-view');

    const answer = async (tool: string, args: Record<string, string>) =>
      JSON.stringify(await (await serveMcp(toolRequest(tool, args))).json());

    const staff = () =>
      readerView.run(
        () => true,
        () => answer('search_docs', { query: 'refunds' }),
      );

    const visitor = () => answer('search_docs', { query: 'refunds' });
    const visitorReads = () => answer('read_page', { url: '/help/paid/' });

    // Interleaved, so one reader's request is in flight while the other's runs.
    const readers = [staff, visitor, visitorReads, staff, visitor, visitorReads];
    const answers = await Promise.all(readers.map((reader) => reader()));

    for (const [n, text] of answers.entries()) {
      if (readers[n] === staff) expect(text).toContain('Refunds paid');

      if (readers[n] === visitor) expect(text).not.toContain('Refunds paid');

      if (readers[n] === visitorReads) {
        expect(text).toContain('No page at /help/paid/');
        expect(text).not.toContain('Refunds for payments staff');
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it('answers a failure with a JSON-RPC error no cache keeps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-mcp-fails-'));

  try {
    const notAFolder = path.join(root, 'file');

    await fs.writeFile(notAFolder, '');
    vi.stubEnv('AUTOCATALOG_DOCS_ROOT', notAFolder);

    const { serveMcp } = await import('../src/pages/mcp');

    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failed = await serveMcp(searchRequest('refunds'));

    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('private, no-store');
    expect(await failed.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  } finally {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
});
