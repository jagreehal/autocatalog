import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { eventFrontmatter } from 'autocatalog-core';
import { z } from 'zod';
import { runImport } from '../src/commands/import';

/** A TCP server's bound address; a pipe or an unbound server has no port. */
const listening = z.object({ port: z.number() });

async function run(cmd: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with ${code ?? 1}`));
    });
  });
}

async function mkGitFixtureRepo(): Promise<{
  repoPath: string;
  repoUrl: string;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-fixture-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(path.join(repo, 'schemas'), { recursive: true });
  await fs.mkdir(path.join(repo, 'examples'), { recursive: true });
  await fs.writeFile(
    path.join(repo, 'schemas/payment.completed.json'),
    JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }),
  );
  await fs.writeFile(
    path.join(repo, 'examples/payment.completed.json'),
    JSON.stringify({ id: 'x' }),
  );
  await fs.writeFile(
    path.join(repo, 'autocatalog.sources.json'),
    JSON.stringify({
      events: [
        {
          id: 'payment.completed',
          domain: 'payments',
          version: '1.0.0',
          schemaPath: 'schemas/payment.completed.json',
          examplePaths: ['examples/payment.completed.json'],
        },
      ],
    }),
  );
  await run('git', ['init', '-q'], repo);
  await run('git', ['config', 'user.email', 'test@example.com'], repo);
  await run('git', ['config', 'user.name', 'Autocatalog Test'], repo);
  await run('git', ['add', '.'], repo);
  await run('git', ['commit', '-qm', 'init'], repo);

  return {
    repoPath: repo,
    repoUrl: `file://${repo}`,
    cleanup: async () => fs.rm(root, { recursive: true, force: true }),
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();

    if (fn) await fn();
  }
});

describe('runImport', () => {
  it('imports from a local git fixture repo using manifestPath', async () => {
    const fixture = await mkGitFixtureRepo();
    cleanups.push(fixture.cleanup);

    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-project-'));
    cleanups.push(async () => fs.rm(projectRoot, { recursive: true, force: true }));

    const exit = await runImport({
      cwd: projectRoot,
      githubRepo: fixture.repoUrl,
      cloneWith: 'git',
      manifestPath: 'autocatalog.sources.json',
    });

    expect(exit).toBe(0);

    const manifest = eventFrontmatter.parse(
      JSON.parse(
        await fs.readFile(
          path.join(projectRoot, 'events/payments/PaymentCompleted/autocatalog.json'),
          'utf8',
        ),
      ),
    );

    expect(manifest.source?.type).toBe('github_clone');
    expect(manifest.status).toBe('draft');
  });

  it('supports dry-run without writing files', async () => {
    const fixture = await mkGitFixtureRepo();
    cleanups.push(fixture.cleanup);

    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-project-'));
    cleanups.push(async () => fs.rm(projectRoot, { recursive: true, force: true }));

    const exit = await runImport({
      cwd: projectRoot,
      githubRepo: fixture.repoUrl,
      cloneWith: 'git',
      manifestPath: 'autocatalog.sources.json',
      dryRun: true,
    });

    expect(exit).toBe(0);

    await expect(fs.access(path.join(projectRoot, 'events'))).rejects.toThrow();
  });

  it('does not publish a partial catalog when a later event is invalid', async () => {
    const fixture = await mkGitFixtureRepo();
    cleanups.push(fixture.cleanup);

    await fs.writeFile(path.join(fixture.repoPath, 'schemas/invalid.json'), '[]');
    await fs.writeFile(
      path.join(fixture.repoPath, 'autocatalog.sources.json'),
      JSON.stringify({
        events: [
          {
            id: 'payment.completed',
            domain: 'payments',
            version: '1.0.0',
            schemaPath: 'schemas/payment.completed.json',
          },
          {
            id: 'payment.failed',
            domain: 'payments',
            version: '1.0.0',
            schemaPath: 'schemas/invalid.json',
          },
        ],
      }),
    );
    await run('git', ['add', '.'], fixture.repoPath);
    await run('git', ['commit', '-qm', 'add invalid event'], fixture.repoPath);

    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-project-'));
    cleanups.push(async () => fs.rm(projectRoot, { recursive: true, force: true }));

    await expect(
      runImport({
        cwd: projectRoot,
        githubRepo: fixture.repoUrl,
        cloneWith: 'git',
        manifestPath: 'autocatalog.sources.json',
      }),
    ).rejects.toThrow('Schema for payment.failed is not a JSON object');
    await expect(fs.access(path.join(projectRoot, 'events'))).rejects.toThrow();
  });

  it('imports from manifestUrl with remote schemaUrl/exampleUrls', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-project-'));
    cleanups.push(async () => fs.rm(projectRoot, { recursive: true, force: true }));
    await fs.writeFile(
      path.join(projectRoot, 'schema.json'),
      JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }),
    );
    await fs.writeFile(path.join(projectRoot, 'example.json'), JSON.stringify({ id: 'inv-1' }));

    let manifestRaw = '';

    const runtimeServer = http.createServer(async (req, res) => {
      if (req.url === '/manifest.json') {
        res.setHeader('content-type', 'application/json');
        res.end(manifestRaw);

        return;
      }

      if (req.url === '/schema.json') {
        res.setHeader('content-type', 'application/json');
        res.end(await fs.readFile(path.join(projectRoot, 'schema.json'), 'utf8'));

        return;
      }

      if (req.url === '/example.json') {
        res.setHeader('content-type', 'application/json');
        res.end(await fs.readFile(path.join(projectRoot, 'example.json'), 'utf8'));

        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => runtimeServer.listen(0, '127.0.0.1', () => resolve()));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          runtimeServer.close(() => resolve());
        }),
    );
    const { port } = listening.parse(runtimeServer.address());
    const baseUrl = `http://127.0.0.1:${port}`;
    const manifestUrl = `${baseUrl}/manifest.json`;
    manifestRaw = JSON.stringify({
      events: [
        {
          id: 'invoice.issued',
          domain: 'billing',
          version: '1.0.0',
          schemaUrl: `${baseUrl}/schema.json`,
          exampleUrls: [`${baseUrl}/example.json`],
        },
      ],
    });

    const exit = await runImport({
      cwd: projectRoot,
      manifestUrl,
      timeoutMs: 3000,
      maxBytes: 200000,
      allowedHosts: ['127.0.0.1'],
    });

    expect(exit).toBe(0);

    const schema = await fs.readFile(
      path.join(projectRoot, 'events/billing/InvoiceIssued/schema.json'),
      'utf8',
    );

    expect(schema).toContain('"type": "object"');
  });
});
