import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonValue } from 'autocatalog-core';
import {
  cloneRepositories,
  ignoredDirectory,
  listRepositoriesByTopic,
  repositoryName,
} from '../src/enrol';

const json = (body: JsonValue, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const repo = (name: string, topics: string[], archived = false) => ({
  name,
  clone_url: `https://github.com/acme/${name}.git`,
  topics,
  archived,
});

describe('listRepositoriesByTopic', () => {
  it('falls back from organisation to user, and keeps only live repositories with the topic', async () => {
    const seen: string[] = [];

    const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(url);
      expect(init?.headers?.authorization).toBe('Bearer t0ken');

      if (url.includes('/orgs/')) return json({ message: 'Not Found' }, 404);

      return json([
        repo('payments', ['cbd-publisher']),
        repo('dashboard', ['cbd-publisher', 'frontend']),
        repo('old-billing', ['cbd-publisher'], true),
        repo('scratch', []),
      ]);
    };

    const found = await listRepositoriesByTopic({
      owner: 'acme',
      topic: 'cbd-publisher',
      token: 't0ken',
      fetch,
    });

    expect(found.map((r) => r.name)).toEqual(['dashboard', 'payments']);
    expect(seen[0]).toContain('/orgs/acme/repos');
    expect(seen[1]).toContain('/users/acme/repos');
  });

  it('reads every page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => repo(`r${i}`, ['t']));

    const fetch = async (url: string) =>
      json(new URL(url).searchParams.get('page') === '1' ? full : [repo('last', ['t'])]);

    const found = await listRepositoriesByTopic({
      owner: 'acme',
      topic: 't',
      fetch,
    });

    expect(found).toHaveLength(101);
  });

  it('says which owner could not be listed', async () => {
    const fetch = async () => json({ message: 'Bad credentials' }, 401);
    await expect(listRepositoriesByTopic({ owner: 'acme', topic: 't', fetch })).rejects.toThrow(
      /401 listing acme/,
    );
  });
});

describe('cloneRepositories', () => {
  let work: string;
  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-enrol-'));
  });
  afterEach(() => fs.rm(work, { recursive: true, force: true }));

  it('clones with history, so git can date each document', async () => {
    const origin = path.join(work, 'payments');
    await fs.mkdir(path.join(origin, 'docs'), { recursive: true });
    await fs.writeFile(path.join(origin, 'docs', 'runbook.md'), '# Runbook\n');

    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...args], {
        cwd: origin,
      });

    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'runbook');

    const into = path.join(work, 'repos');
    await cloneRepositories([{ name: 'payments', cloneUrl: origin }], { into });

    const log = execFileSync('git', ['log', '-1', '--format=%s', '--', 'docs/runbook.md'], {
      cwd: path.join(into, 'payments'),
      encoding: 'utf8',
    });

    expect(log.trim()).toBe('runbook');
  });
});

describe('repositoryName', () => {
  it('names a clone after its repository', () => {
    expect(repositoryName('https://github.com/acme/payments.git')).toBe('payments');
    expect(repositoryName('git@github.com:acme/payments.git')).toBe('payments');
    expect(repositoryName('https://github.com/acme/payments/')).toBe('payments');
  });
});

describe('ignoredDirectory', () => {
  it('ignores itself, so a cache made inside a repository is never something to commit', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ignored-'));

    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      await ignoredDirectory(path.join(repo, '.autocatalog/eventcatalog'));
      await fs.writeFile(path.join(repo, '.autocatalog/eventcatalog/package.json'), '{}');

      const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd: repo,
        encoding: 'utf8',
      });

      expect(status).toBe('');
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
