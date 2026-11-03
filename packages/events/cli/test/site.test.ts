import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSite } from '../src/commands/site';

const base = { root: '.', cache: '.autocatalog/repos', out: 'dist', dev: false };

describe('ac site arguments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a topic without an owner, and says why', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, topic: 'catalog' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--topic and --owner go together/);
  });

  it('refuses EventCatalog diagrams in dev mode, which only a build draws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, dev: true, eventcatalog: true })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--eventcatalog/);
  });

  it('refuses a docs contract that is not there, before building anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, docsSchema: 'nowhere/docs-frontmatter.json' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--docs-schema.*nowhere\/docs-frontmatter\.json/);
  });

  it('refuses an owner without a topic', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, owner: 'acme' })).toBe(1);
  });

  it('stops when no enrolled repository could be cloned, and names each one', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-site-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const code = await runSite({
        ...base,
        cache: path.join(work, 'repos'),
        repos: [path.join(work, 'payments'), path.join(work, 'ledger')],
      });

      expect(code).toBe(1);
      expect(warn.mock.calls.join(' ')).toMatch(/Left out payments.*Left out ledger/s);
      expect(error.mock.calls.join(' ')).toMatch(/No repository could be cloned/);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('names a repository enrolled since the lock was written, when building the pins', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-site-'));
    const lock = path.join(work, 'autocatalog.lock.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await fs.writeFile(
      lock,
      JSON.stringify({
        spec: 'autocatalog/lock-v1',
        repositories: [
          {
            name: 'payments',
            url: `file://${path.join(work, 'payments')}`,
            commit: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            lockedAt: '2026-11-03T00:00:00Z',
          },
        ],
      }),
    );

    try {
      await runSite({
        ...base,
        lock,
        cache: path.join(work, 'repos'),
        repos: [`file://${path.join(work, 'payments')}`, `file://${path.join(work, 'ledger')}`],
      });

      const said = warn.mock.calls.join(' ');

      expect(said).toMatch(/Left out ledger: enrolled but not in autocatalog\.lock\.json/);
      expect(said).not.toMatch(/Left out payments: enrolled/);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('refuses two repositories that would clone into one folder, before cloning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runSite({
      ...base,
      cache: path.join(os.tmpdir(), 'ac-site-collision'),
      repos: ['https://github.com/acme/payments.git', 'https://github.com/other/payments.git'],
    });

    expect(code).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/would both clone into payments\//);
  });

  it('stops when the one repository enrolled twice could not be cloned', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-site-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const gone = path.join(work, 'payments');

      const code = await runSite({
        ...base,
        cache: path.join(work, 'repos'),
        repos: [gone, `${gone}.git`],
      });

      expect(code).toBe(1);
      expect(error.mock.calls.join(' ')).toMatch(/No repository could be cloned/);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});
