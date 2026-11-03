import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { readBrand, runSite, siteEnvironment } from '../src/commands/site';

const base = { root: '.', cache: '.autocatalog/repos', out: 'dist', dev: false };

const made: string[] = [];

const tempDir = async (prefix: string) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  made.push(dir);

  return dir;
};

afterAll(() =>
  Promise.all(made.map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 10 }))),
);

describe('ac site --fingerprint', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      stdio: 'ignore',
    });

  const printed = async (repos: string[]) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(
      await runSite({ ...base, repos, lock: undefined, unlocked: true, fingerprint: true }),
    ).toBe(0);

    const hash = log.mock.calls.at(-1)?.[0];

    log.mockRestore();

    return String(hash);
  };

  it('changes only when an enrolled repository does', async () => {
    const repo = await tempDir('ac-print-');

    git(repo, 'init', '-q');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'one');

    const first = await printed([repo]);

    expect(first).toMatch(/^[a-f0-9]{16}$/);
    expect(await printed([repo])).toBe(first);

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'two');

    expect(await printed([repo])).not.toBe(first);
  });
});

describe('the token a build holds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('stays out of what an enrolled repository can read', () => {
    expect(siteEnvironment({ PATH: '/bin', GITHUB_TOKEN: 'a', GH_TOKEN: 'b' })).toEqual({
      PATH: '/bin',
    });
  });

  it('stays out of the message when a repository cannot be reached', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubEnv('GITHUB_TOKEN', 'ghp_SECRET');
    vi.stubEnv('GITHUB_SERVER_URL', 'https://127.0.0.1:1');

    expect(
      await runSite({
        ...base,
        repos: ['https://127.0.0.1:1/acme/payments.git'],
        unlocked: true,
        fingerprint: true,
      }),
    ).toBe(1);

    const said = error.mock.calls.join(' ');

    expect(said).toContain('payments');
    expect(said).not.toMatch(/Authorization|extraHeader|Z2hw/);
  });
});

describe('autocatalog.site.json beside a build', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives way to a folder named on the command line', async () => {
    const dir = await tempDir('ac-config-');
    const cwd = process.cwd();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await fs.writeFile(path.join(dir, 'autocatalog.site.json'), '{ "owner": "acme" }');
    process.chdir(dir);

    try {
      // Stops at the option check below enrolment, which an owner alone would fail first.
      await runSite({ ...base, root: dir, rootGiven: true, theme: 'mauve' });
    } finally {
      process.chdir(cwd);
    }

    expect(error.mock.calls.join(' ')).not.toMatch(/go together/);
  });
});

describe('a brand folder', () => {
  const folder = async (files: string[]) => {
    const dir = await tempDir('ac-brand-');

    await Promise.all(files.map((file) => fs.writeFile(path.join(dir, file), '')));

    return dir;
  };

  it('finds each file by its name, whatever the logo format', async () => {
    const dir = await folder(['logo.webp', 'logo-dark.svg', 'favicon.svg', 'theme.css', 'x.txt']);

    expect(await readBrand(dir)).toEqual({
      logo: path.join(dir, 'logo.webp'),
      logoDark: path.join(dir, 'logo-dark.svg'),
      favicon: path.join(dir, 'favicon.svg'),
      css: path.join(dir, 'theme.css'),
    });
  });

  it('takes any part of a brand on its own', async () => {
    const dir = await folder(['theme.css']);

    expect(await readBrand(dir)).toEqual({ css: path.join(dir, 'theme.css') });
  });

  it('refuses a folder with no brand in it', async () => {
    const dir = await folder(['notes.txt']);

    await expect(readBrand(dir)).rejects.toThrow(/logo, logo-dark, favicon\.svg or theme\.css/);
  });
});

describe('ac site arguments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a theme it does not have, and lists the ones it does', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, theme: 'mauve' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--theme: pick one of teal/);
  });

  it('refuses a brand folder that is not there, before building anything', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runSite({ ...base, brand: 'nowhere/brand' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/--brand: no folder at nowhere\/brand/);
  });

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
