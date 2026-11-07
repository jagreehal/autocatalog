import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogReleases,
  clonePinned,
  federationStatus,
  prepareSources,
  readLock,
  readLockFile,
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
  describe('who owns each service', () => {
    /** A repository whose spec says it serves `service`. */
    const serving = async (name: string, service: string) => {
      const dir = path.join(work, 'remotes', name);

      await fs.mkdir(path.join(dir, 'contracts'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'contracts/api.json'),
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: name, version: '1.0.0' },
          'x-autocatalog': { service },
          paths: { '/a': { get: {} } },
        }),
      );
      git(dir, 'init', '-q');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'init');

      return `file://${dir}`;
    };

    const lockWith = async (repos: string[], service?: string[]) => {
      quiet();

      return runFederationLock({
        repos,
        lock: path.join(work, 'autocatalog.lock.json'),
        cache: path.join(work, 'cache'),
        ...(service && { service }),
      });
    };

    const owners = async () =>
      (await readLockFile(path.join(work, 'autocatalog.lock.json')))?.services;

    it('pins each service to the one repository that claims it', async () => {
      expect(await lockWith([await serving('users', 'users-api')])).toBe(0);
      expect(await owners()).toEqual({ 'users-api': 'users' });
    });

    it('refuses to choose between two claims, and takes the one --service names', async () => {
      const repos = [await serving('users', 'users-api'), await serving('copy', 'users-api')];

      expect(await lockWith(repos)).toBe(1);
      expect(await owners()).toBeUndefined();

      expect(await lockWith(repos, ['users-api=users'])).toBe(0);
      expect(await owners()).toEqual({ 'users-api': 'users' });
    });

    it('keeps a pin when a newcomer claims the service too', async () => {
      const users = await serving('users', 'users-api');

      await lockWith([users]);

      expect(await lockWith([users, await serving('newcomer', 'users-api')])).toBe(0);
      expect(await owners()).toEqual({ 'users-api': 'users' });
    });
  });

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

  describe('choosing what to pin', () => {
    const lockAt = async (remote: string, flags: { ref?: string; latestTag?: boolean }) => {
      const lock = path.join(work, 'autocatalog.lock.json');

      quiet();

      const code = await runFederationLock({
        repos: [`file://${remote}`],
        lock,
        cache: path.join(work, 'cache'),
        ...flags,
      });

      return { code, lock };
    };

    /** A repository with a commit after the one `tag` names, so HEAD is not the release. */
    const released = async (...tags: string[]) => {
      const remote = await repository('payments');

      for (const tag of tags) {
        git(remote, 'commit', '-q', '--allow-empty', '-m', tag);
        git(remote, 'tag', tag);
      }

      git(remote, 'commit', '-q', '--allow-empty', '-m', 'unreleased');

      return remote;
    };

    it('pins a tag and records it', async () => {
      const remote = await released('v1.0.0');
      const { code, lock } = await lockAt(remote, { ref: 'v1.0.0' });

      expect(code).toBe(0);
      expect((await readLock(lock))![0]).toMatchObject({
        commit: git(remote, 'rev-parse', 'v1.0.0'),
        tag: 'v1.0.0',
      });
    });

    it('pins the commit an annotated tag points at', async () => {
      const remote = await repository('payments');

      git(remote, 'tag', '-a', 'v1.0.0', '-m', 'release');
      git(remote, 'commit', '-q', '--allow-empty', '-m', 'unreleased');

      const { lock } = await lockAt(remote, { ref: 'v1.0.0' });

      expect((await readLock(lock))![0]!.commit).toBe(git(remote, 'rev-parse', 'v1.0.0^{commit}'));
    });

    it('pins a branch other than the default, with no tag recorded', async () => {
      const remote = await repository('payments');

      git(remote, 'checkout', '-q', '-b', 'next');
      git(remote, 'commit', '-q', '--allow-empty', '-m', 'next');

      const commit = git(remote, 'rev-parse', 'HEAD');

      git(remote, 'checkout', '-q', '-');

      const { lock } = await lockAt(remote, { ref: 'next' });
      const [entry] = (await readLock(lock))!;

      expect(entry!.commit).toBe(commit);
      expect(entry!.tag).toBeUndefined();
    });

    it('builds a pin taken from a tag', async () => {
      const remote = await released('v1.0.0');
      const { lock } = await lockAt(remote, { ref: 'v1.0.0' });

      const { failures } = await clonePinned((await readLock(lock))!, {
        cache: path.join(work, 'cache'),
      });

      expect(failures).toEqual([]);
    });

    it('takes the newest release by number, past a prerelease', async () => {
      const remote = await released('v1.9.0', 'v1.10.0', 'v2.0.0-beta.1', 'payments@9.0.0');
      const { lock } = await lockAt(remote, { latestTag: true });

      expect((await readLock(lock))![0]).toMatchObject({
        commit: git(remote, 'rev-parse', 'v1.10.0'),
        tag: 'v1.10.0',
      });
    });

    it('pins the latest commit of a repository with no release tag', async () => {
      const remote = await repository('payments');
      const { code, lock } = await lockAt(remote, { latestTag: true });

      expect(code).toBe(0);
      expect((await readLock(lock))![0]).toMatchObject({
        commit: git(remote, 'rev-parse', 'HEAD'),
      });
      expect((await readLock(lock))![0]!.tag).toBeUndefined();
    });

    it('records the tag when the pinned commit is already locked', async () => {
      const remote = await repository('payments');

      await lockAt(remote, {});
      git(remote, 'tag', 'v1.0.0');

      const { lock } = await lockAt(remote, { ref: 'v1.0.0' });

      expect((await readLock(lock))![0]!.tag).toBe('v1.0.0');
    });

    it('records the release on a commit however it was chosen', async () => {
      const remote = await repository('payments');

      git(remote, 'tag', 'v1.0.0');
      git(remote, 'tag', 'v1.1.0');
      git(remote, 'tag', 'v2.0.0-beta.1');

      const { lock } = await lockAt(remote, {});

      expect((await readLock(lock))![0]!.tag).toBe('v1.1.0');

      await lockAt(remote, { ref: git(remote, 'rev-parse', 'HEAD') });

      expect((await readLock(lock))![0]!.tag).toBe('v1.1.0');
    });

    it('pins the commit a full SHA names, past a tag spelt the same', async () => {
      const remote = await repository('payments');
      const reviewed = git(remote, 'rev-parse', 'HEAD');

      git(remote, 'commit', '-q', '--allow-empty', '-m', 'later');
      git(remote, 'tag', reviewed, 'HEAD');

      const { lock } = await lockAt(remote, { ref: reviewed });

      expect((await readLock(lock))![0]!.commit).toBe(reviewed);
    });

    it('refuses a name that is a tag and a branch at different commits', async () => {
      const remote = await repository('payments');

      git(remote, 'tag', 'release');
      git(remote, 'checkout', '-q', '-b', 'side');
      git(remote, 'commit', '-q', '--allow-empty', '-m', 'side');
      git(remote, 'branch', 'release');
      git(remote, 'checkout', '-q', '-');

      expect((await lockAt(remote, { ref: 'release' })).code).toBe(1);
    });

    it('keeps the tag a ref names, prerelease or not', async () => {
      const remote = await released('v2.0.0-beta.1');
      const { lock } = await lockAt(remote, { ref: 'v2.0.0-beta.1' });

      expect((await readLock(lock))![0]!.tag).toBe('v2.0.0-beta.1');
    });

    it('clears the tag when the same commit is locked without one', async () => {
      const remote = await repository('payments');

      git(remote, 'tag', 'v1.0.0');
      await lockAt(remote, { ref: 'v1.0.0' });
      git(remote, 'tag', '-d', 'v1.0.0');

      const { lock } = await lockAt(remote, {});
      const [entry] = (await readLock(lock))!;

      expect(entry!.commit).toBe(git(remote, 'rev-parse', 'HEAD'));
      expect(entry!.tag).toBeUndefined();
    });

    it('keeps lockedAt when only the tag changes', async () => {
      const remote = await repository('payments');
      const { lock } = await lockAt(remote, {});
      const { lockedAt } = (await readLock(lock))![0]!;

      git(remote, 'tag', 'v1.0.0');
      await lockAt(remote, { ref: 'v1.0.0' });

      expect((await readLock(lock))![0]!.lockedAt).toBe(lockedAt);
    });

    it('fails, and keeps the lock, when no repository has the ref', async () => {
      const remote = await released('v1.0.0');
      const { lock } = await lockAt(remote, { ref: 'v1.0.0' });
      const before = await fs.readFile(lock, 'utf8');

      expect((await lockAt(remote, { ref: 'v9.9.9' })).code).toBe(1);
      expect(await fs.readFile(lock, 'utf8')).toBe(before);
    });

    it('keeps the pin of a repository without the ref, and moves the rest', async () => {
      const remote = await released('v1.0.0');
      const other = await repository('ledger');

      // Another copy of the fixture would claim PaymentService too, and the lock refuses that.
      await fs.rm(path.join(other, 'contracts'), { recursive: true });
      git(other, 'add', '-A');
      git(other, 'commit', '-qm', 'publishes no events');

      const lock = path.join(work, 'autocatalog.lock.json');
      const repos = [`file://${remote}`, `file://${other}`];
      const cache = path.join(work, 'cache');

      quiet();
      await runFederationLock({ repos, lock, cache });
      expect(await runFederationLock({ repos, lock, cache, ref: 'v1.0.0' })).toBe(0);

      const entries = await readLock(lock);

      expect(entries!.find(({ name }) => name === 'ledger')!.commit).toBe(
        git(other, 'rev-parse', 'HEAD'),
      );
      expect(entries!.find(({ name }) => name === 'payments')!.tag).toBe('v1.0.0');
    });

    it('refuses --ref with --latest-tag, and a ref git would read as an option', async () => {
      const remote = await repository('payments');

      expect((await lockAt(remote, { ref: 'v1.0.0', latestTag: true })).code).toBe(1);
      expect((await lockAt(remote, { ref: '--all' })).code).toBe(1);
    });
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

/** A monorepo holding the fixture's catalog at packages/payments, and a repository named payments with no catalog. */
async function monorepo(): Promise<{ platform: string; namesake: string }> {
  const platform = path.join(work, 'remotes', 'platform');
  const namesake = path.join(work, 'remotes', 'payments');

  await fs.cp(fixture, path.join(platform, 'packages/payments'), { recursive: true });
  await fs.mkdir(namesake, { recursive: true });
  await fs.writeFile(path.join(namesake, 'README.md'), '# Payments\n');

  for (const dir of [platform, namesake]) {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
  }

  git(platform, 'tag', 'v1.0.0');

  return { platform, namesake };
}

describe('catalog releases', () => {
  it("label a nested catalog and an imported project with the repository's release", async () => {
    const { platform, namesake } = await monorepo();
    const repos = [`file://${platform}`, `file://${namesake}`];
    const lock = path.join(work, 'autocatalog.lock.json');
    const cache = path.join(work, 'cache');

    quiet();
    await runFederationLock({ repos, lock, cache, latestTag: true });

    const { root, pinned } = await prepareSources({ root: work, cache, lock, repos });
    const imported = path.join(work, 'imported/shop');

    expect(
      catalogReleases([...pinned.values()], root, {
        sources: [imported],
        origins: new Map([[imported, path.join(root, 'platform/apps/shop')]]),
      }),
    ).toEqual({
      [path.join(root, 'platform/packages/payments')]: 'platform v1.0.0',
      [imported]: 'platform v1.0.0',
    });
  });

  it('are empty without a lock', async () => {
    expect(catalogReleases([], work, { sources: [], origins: new Map() })).toEqual({});
  });
});

describe('ac federation status', () => {
  it('gives a nested catalog the pin of the repository holding it, not of a namesake', async () => {
    const { platform, namesake } = await monorepo();
    const repos = [`file://${platform}`, `file://${namesake}`];
    const lock = path.join(work, 'autocatalog.lock.json');
    const cache = path.join(work, 'cache');

    quiet();
    await runFederationLock({ repos, lock, cache, latestTag: true });

    const status = await federationStatus(await prepareSources({ root: work, cache, lock, repos }));

    expect(status.sources.find(({ repository }) => repository === 'payments')).toMatchObject({
      commit: git(platform, 'rev-parse', 'HEAD'),
      tag: 'v1.0.0',
    });
  });

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
