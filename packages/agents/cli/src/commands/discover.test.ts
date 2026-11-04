import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import kleur from 'kleur';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDiscover } from './discover.js';

let root: string;

kleur.enabled = false;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-discover-'));
  await fs.writeFile(
    path.join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } } }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const discover = async (...extra: string[]) => {
  let out = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);

    return true;
  });

  const exit = await runDiscover(['--from', 'mcp', root, '--root', root, ...extra]);
  vi.restoreAllMocks();

  return { exit, out };
};

const manifest = path.join('mcp-servers', 'linear-app', 'autocatalog.json');

describe('ac agents discover --from mcp', () => {
  it('writes a draft, then keeps a reviewer’s edits on the next run', async () => {
    const first = await discover();
    const file = path.join(root, manifest);

    expect(first.exit).toBe(0);
    expect(first.out).toContain('new linear-app');
    expect(first.out).toContain('Next: set owner and origin');

    const draft = JSON.parse(await fs.readFile(file, 'utf8'));

    expect(draft).toMatchObject({ owner: 'review-needed', transport: 'http' });

    await fs.writeFile(file, `${JSON.stringify({ ...draft, owner: 'platform' }, null, 2)}\n`);

    const second = await discover();

    expect(second.out).toContain('unchanged linear-app');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).owner).toBe('platform');
  });

  it('follows a server to its new address, keeping the review and its snapshots', async () => {
    await discover();

    const old = path.join(root, manifest);
    const draft = JSON.parse(await fs.readFile(old, 'utf8'));

    await fs.writeFile(old, JSON.stringify({ ...draft, owner: 'platform' }, null, 2));
    await fs.mkdir(path.join(path.dirname(old), 'snapshots'));
    await fs.writeFile(path.join(path.dirname(old), 'snapshots/default.json'), '{}');
    await fs.writeFile(
      path.join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { linear: { url: 'https://api.linear.dev/mcp' } } }),
    );

    const { out } = await discover();
    const moved = path.join(root, 'mcp-servers/api-linear-dev');

    expect(out).toContain('moved api-linear-dev');
    expect(out).toContain('from linear-app');
    await expect(fs.stat(old)).rejects.toThrow();
    expect(
      JSON.parse(await fs.readFile(path.join(moved, 'autocatalog.json'), 'utf8')),
    ).toMatchObject({ owner: 'platform', url: 'https://api.linear.dev/mcp' });
    await expect(fs.stat(path.join(moved, 'snapshots/default.json'))).resolves.toBeDefined();
  });

  it('never lets credentials follow a config to a new address', async () => {
    await discover();

    const old = path.join(root, manifest);
    const draft = JSON.parse(await fs.readFile(old, 'utf8'));

    await fs.writeFile(
      old,
      JSON.stringify({
        ...draft,
        owner: 'platform',
        snapshot: {
          connection: 'ci-bot',
          headers: { Authorization: 'Bearer ${LINEAR_TOKEN}' },
          env: { KEY: '${LINEAR_KEY}' },
        },
        discovery: { ...draft.discovery, confidence: 'reviewed', needs_review: [] },
      }),
    );
    await fs.writeFile(
      path.join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { linear: { url: 'https://evil.example/mcp' } } }),
    );

    const { out } = await discover();

    const moved = JSON.parse(
      await fs.readFile(path.join(root, 'mcp-servers/evil-example/autocatalog.json'), 'utf8'),
    );

    expect(out).toContain('snapshot credentials were removed');
    expect(moved.owner).toBe('platform');
    expect(moved.snapshot).toEqual({ connection: 'ci-bot' });
    expect(moved.discovery).toMatchObject({ confidence: 'inferred', needs_review: ['snapshot'] });
  });

  it('leaves credentials alone while the endpoint stays put', async () => {
    await discover();

    const file = path.join(root, manifest);
    const draft = JSON.parse(await fs.readFile(file, 'utf8'));
    const snapshot = { headers: { Authorization: 'Bearer ${LINEAR_TOKEN}' } };

    await fs.writeFile(file, `${JSON.stringify({ ...draft, snapshot }, null, 2)}\n`);

    const { out } = await discover();

    expect(out).toContain('unchanged linear-app');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).snapshot).toEqual(snapshot);
  });

  it('names a server no config mentions, and removes it only with --prune', async () => {
    await discover();
    await fs.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

    const kept = await discover();

    expect(kept.out).toContain('gone linear-app');
    await expect(fs.stat(path.join(root, manifest))).resolves.toBeDefined();

    const pruned = await discover('--prune');

    expect(pruned.out).toContain('removed linear-app');
    await expect(fs.stat(path.join(root, manifest))).rejects.toThrow();
  });

  it('never calls a hand-written entry gone', async () => {
    const dir = path.join(root, 'mcp-servers/ours');

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'autocatalog.json'),
      JSON.stringify({ name: 'Ours', owner: 'platform', transport: 'stdio' }),
    );

    const { out } = await discover('--prune');

    expect(out).not.toContain('ours');
    await expect(fs.stat(dir)).resolves.toBeDefined();
  });

  it('prints the inventory without writing on a dry run', async () => {
    const { out } = await discover('--dry-run');

    expect(out).toContain('mcp-server linear-app https://mcp.linear.app/mcp (.mcp.json)');
    await expect(fs.stat(path.join(root, 'mcp-servers'))).rejects.toThrow();
  });

  it('leaves a manifest it cannot read and carries on', async () => {
    const file = path.join(root, manifest);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ broken');

    const { exit, out } = await discover();

    expect(exit).toBe(0);
    expect(out).toContain('skip linear-app');
    expect(await fs.readFile(file, 'utf8')).toBe('{ broken');
  });
});
