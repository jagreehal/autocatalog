import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fetchRemoteJson } from '../src/commands/import';

// `127.0.0.1` and `localhost` are different hostnames that reach the same
// server, which is exactly what a redirect-based bypass looks like: an approved
// name pointing at an unapproved one.
const allowed = new Set(['127.0.0.1']);

let server: Server;

let port: number;

let secretHits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');

      return;
    }

    if (url === '/secret') {
      secretHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"secret":true}');

      return;
    }

    if (url === '/to-allowed') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
      res.end();

      return;
    }

    if (url === '/to-relative') {
      res.writeHead(302, { location: '/ok' });
      res.end();

      return;
    }

    if (url === '/to-other-host') {
      res.writeHead(302, { location: `http://localhost:${port}/secret` });
      res.end();

      return;
    }

    if (url === '/loop') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/loop` });
      res.end();

      return;
    }

    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = z.object({ port: z.number() }).parse(server.address()).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fetchFrom = (path: string) =>
  fetchRemoteJson(`http://127.0.0.1:${port}${path}`, 5000, 1_000_000, allowed);

describe('remote import redirects', () => {
  it('follows a redirect to an allowed host', async () => {
    const file = await fetchFrom('/to-allowed');
    expect(new TextDecoder().decode(file.bytes)).toBe('{"ok":true}');
    expect(file.source).toContain('/ok');
  });

  it('resolves a relative location against the hop it came from', async () => {
    const file = await fetchFrom('/to-relative');
    expect(new TextDecoder().decode(file.bytes)).toBe('{"ok":true}');
  });

  it('refuses a redirect to a host that is not allowed, without requesting it', async () => {
    secretHits = 0;
    await expect(fetchFrom('/to-other-host')).rejects.toThrow(/host not allowed: localhost/);
    // The point of checking before the hop rather than after: the unapproved
    // address must never be contacted at all.
    expect(secretHits).toBe(0);
  });

  it('gives up on a redirect loop', async () => {
    await expect(fetchFrom('/loop')).rejects.toThrow(/Too many redirects/);
  });
});
