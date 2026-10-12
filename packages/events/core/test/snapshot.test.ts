import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySnapshot, readSnapshot, type AdapterEvent } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));

const fixtureSnapshot = path.resolve(here, '../../../../fixtures/demo-repo/runtime-snapshot.json');

const event = (id: string, consumers: string[]): AdapterEvent => ({
  id,
  version: '1.0.0',
  name: id,
  summary: '',
  domain: 'demo',
  folderName: id,
  schema: { type: 'object' },
  examples: [],
  meta: { consumers },
  provenance: { default: 'extracted', fields: {} },
});

describe('readSnapshot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-snap-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads the committed fixture', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);
    expect(snapshot.spec).toBe('autotel-architecture/v0');
    expect(Object.keys(snapshot.events).sort()).toEqual([
      'cart.abandoned',
      'order.placed',
      'payment.completed',
    ]);
  });

  // Every rejection here exists because the alternative is silently reporting
  // that nothing was ever observed, which reads as a wall of false findings.
  it('refuses anything that is not recognisably a snapshot', async () => {
    const write = async (name: string, body: string) => {
      const file = path.join(dir, name);
      await fs.writeFile(file, body);

      return file;
    };

    await expect(readSnapshot(path.join(dir, 'missing.json'))).rejects.toThrow(/Could not read/);
    await expect(readSnapshot(await write('bad.json', '{'))).rejects.toThrow(/not valid JSON/);
    await expect(readSnapshot(await write('arr.json', '[]'))).rejects.toThrow(
      /must be a JSON object/,
    );
    await expect(
      readSnapshot(await write('other.json', '{"spec":"something/v1","events":{}}')),
    ).rejects.toThrow(/Not an architecture snapshot/);
    await expect(
      readSnapshot(await write('noevents.json', '{"spec":"autotel-architecture/v0"}')),
    ).rejects.toThrow(/no events object/);
  });
});

describe('applySnapshot', () => {
  it('separates what ran, what never ran, and what nobody documented', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);

    const events = [
      event('payment.completed', ['LedgerService', 'NotificationService']),
      event('invoice.raised', ['BillingService']),
    ];

    const result = applySnapshot(events, snapshot);

    expect(result.observed).toBe(1);
    // Documented, but the runtime never saw it — maintenance paid for nothing.
    expect(result.neverObserved).toEqual(['invoice.raised']);
    // It ran and nobody wrote it down.
    expect(result.undocumented).toEqual(['cart.abandoned', 'order.placed']);
  });

  it('adds a consumer the runtime saw, marked observed rather than asserted', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);
    const payment = event('payment.completed', ['LedgerService', 'NotificationService']);

    applySnapshot([payment], snapshot);

    expect(payment.meta?.consumers).toEqual([
      'LedgerService',
      'NotificationService',
      'FraudService',
    ]);
    expect(payment.provenance?.fields?.consumers).toBe('observed');
    expect(payment.observed?.count).toBe(4210);
    expect(payment.observed?.snapshot.spec).toBe('autotel-architecture/v0');
  });

  it('refuses ambiguous names before changing any event and accepts domain-qualified observations', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);
    const first = event('payment.completed', ['LedgerService']);
    const second = { ...event('payment.completed', ['OtherService']), domain: 'other' };
    expect(() => applySnapshot([first, second], snapshot)).toThrow(/Ambiguous snapshot event/);
    expect(first.observed).toBeUndefined();

    const qualified = {
      ...snapshot,
      events: { 'other/payment.completed': snapshot.events['payment.completed']! },
    };

    const report = applySnapshot([first, second], qualified);
    expect(first.observed).toBeUndefined();
    expect(second.observed?.count).toBe(4210);
    expect(report.neverObserved).toEqual(['demo/payment.completed']);
  });

  it('rejects duplicate qualified and unqualified claims before enrichment', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);
    snapshot.events['demo/payment.completed'] = snapshot.events['payment.completed']!;
    const payment = event('payment.completed', []);
    expect(() => applySnapshot([payment], snapshot)).toThrow(/Duplicate snapshot observation/);
    expect(payment.observed).toBeUndefined();
  });

  it('leaves the declared list alone when the runtime adds nothing', async () => {
    const snapshot = await readSnapshot(fixtureSnapshot);

    const payment = event('payment.completed', [
      'LedgerService',
      'NotificationService',
      'FraudService',
    ]);

    applySnapshot([payment], snapshot);

    expect(payment.provenance?.fields?.consumers).toBeUndefined();
    expect(payment.observed?.consumers).toEqual(['LedgerService', 'FraudService']);
  });
});
