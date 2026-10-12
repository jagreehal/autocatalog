import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runDrift } from '../src/commands/drift';

const here = path.dirname(fileURLToPath(import.meta.url));

const demoRepo = path.resolve(here, '../../../../fixtures/demo-repo');

// The T2 story: scan a repo, break a contract in source, scan again, and the
// drift gate fails naming exactly who it breaks.
describe('ac drift (executable story: the guardrail)', () => {
  let work: string;
  let baseline: string;
  let current: string;

  beforeAll(async () => {
    const { scanRepo } = await import('autocatalog-adapter-zod');
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-drift-story-'));
    baseline = path.join(work, 'baseline-events');
    current = path.join(work, 'current-events');

    // baseline = catalog as extracted from main
    await scanRepo({ root: demoRepo, out: baseline });

    // seed a breaking change: rename settledAt → settledOn in the source copy
    const repoCopy = path.join(work, 'repo');
    await fs.cp(demoRepo, repoCopy, {
      recursive: true,
      filter: (src) => !src.includes('node_modules'),
    });
    const eventsFile = path.join(repoCopy, 'src/payments/payment-events.ts');
    const source = await fs.readFile(eventsFile, 'utf8');
    await fs.writeFile(eventsFile, source.replaceAll('settledAt', 'settledOn'));
    await fs.cp(path.join(demoRepo, 'node_modules'), path.join(repoCopy, 'node_modules'), {
      recursive: true,
    });

    await scanRepo({ root: repoCopy, out: current });
  }, 60000);

  afterAll(async () => {
    await fs.rm(work, { recursive: true, force: true });
  });

  it('fails the gate and names the broken consumers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await runDrift({ base: baseline, current, format: 'markdown' });
    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(exit).toBe(1);
    expect(output).toContain('BREAKING');
    expect(output).toContain('`settledAt`');
    expect(output).toContain('breaks consumers: LedgerService, NotificationService');
  });

  it('passes the gate when nothing drifted', async () => {
    const exit = await runDrift({ base: baseline, current: baseline, quiet: true });
    expect(exit).toBe(0);
  });

  it('passes a breaking change the major version acknowledges, except under a registry strategy', async () => {
    const major = path.join(work, 'major-events');
    await fs.cp(current, major, { recursive: true });
    // Hand-edited, so it is no longer the scanner's artifact.
    await fs.rm(path.join(major, 'autocatalog.artifact.json'));

    for (const file of await fs.readdir(major, { recursive: true })) {
      if (path.basename(file) !== 'autocatalog.json') continue;
      const manifest = JSON.parse(await fs.readFile(path.join(major, file), 'utf8'));
      manifest.version = `${Number(String(manifest.version).split('.')[0]) + 1}.0.0`;
      await fs.writeFile(path.join(major, file), JSON.stringify(manifest));
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await runDrift({ base: baseline, current: major, format: 'markdown' });
    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(exit).toBe(0);
    expect(output).toContain('BREAKING (acknowledged)');
    expect(output).toContain('notify LedgerService, NotificationService before it ships');

    const strict = await runDrift({
      base: baseline,
      current: major,
      compatibility: 'full',
      quiet: true,
    });

    expect(strict).toBe(1);
  });

  it('--snapshot joins runtime drift to the same report and gates', async () => {
    const snapshot = path.join(work, 'snapshot.json');
    const seen = { observedCount: 1, firstSeen: 't0', lastSeen: 't1', producer: 'Checkout' };
    await fs.writeFile(
      snapshot,
      JSON.stringify({
        spec: 'autotel-architecture/v1',
        generatedAt: 't1',
        service: 'checkout',
        events: { 'cart.abandoned': { name: 'cart.abandoned', ...seen } },
      }),
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const passes = await runDrift({ base: baseline, current: baseline, snapshot });

    const gated = await runDrift({
      base: baseline,
      current: baseline,
      snapshot,
      failOn: 'suspicious',
    });

    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();

    expect(passes).toBe(0);
    expect(gated).toBe(1);
    expect(output).toMatch(
      /suspicious +cart\.abandoned: the runtime emitted this event 1 time\(s\) from Checkout/,
    );
    expect(output).toContain('not observed in the runtime snapshot');

    await fs.writeFile(snapshot, '{"spec":"something-else"}');
    await expect(runDrift({ base: baseline, current: baseline, snapshot })).rejects.toThrow(
      /Not an architecture snapshot/,
    );
  });

  it('can be downgraded to report-only with --fail-on never', async () => {
    const exit = await runDrift({ base: baseline, current, failOn: 'never', quiet: true });
    expect(exit).toBe(0);
  });
});
