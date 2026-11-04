import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMcpSweep } from '../src/commands/mcp-sweep';

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-sweep-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(work, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@acme.dev', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );

/** A real repository holding these files, reached over `file://` as a clone would be. */
const repository = async (name: string, files: Record<string, string>): Promise<string> => {
  const dir = path.join(work, 'remote', name);

  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }

  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'first');

  return `file://${dir}`;
};

const sweep = (repos: string[], extra = {}) =>
  runMcpSweep({
    repos,
    root: path.join(work, 'catalog'),
    cache: path.join(work, 'cache'),
    ...extra,
  });

const manifest = async (id: string) =>
  JSON.parse(
    await fs.readFile(path.join(work, 'catalog/mcp-servers', id, 'autocatalog.json'), 'utf8'),
  );

const config = (mcpServers: Parameters<typeof JSON.stringify>[0]) => JSON.stringify({ mcpServers });

const built = `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
new McpServer({ name: 'ledger', version: '1' });`;

describe('ac mcp-sweep', () => {
  it('builds one inventory across repositories, and leaves nothing behind', async () => {
    const exit = await sweep([
      await repository('payments', {
        '.mcp.json': config({ gh: { url: 'https://api.githubcopilot.com/mcp' } }),
      }),
      await repository('support', {
        '.cursor/mcp.json': config({ github: { url: 'https://api.githubcopilot.com/mcp/' } }),
      }),
      await repository('ledger-service', {
        'package.json': JSON.stringify({ name: 'ledger-mcp' }),
        'src/server.ts': built,
      }),
    ]);

    expect(exit).toBe(0);
    expect(await manifest('api-githubcopilot-com')).toMatchObject({
      used_by: ['payments', 'support'],
    });
    expect(await manifest('ledger-mcp')).toMatchObject({
      origin: 'built',
      repository: { id: 'ledger-service' },
    });
    await expect(fs.stat(path.join(work, 'cache'))).rejects.toThrow();
  });

  it('keeps every server when a repository cannot be read, and says the run was partial', async () => {
    const payments = await repository('payments', {
      '.mcp.json': config({ gh: { url: 'https://api.githubcopilot.com/mcp' } }),
    });

    await sweep([payments]);

    const exit = await sweep(
      [
        await repository('other', { 'README.md': 'nothing here' }),
        `file://${path.join(work, 'remote', 'deleted')}`,
      ],
      { prune: true },
    );

    expect(exit).toBe(1);
    await expect(manifest('api-githubcopilot-com')).resolves.toBeDefined();
  });

  it('asks what to sweep', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await sweep([])).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--owner'));
  });
});
