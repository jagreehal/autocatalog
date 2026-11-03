import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clonePinned,
  federationStatus,
  prepareSources,
  readLock,
  runFederationLock,
  runFederationStatus,
} from '../src/federation';
import { tokenHeader } from '../src/enrol';

const here = path.dirname(fileURLToPath(import.meta.url));

const fixture = path.resolve(here, '../../../../fixtures/delivery-rabbitmq');

let work: string;

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', ...args], {
    encoding: 'utf8',
  }).trim();

/** A repository with one commit of the fixture, cloneable over file://. */
async function repository(name: string): Promise<string> {
  const dir = path.join(work, 'remotes', name);

  await fs.cp(fixture, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');

  return dir;
}

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-federation-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(work, { recursive: true, force: true });
});

describe('ac federation lock', () => {
  it('pins each repository to its commit and tree', async () => {
    const remote = await repository('payments');
    const lock = path.join(work, 'autocatalog.lock.json');

    quiet();
    expect(
      await runFederationLock({
        repos: [`file://${remote}`],
        lock,
        cache: path.join(work, 'cache'),
      }),
    ).toBe(0);

    const [entry] = (await readLock(lock))!;

    expect(entry).toMatchObject({
      name: 'payments',
      commit: git(remote, 'rev-parse', 'HEAD'),
      tree: git(remote, 'rev-parse', 'HEAD^{tree}'),
    });
  });

  it('follows a repository to its new URL even when the commit is the same', async () => {
    const remote = await repository('payments');
    const moved = path.join(work, 'moved', 'payments');
    const lock = path.join(work, 'autocatalog.lock.json');

    quiet();
    await runFederationLock({ repos: [`file://${remote}`], lock, cache: path.join(work, 'cache') });
    await fs.cp(remote, moved, { recursive: true });
    await runFederationLock({ repos: [`file://${moved}`], lock, cache: path.join(work, 'cache') });

    expect((await readLock(lock))![0]!.url).toBe(`file://${moved}`);
  });

  it('fails, and keeps the previous lock, when no repository can be cloned', async () => {
    const remote = await repository('payments');
    const lock = path.join(work, 'autocatalog.lock.json');

    quiet();
    await runFederationLock({ repos: [`file://${remote}`], lock, cache: path.join(work, 'cache') });

    const before = await fs.readFile(lock, 'utf8');

    const code = await runFederationLock({
      repos: [`file://${path.join(work, 'missing', 'payments')}`],
      lock,
      cache: path.join(work, 'cache'),
    });

    expect(code).toBe(1);
    expect(await fs.readFile(lock, 'utf8')).toBe(before);
  });
});

describe('pinned builds', () => {
  it('says why a locked commit cannot be built without the token in it', async () => {
    const remote = await repository('payments');
    const token = 'dummy-token-not-a-secret';

    const { failures } = await clonePinned(
      [
        {
          name: 'payments',
          url: `file://${remote}`,
          commit: 'f'.repeat(40),
          tree: 'e'.repeat(40),
          lockedAt: '2026-01-01T00:00:00Z',
        },
      ],
      { cache: path.join(work, 'cache'), token },
    );

    const reason = failures[0]!.reason;

    expect(reason).toMatch(/could not build the locked commit/);
    expect(reason).not.toContain(Buffer.from(`x-access-token:${token}`).toString('base64'));
    expect(reason).not.toContain('extraHeader');
  });
});

describe('ac federation status', () => {
  it('names a source that does not compile instead of counting it as empty', async () => {
    const root = path.join(work, 'checkouts');

    await fs.cp(fixture, path.join(root, 'payments'), { recursive: true });
    git(path.join(root, 'payments'), 'init', '-q');
    await fs.writeFile(
      path.join(root, 'payments/contracts/events/payment.completed.json'),
      '{ not json',
    );

    const status = await federationStatus(
      await prepareSources({ root, cache: path.join(work, 'cache'), unlocked: true }),
    );

    expect(status.failures).toContainEqual(expect.objectContaining({ name: 'payments' }));
  });
});

describe('a lock someone names', () => {
  it('is an error when it is not there, rather than building unpinned', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = path.join(work, 'locks', 'prod.json');

    await expect(readLock(missing)).resolves.toBeUndefined();
    await expect(readLock(missing, { required: true })).rejects.toThrow(/prod\.json: no lock here/);

    const code = await runFederationStatus({
      root: work,
      cache: path.join(work, 'cache'),
      lock: missing,
      format: 'json',
    });

    expect(code).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/prod\.json: no lock here/);
  });

  it('refuses an entry that is not a folder name, or a URL git would read as an option', async () => {
    const lock = path.join(work, 'autocatalog.lock.json');

    const entry = {
      name: 'payments',
      url: 'https://github.com/acme/payments.git',
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      lockedAt: '2026-11-03T00:00:00Z',
    };

    for (const bad of [{ name: '..' }, { name: '.' }, { url: '--upload-pack=touch /tmp/x' }]) {
      await fs.writeFile(
        lock,
        JSON.stringify({ spec: 'autocatalog/lock-v1', repositories: [{ ...entry, ...bad }] }),
      );
      await expect(readLock(lock)).rejects.toThrow(/not a (folder name|URL)/);
    }
  });

  it('names its file when it is not JSON', async () => {
    const lock = path.join(work, 'autocatalog.lock.json');

    await fs.writeFile(lock, '{ not json');
    await expect(readLock(lock)).rejects.toThrow(/autocatalog\.lock\.json: not JSON/);
  });
});

describe('the token', () => {
  afterEach(() => {
    delete process.env.GITHUB_SERVER_URL;
  });

  it('goes only over HTTPS to GitHub, or the GitHub server the run names', () => {
    const sent = (url: string) => tokenHeader(url, 'dummy-token-not-a-secret').length > 0;

    expect(sent('https://github.com/acme/payments.git')).toBe(true);
    expect(sent('https://evil.example/acme/payments.git')).toBe(false);
    expect(sent('http://github.com/acme/payments.git')).toBe(false);
    expect(sent('https://github.com.evil.example/acme/payments.git')).toBe(false);
    expect(sent('git@github.com:acme/payments.git')).toBe(false);
    expect(sent('https://git.acme.dev/acme/payments.git')).toBe(false);

    process.env.GITHUB_SERVER_URL = 'https://git.acme.dev';
    expect(sent('https://git.acme.dev/acme/payments.git')).toBe(true);
  });
});
