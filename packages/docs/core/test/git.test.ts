import { describe, expect, it } from 'vitest';
import { webUrl } from '../src/git';

describe('webUrl', () => {
  it('turns ssh and https remotes into the repository page', () => {
    expect(webUrl('git@github.com:acme/payments.git')).toBe('https://github.com/acme/payments');
    expect(webUrl('https://github.com/acme/payments.git')).toBe('https://github.com/acme/payments');
    expect(webUrl('https://gitlab.com/acme/platform/payments')).toBe(
      'https://gitlab.com/acme/platform/payments',
    );
  });

  it('drops credentials a remote URL carries, so a token never reaches a published link', () => {
    expect(webUrl('https://x-access-token:ghp_secret@github.com/acme/payments.git')).toBe(
      'https://github.com/acme/payments',
    );
  });

  it('gives up on remotes with no web page', () => {
    expect(webUrl('/srv/git/payments.git')).toBeNull();
  });
});

describe('sourceUrl', () => {
  it("links a file in a sibling checkout to its repository's web page", async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { sourceUrl } = await import('../src/git');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-source-'));

    try {
      const repo = path.join(root, 'payments-service');
      await fs.mkdir(path.join(repo, 'docs'), { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/payments-service.git'], {
        cwd: repo,
      });

      expect(sourceUrl(root, 'payments-service/docs/runbook.md')).toBe(
        'https://github.com/acme/payments-service/blob/main/docs/runbook.md',
      );
      expect(sourceUrl(root, 'payments-service/docs/runbook.md', 'edit')).toBe(
        'https://github.com/acme/payments-service/edit/main/docs/runbook.md',
      );
      expect(sourceUrl(root, 'payments-service/events/payments/Captured', 'tree')).toBe(
        'https://github.com/acme/payments-service/tree/main/events/payments/Captured',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the path from the top of the checkout when the root sits below it', async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { sourceUrl } = await import('../src/git');

    const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-monorepo-'));

    try {
      const root = path.join(checkout, 'examples/site');
      await fs.mkdir(path.join(root, 'payments-service/docs'), { recursive: true });
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: checkout });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/mono.git'], {
        cwd: checkout,
      });

      expect(sourceUrl(root, 'payments-service/docs/runbook.md')).toBe(
        'https://github.com/acme/mono/blob/main/examples/site/payments-service/docs/runbook.md',
      );
    } finally {
      await fs.rm(checkout, { recursive: true, force: true });
    }
  });
});

describe('headCommit', () => {
  it('names the commit a checkout is at, and null outside one', async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { headCommit } = await import('../src/git');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-commit-'));

    try {
      expect(headCommit(root)).toBeNull();

      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

      git('init', '-q');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');

      expect(headCommit(root)).toBe(git('rev-parse', 'HEAD'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("links to the remote's default branch when the checkout is on another one", async () => {
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { sourceUrl } = await import('../src/git');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-default-branch-'));

    try {
      const repo = path.join(root, 'ledger');
      await fs.mkdir(repo);
      execFileSync('git', ['init', '-q', '-b', 'feature'], { cwd: repo });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/ledger.git'], {
        cwd: repo,
      });
      execFileSync(
        'git',
        ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'],
        {
          cwd: repo,
        },
      );

      expect(sourceUrl(root, 'ledger/docs/runbook.md')).toBe(
        'https://github.com/acme/ledger/blob/trunk/docs/runbook.md',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
