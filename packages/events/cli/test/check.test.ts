import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubAnnotation } from '../src/commands/annotation';
import { runCheck } from '../src/commands/check';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-check-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), body);
}

describe('ac check', () => {
  it('passes a repository that publishes nothing, and says so', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await runCheck({ root, format: 'text' })).toBe(0);
    expect(log.mock.calls.join(' ')).toMatch(/nothing to check/i);
  });

  it('passes good documents', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await write('docs/runbook.md', '---\ntitle: Runbook\nowner: Ops\n---\n');

    expect(await runCheck({ root, format: 'text' })).toBe(0);
  });

  it('fails a document that breaks the contract', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('docs/runbook.md', '---\ntitle: Runbook\n---\n');

    expect(await runCheck({ root, format: 'text' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/owner/);
  });

  it('marks the file on a pull request', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('docs/runbook.md', '---\ntitle: Runbook\n---\n');

    expect(await runCheck({ root, format: 'github' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/::error file=.*docs\/runbook\.md::/);
  });

  it('checks the events of a package inside a monorepo, from its root', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await write('package.json', '{}');
    await write('packages/sdk/package.json', '{}');
    await write('packages/sdk/events/README.md', 'Generated.\n');

    await runCheck({ root, format: 'text' });

    expect(log.mock.calls.join(' ')).toMatch(/Events in packages\/sdk/);
  });

  const contract = JSON.stringify({
    title: 'order.placed',
    version: '1.0.0',
    type: 'object',
    properties: { id: { type: 'string' } },
  });

  const commit = () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });

    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  };

  it('fails a contract that does not parse, with no baseline to compare', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('contracts/order.json', '{ not json');

    expect(await runCheck({ root, format: 'text' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/contracts\/order\.json/);
  });

  it('passes a good contract with no baseline to compare', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await write('contracts/order.json', contract);

    expect(await runCheck({ root, format: 'text' })).toBe(0);
  });

  it.each(['test/fixtures/bad.json', 'test/fixtures/contracts/bad.json', 'apps/web/data.json'])(
    'leaves %s out of it, with or without a baseline',
    async (stray) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await write('contracts/order.json', contract);
      await write(stray, '{ deliberately not json');
      commit();

      expect(await runCheck({ root, format: 'text' })).toBe(0);
      expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(0);
    },
  );

  it.each(['test/fixtures/sample.json', 'schemas/internal.json'])(
    'does not compare a schema nobody published: deleting %s changes nothing',
    async (stray) => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await write('contracts/order.json', contract);
      await write(stray, contract.replace('order.placed', 'sample.seen'));
      commit();
      await fs.rm(path.join(root, stray));

      expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(0);
    },
  );

  it('still compares a mapped source outside contracts/', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await write(
      'contracts/autocatalog.conventions.json',
      JSON.stringify({
        sources: [{ kind: 'event', files: ['sdk/events.json'], match: ['{id}'], domain: 'orders' }],
      }),
    );
    await write(
      'sdk/events.json',
      JSON.stringify({
        'order.placed': { type: 'object', properties: { id: { type: 'string' } } },
      }),
    );
    commit();
    await write('sdk/events.json', '{}');

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(1);
  });

  it('still fails a mapped source outside contracts/ that does not parse', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write(
      'contracts/autocatalog.conventions.json',
      JSON.stringify({
        sources: [{ kind: 'event', files: ['sdk/events.json'], match: ['{id}'], domain: 'orders' }],
      }),
    );
    await write('sdk/events.json', '{ not json');

    expect(await runCheck({ root, format: 'text' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/sdk\/events\.json/);
  });

  it('checks a repository that publishes flows and no docs/', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('flows/bad.md', '---\ntitle: [unclosed\n---\n');

    expect(await runCheck({ root, format: 'text' })).toBe(1);
  });

  it('fails on two packages that would publish under one name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('package.json', '{}');
    await write('services/a/api/docs/ok.md', '---\ntitle: A\nowner: x\n---\n');
    await write('services/b/api/docs/other.md', '---\ntitle: B\nowner: x\n---\n');

    expect(await runCheck({ root, format: 'text' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/services\/b\/api.*services\/a\/api/);
  });

  it('lets a change fix a contract that is broken on the base branch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await write('contracts/order.json', '{ not json');
    commit();
    await write('contracts/order.json', contract);

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(0);
    expect(warn.mock.calls.join(' ')).toMatch(/main/);
  });

  it('asks for consent it can be given, for rules a repository runs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('contracts/order.json', contract);
    await write(
      'contracts/rules/always.rule.mts',
      "export default { id: 'always', name: 'Always', severity: 'breaking', run: () => [] };\n",
    );
    commit();

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(1);
    expect(
      await runCheck({ root, format: 'text', baseRef: 'main', allowCodeExecution: true }),
    ).toBe(0);
  });

  it('fails a change that deletes every contract the base branch has', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await write('contracts/order.json', contract);
    commit();
    await fs.rm(path.join(root, 'contracts'), { recursive: true });

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(1);
  });

  it('fails a change that deletes a package and its contracts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await write('package.json', '{}');
    await write('packages/sdk/package.json', '{}');
    await write('packages/sdk/contracts/order.json', contract);
    commit();
    await fs.rm(path.join(root, 'packages'), { recursive: true });

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(1);
  });

  it('reports a base branch it cannot read as a failure, and still runs the rest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await write('docs/runbook.md', '---\ntitle: Runbook\n---\n');
    commit();

    expect(await runCheck({ root, format: 'text', baseRef: 'origin/nope' })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/owner/);
    expect(error.mock.calls.join(' ')).toMatch(/origin\/nope/);
  });

  it('compares against the base branch when it is given one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });

    await write(
      'contracts/order.json',
      JSON.stringify({
        title: 'order.placed',
        version: '1.0.0',
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
    );
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');

    expect(await runCheck({ root, format: 'text', baseRef: 'main' })).toBe(0);
    expect(log.mock.calls.join(' ')).toMatch(/drift/i);
  });
});

describe('githubAnnotation', () => {
  it('points at the file, and keeps a message on one line', () => {
    expect(githubAnnotation('docs/a.md: owner: 100%\nrequired')).toBe(
      '::error file=docs/a.md::owner: 100%25%0Arequired',
    );
  });

  it('names a file only where it exists, so the mark lands on something', async () => {
    await write('docs/a.md', '');

    expect(githubAnnotation('docs/a.md: bad', root)).toBe('::error file=docs/a.md::bad');
    expect(githubAnnotation('flows/flows/a.md: bad', root)).toBe('::error::flows/flows/a.md: bad');
  });

  it('leaves out the file when a failure names none', () => {
    expect(githubAnnotation('a flow does not hold together')).toBe(
      '::error::a flow does not hold together',
    );
  });
});
