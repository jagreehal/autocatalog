import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compareDeployment } from '../src/commands/delivery';
import { runDrift } from '../src/commands/drift';
import { runScan } from '../src/commands/scan';

const here = path.dirname(fileURLToPath(import.meta.url));

const fixture = path.resolve(here, '../../../../fixtures/delivery-rabbitmq');

const DEFINITIONS = 'infrastructure/rabbitmq/definitions.json';

describe('ac drift between two saved artifacts', () => {
  let work: string;

  beforeAll(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-delivery-artifacts-'));

    for (const side of ['base', 'current'])
      await fs.cp(fixture, path.join(work, side), { recursive: true });

    const changed = path.join(work, 'current', DEFINITIONS);

    await fs.writeFile(
      changed,
      (await fs.readFile(changed, 'utf8')).replace('"currency": "GBP"', '"currency": "EUR"'),
    );

    // Artifacts kept apart from their source trees, as CI saves them.
    for (const side of ['base', 'current'])
      await runScan({
        root: path.join(work, side),
        out: path.join(work, 'artifacts', side),
        quiet: true,
      });
  }, 60000);

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('carries the consumer declarations in each artifact and checks delivery from them', async () => {
    const output: string[] = [];

    const log = vi
      .spyOn(console, 'log')
      .mockImplementation((line: string) => void output.push(line));

    const code = await runDrift({
      base: path.join(work, 'artifacts/base'),
      current: path.join(work, 'artifacts/current'),
      format: 'json',
    });

    log.mockRestore();

    expect(await fs.readdir(path.join(work, 'artifacts/base'))).toContain(
      'autocatalog.consumes.json',
    );
    expect(code).toBe(1);
    expect(JSON.parse(output.join('\n')).findings).toContainEqual(
      expect.objectContaining({ kind: 'delivery_route_lost', consumers: ['LedgerService'] }),
    );
  });
});

describe('compareDeployment', () => {
  const definitions = async () =>
    JSON.parse(await fs.readFile(path.join(fixture, DEFINITIONS), 'utf8'));

  it('fails a queue whose deployed delivery limit differs from the declared one', async () => {
    const { rabbitMqGraph } = await import('autocatalog-core');
    const declared = await definitions();
    const deployed = structuredClone(declared);

    declared.queues[0].arguments = {
      ...declared.queues[0].arguments,
      'x-queue-type': 'quorum',
      'x-delivery-limit': 3,
    };
    deployed.queues[0].arguments = {
      ...deployed.queues[0].arguments,
      'x-queue-type': 'quorum',
      'x-delivery-limit': 1,
    };

    const results = compareDeployment(
      rabbitMqGraph(declared, { file: DEFINITIONS }),
      rabbitMqGraph(deployed, { file: 'deployed' }),
    );

    expect(results).toContainEqual(
      expect.objectContaining({
        status: 'FAIL',
        check: 'queue ledger.payments has delivery limit 1 deployed, 3 declared',
      }),
    );
  });

  it('compares only RabbitMQ routes with a RabbitMQ deployment', async () => {
    const { rabbitMqGraph, scanArchitecture, composeResourceGraphs } =
      await import('autocatalog-core');

    const rabbit = rabbitMqGraph(await definitions(), { file: DEFINITIONS });

    const aws = (
      await scanArchitecture({ root: path.resolve(fixture, '../delivery-aws'), publish: false })
    ).graph;

    const results = compareDeployment(composeResourceGraphs(rabbit, aws), rabbit);

    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
  });
});

describe('a failed scan', () => {
  it("leaves the previous artifact's consumer declarations as they were", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-delivery-failed-'));
    const repo = path.join(work, 'repo');
    const out = path.join(work, 'artifact');

    await fs.cp(fixture, repo, { recursive: true });
    expect(await runScan({ root: repo, out, quiet: true })).toBe(0);

    const before = await fs.readFile(path.join(out, 'autocatalog.consumes.json'), 'utf8');
    const consumes = path.join(repo, 'autocatalog.consumes.json');
    const declared = JSON.parse(await fs.readFile(consumes, 'utf8'));

    declared.consumes[0].recovery = 'PT4H';
    await fs.writeFile(consumes, JSON.stringify(declared));
    await fs.writeFile(path.join(repo, 'contracts/events/payment.completed.json'), '{ not json');

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await runScan({ root: repo, out, quiet: true });

    error.mockRestore();

    expect(code).toBe(1);
    expect(await fs.readFile(path.join(out, 'autocatalog.consumes.json'), 'utf8')).toBe(before);
    await fs.rm(work, { recursive: true, force: true });
  });
});

describe('Mailbox', () => {
  it('stops draining at its deadline when a dead-letter cycle keeps the queue full', async () => {
    const { Mailbox } = await import('../src/commands/delivery');
    // A queue that hands the same rejected message back on every call.

    const cycling = {
      get: async () => null,
      post: async () => [{ properties: { correlation_id: 'looping' }, redelivered: true }],
    };

    const started = Date.now();

    await new Mailbox(cycling, started).take(
      '/',
      'ledger.payments',
      'reject_requeue_false',
      started + 50,
    );

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
