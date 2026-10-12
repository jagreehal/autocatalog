import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { builtInDiscoveryAdapters, jsonSchemaDiscoveryAdapter } from 'autocatalog-core';
import { runDrift } from '../src/commands/drift';

const execFileAsync = promisify(execFile);

describe('ac drift --base-ref', () => {
  let repo: string;
  let project: string;
  let schemaPath: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-drift-ref-test-'));
    project = path.join(repo, 'packages', 'contracts');
    schemaPath = path.join(project, 'schemas', 'payment.completed.schema.json');
    await fs.mkdir(path.dirname(schemaPath), { recursive: true });
    await fs.writeFile(
      schemaPath,
      `${JSON.stringify(
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $id: 'payment.completed',
          title: 'Payment Completed',
          description: 'A payment completed.',
          type: 'object',
          properties: { id: { type: 'string' }, amount: { type: 'number' } },
          required: ['id', 'amount'],
          'x-autocatalog': {
            id: 'payment.completed',
            version: '1.0.0',
            domain: 'payments',
            summary: 'A payment completed.',
            consumers: ['Ledger'],
          },
        },
        null,
        2,
      )}\n`,
    );
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await execFileAsync('git', ['add', '.'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: repo });

    const current = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    delete current.properties.amount;
    current.required = ['id'];
    await fs.writeFile(schemaPath, `${JSON.stringify(current, null, 2)}\n`);
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('scans the ref and working tree without a pre-generated baseline', async () => {
    await expect(
      runDrift({
        baseRef: 'HEAD',
        root: project,
        quiet: true,
        adapters: [jsonSchemaDiscoveryAdapter],
      }),
    ).resolves.toBe(1);
  });

  it('fails a missing or shallow-clone ref with an actionable source error', async () => {
    await expect(
      runDrift({
        baseRef: 'origin/ref-that-does-not-exist',
        root: project,
        quiet: true,
        adapters: [jsonSchemaDiscoveryAdapter],
      }),
    ).rejects.toThrow(/\[source_ref_not_found\].*git fetch/i);
  });
});

describe('ac drift --base-ref on an autotel-message-contract approved file', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-drift-message-contract-'));
    const contract = path.join(repo, 'src', 'orders', '__contracts__', 'OrderPlaced.approved.txt');
    await fs.mkdir(path.dirname(contract), { recursive: true });
    await fs.writeFile(contract, JSON.stringify({ orderId: 'ord-1', total: 42.5 }, undefined, 2));
    await fs.writeFile(
      contract.replace(/\.txt$/, '.autocatalog.json'),
      JSON.stringify({ id: 'order.placed', version: '1.0.0', consumers: ['Billing'] }),
    );
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await execFileAsync('git', ['add', '.'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: repo });
    // The test was re-run with AUTOTEL_CONTRACT_UPDATE=1 after renaming a field.
    await fs.writeFile(
      contract,
      JSON.stringify({ amountDue: 42.5, orderId: 'ord-1' }, undefined, 2),
    );
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('fails the gate on a renamed field and names the consumer, like any event', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runDrift({
        baseRef: 'HEAD',
        root: repo,
        format: 'github',
        adapters: builtInDiscoveryAdapters,
      });

      expect(code).toBe(1);
      expect(log.mock.calls.flat().join('\n')).toMatch(
        /::error file=src\/orders\/__contracts__\/OrderPlaced\.approved\.txt,line=1,title=orders\/order\.placed::field `total` \(number\) looks renamed to `amountDue` — breaks Billing/,
      );
    } finally {
      log.mockRestore();
    }
  });
});
