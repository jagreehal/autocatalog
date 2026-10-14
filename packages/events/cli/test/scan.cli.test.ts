import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runScan } from '../src/commands/scan';

const here = path.dirname(fileURLToPath(import.meta.url));

const jsonSchemaRepo = path.resolve(here, '../../../../fixtures/json-schema-repo');

const demoRepo = path.resolve(here, '../../../../fixtures/demo-repo');

describe('runtime evidence', () => {
  let out: string;
  const snapshot = path.resolve(here, '../../../../fixtures/demo-repo/runtime-snapshot.json');

  beforeEach(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cli-runtime-'));
  });
  afterEach(async () => {
    await fs.rm(out, { recursive: true, force: true });
  });

  it('joins what the runtime did onto what the code says', async () => {
    const code = await runScan({
      root: demoRepo,
      out,
      snapshot,
      quiet: true,
      allowCodeExecution: true,
    });

    expect(code).toBe(0);

    const payment = JSON.parse(
      await fs.readFile(path.join(out, 'payments/PaymentCompleted/autocatalog.json'), 'utf8'),
    );

    // Liveness is written into the manifest, so a reader of the committed
    // catalog sees it without re-running anything.
    expect(payment.observed.count).toBe(4210);
    expect(payment.observed.lastSeen).toBe('2026-09-01T08:58:02.000Z');
    expect(payment.observed.snapshot.spec).toBe('autotel-architecture/v0');

    // A consumer only production knew about is added, and marked as such.
    expect(payment.consumers).toContain('FraudService');
    expect(payment.provenance.fields.consumers).toBe('observed');
  });

  it('reports the two findings a static catalog cannot produce', async () => {
    const output: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line) => {
      output.push(String(line));
    });

    try {
      await runScan({ root: demoRepo, out, snapshot, allowCodeExecution: true });
    } finally {
      log.mockRestore();
    }

    const text = output.join('\n');
    expect(text).toContain('declared but never seen');
    // parcel.shipped is in the fixture repo and absent from the snapshot.
    expect(text).toContain('parcel.shipped is documented but the runtime never saw it');
    // cart.abandoned is in the snapshot and absent from the repo.
    expect(text).toContain('cart.abandoned ran but is not in the catalog');
  });

  it('scans exactly as before when no snapshot is given', async () => {
    expect(await runScan({ root: demoRepo, out, quiet: true, allowCodeExecution: true })).toBe(0);

    const payment = JSON.parse(
      await fs.readFile(path.join(out, 'payments/PaymentCompleted/autocatalog.json'), 'utf8'),
    );

    expect(payment.observed).toBeUndefined();
    expect(payment.consumers).not.toContain('FraudService');
  });
});

describe('what a scan leaves in the repository', () => {
  let repo: string;
  let said: string[];

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cli-agents-'));
    await fs.cp(jsonSchemaRepo, repo, { recursive: true });
    said = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('writes the catalog and its llms.txt, and nothing at the repository root', async () => {
    const out = path.join(repo, 'events');
    expect(await runScan({ root: repo, out, quiet: true })).toBe(0);

    const llms = await fs.readFile(path.join(out, 'llms.txt'), 'utf8');
    expect(llms).toContain('refund.issued');
    // The root belongs to the repository: an unasked AGENTS.md is a file the
    // user has to notice, decide about and delete.
    await expect(fs.access(path.join(repo, 'AGENTS.md'))).rejects.toThrow();
  });

  it('refuses a root that is not there, instead of writing an empty catalog', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = path.join(repo, 'events');

    expect(await runScan({ root: path.join(repo, 'typo'), out, quiet: true })).toBe(1);
    expect(error.mock.calls.join(' ')).toMatch(/typo: no such directory/);
    await expect(fs.access(out)).rejects.toThrow();
  });

  it('says what it wrote, where, and whether to commit it', async () => {
    await runScan({ root: repo, out: path.join(repo, 'events') });
    const text = said.join('\n');

    expect(text).toContain('wrote events/');
    expect(text).toContain('events/llms.txt');
    expect(text).toMatch(/commit events\//i);
    // And what happens if they do not.
    expect(text).toMatch(/ac site reads it in place of\s+those/);
    expect(text).toContain('__contracts__/*.approved.txt');
  });

  it('skips the commit advice when the catalog is written outside the repository', async () => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cli-elsewhere-'));

    try {
      await runScan({ root: repo, out });
      const text = said.join('\n');
      expect(text).toContain(`wrote ${out}`);
      expect(text).not.toMatch(/commit/i);
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }
  });
});

describe('runScan multi-source', () => {
  let out: string;

  beforeEach(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cli-scan-'));
  });
  afterEach(async () => {
    await fs.rm(out, { recursive: true, force: true });
  });

  it('discovers raw JSON Schema files', async () => {
    const code = await runScan({ root: jsonSchemaRepo, out, quiet: true });
    expect(code).toBe(0);

    const refund = JSON.parse(
      await fs.readFile(path.join(out, 'payments/RefundIssued/autocatalog.json'), 'utf8'),
    );

    expect(refund.id).toBe('refund.issued');
    expect(refund.version).toBe('1.0.0');
    expect(refund.provenance.default).toBe('extracted');

    const shipment = JSON.parse(
      await fs.readFile(path.join(out, 'shipping/ShipmentDispatched/autocatalog.json'), 'utf8'),
    );

    expect(shipment.id).toBe('shipment.dispatched');
    expect(shipment.name).toBe('Shipment Dispatched');
  });

  it('reports the compiled resource graph after a successful scan', async () => {
    const output: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      output.push(args.map(String).join(' '));
    });

    try {
      const code = await runScan({ root: jsonSchemaRepo, out });
      expect(code).toBe(0);
    } finally {
      log.mockRestore();
    }

    expect(output.join('\n')).toContain('Catalog compiled in');
    expect(output.join('\n')).toMatch(/\d+ resources/);
    expect(output.join('\n')).toMatch(/\d+ relationships/);
  });

  it('still discovers Zod events in the demo repo', async () => {
    const code = await runScan({
      root: demoRepo,
      out,
      quiet: true,
      allowCodeExecution: true,
    });

    expect(code).toBe(0);

    const payment = JSON.parse(
      await fs.readFile(path.join(out, 'payments/PaymentCompleted/autocatalog.json'), 'utf8'),
    );

    expect(payment.id).toBe('payment.completed');
    expect(payment.provenance.default).toBe('extracted');
  });

  it('requires explicit consent before a runtime Adapter can execute repository code', async () => {
    await expect(runScan({ root: demoRepo, out, quiet: true })).rejects.toMatchObject({
      code: 'code_execution_consent_required',
    });
  });
});
