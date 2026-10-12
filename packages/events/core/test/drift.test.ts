import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compatibilityBreaks,
  driftCatalogs,
  renderDriftGitHub,
  renderDriftMarkdown,
  compareSemverish,
  renderVersionChangelog,
  type DriftFinding,
  type DriftReport,
} from '../src/drift';
import type { JsonObject } from '../src/json';
import { UNSAFE_CONSUMER } from '../src/consumes';

let baseDir: string;

let currDir: string;

async function writeEvent(
  root: string,
  domain: string,
  folder: string,
  manifest: JsonObject,
  schema: JsonObject,
): Promise<void> {
  const dir = path.join(root, domain, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'autocatalog.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(dir, 'schema.json'), JSON.stringify(schema));
}

const paymentManifest = {
  id: 'payment.completed',
  version: '1.0.0',
  name: 'Payment Completed',
  summary: 's',
  domain: 'payments',
  consumers: ['LedgerService', 'NotificationService'],
};

const paymentSchema = {
  type: 'object',
  required: ['paymentId', 'amount'],
  properties: {
    paymentId: { type: 'string' },
    amount: { type: 'number' },
    note: { type: 'string' },
  },
};

/** The payment schema without `amount`, the field most cases remove. */
const withoutAmount = (): JsonObject => {
  const { amount: _amount, ...properties } = paymentSchema.properties;

  return { ...paymentSchema, properties };
};

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-base-'));
  currDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-curr-'));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
  await fs.rm(currDir, { recursive: true, force: true });
});

describe('driftCatalogs', () => {
  it('reports no drift for identical catalogs', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    const report = await driftCatalogs(baseDir, currDir);
    expect(report.findings).toEqual([]);
    expect(report.hasBreaking).toBe(false);
  });

  it('classifies a removed field as breaking and names the consumers', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    const mutated = { ...withoutAmount(), required: ['paymentId'] };
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, mutated);

    const report = await driftCatalogs(baseDir, currDir);
    expect(report.hasBreaking).toBe(true);
    const removed = report.findings.find((f) => f.kind === 'field_removed');
    expect(removed?.severity).toBe('breaking');
    expect(removed?.message).toContain('`amount`');
    expect(removed?.consumers).toEqual(['LedgerService', 'NotificationService']);
    // schema changed without a version bump → suspicious
    expect(report.findings.some((f) => f.kind === 'version_unchanged')).toBe(true);
  });

  it('narrows a removed field to the consumers that read it', async () => {
    // AuditService has not said what it reads, so it is assumed to read it all.
    const manifest = {
      ...paymentManifest,
      consumers: [...paymentManifest.consumers, 'AuditService'],
      consumerFields: { LedgerService: ['amount'], NotificationService: ['paymentId'] },
    };

    await writeEvent(baseDir, 'payments', 'PaymentCompleted', manifest, paymentSchema);
    const mutated = { ...withoutAmount(), required: ['paymentId'] };
    await writeEvent(currDir, 'payments', 'PaymentCompleted', manifest, mutated);

    // An agent declaring its fields in its own catalog is sorted the same way.
    const report = await driftCatalogs(baseDir, currDir, {
      consumersOf: () => ['agent/refunds'],
      consumerFieldsOf: () => ({ 'agent/refunds': ['paymentId'] }),
    });

    const removed = report.findings.find((f) => f.kind === 'field_removed');
    expect(removed?.consumers).toEqual(['LedgerService', 'AuditService']);
    expect(removed?.usage).toEqual({
      reads: ['LedgerService'],
      unspecified: ['AuditService'],
      unaffected: ['NotificationService', 'agent/refunds'],
    });
    expect(renderDriftMarkdown(report)).toContain(
      '(reads it: LedgerService; fields undeclared or invalid: AuditService; not affected: NotificationService, agent/refunds)',
    );
    // An unbumped version breaks no one by itself: it names who the changes reach.
    const unbumped = report.findings.find((f) => f.kind === 'version_unchanged');
    expect(unbumped?.consumers).toEqual(['LedgerService', 'AuditService']);
    expect(unbumped?.usage).toBeUndefined();
  });

  it('treats a consumer that dropped its field declaration as unspecified again', async () => {
    // The baseline said LedgerService reads only paymentId; the change removes
    // that declaration along with amount, so LedgerService may now read anything.
    const declared = { ...paymentManifest, consumerFields: { LedgerService: ['paymentId'] } };

    await writeEvent(baseDir, 'payments', 'PaymentCompleted', declared, paymentSchema);
    const mutated = { ...withoutAmount(), required: ['paymentId'] };
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, mutated);

    const report = await driftCatalogs(baseDir, currDir);
    const removed = report.findings.find((f) => f.kind === 'field_removed');

    expect(removed?.consumers).toEqual(['LedgerService', 'NotificationService']);
    expect(removed?.usage?.unaffected ?? []).toEqual([]);
  });

  it('classifies new optional fields as additive with no blast radius', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);

    const widened = {
      ...paymentSchema,
      properties: { ...paymentSchema.properties, currency: { type: 'string' } },
    };

    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      { ...paymentManifest, version: '1.1.0' },
      widened,
    );

    const report = await driftCatalogs(baseDir, currDir);
    expect(report.hasBreaking).toBe(false);
    const added = report.findings.find((f) => f.kind === 'field_added');
    expect(added?.severity).toBe('additive');
    expect(added?.consumers).toEqual([]);
    expect(report.findings.some((f) => f.kind === 'version_unchanged')).toBe(false);
  });

  it('does not name consumers as broken when an unbumped change is only additive', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);

    const widened = {
      ...paymentSchema,
      properties: { ...paymentSchema.properties, currency: { type: 'string' } },
    };

    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, widened);

    const report = await driftCatalogs(baseDir, currDir);
    const unbumped = report.findings.find((f) => f.kind === 'version_unchanged');
    expect(unbumped?.severity).toBe('suspicious');
    expect(unbumped?.consumers).toEqual([]);
    expect(renderDriftGitHub(report)).not.toContain('breaks');
  });

  it('flags removed and added events', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(
      currDir,
      'orders',
      'OrderPlaced',
      { ...paymentManifest, id: 'order.placed', domain: 'orders' },
      paymentSchema,
    );

    const report = await driftCatalogs(baseDir, currDir);
    expect(report.findings.find((f) => f.kind === 'event_removed')?.severity).toBe('breaking');
    expect(report.findings.find((f) => f.kind === 'event_added')?.severity).toBe('additive');
  });

  it('treats a narrowed enum as breaking and a widened one as additive', async () => {
    const withEnum = {
      type: 'object',
      properties: { carrier: { type: 'string', enum: ['ups', 'dhl'] } },
    };

    const narrowed = {
      type: 'object',
      properties: { carrier: { type: 'string', enum: ['ups'] } },
    };

    await writeEvent(baseDir, 'x', 'E', { ...paymentManifest, id: 'e', domain: 'x' }, withEnum);
    await writeEvent(currDir, 'x', 'E', { ...paymentManifest, id: 'e', domain: 'x' }, narrowed);
    const report = await driftCatalogs(baseDir, currDir);
    expect(report.findings.find((f) => f.kind === 'enum_narrowed')?.severity).toBe('breaking');
  });

  it('reports who sends, receives and owns an event, without failing a compatibility gate', async () => {
    await writeEvent(
      baseDir,
      'payments',
      'PaymentCompleted',
      { ...paymentManifest, producers: ['Checkout'], owner: { team: 'payments' } },
      paymentSchema,
    );

    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      {
        ...paymentManifest,
        producers: ['Billing'],
        consumers: ['LedgerService', 'AuditService'],
        owner: { team: 'finance' },
      },
      paymentSchema,
    );

    const report = await driftCatalogs(baseDir, currDir);

    expect(report.findings.map((f) => [f.kind, f.severity, f.message])).toEqual([
      ['producer_removed', 'suspicious', 'producer `Checkout` no longer sends this event'],
      ['producer_added', 'info', 'producer `Billing` now sends this event'],
      ['consumer_removed', 'info', 'consumer `NotificationService` no longer receives this event'],
      ['consumer_added', 'info', 'consumer `AuditService` now receives this event'],
      ['owner_changed', 'info', 'owner changed: payments → finance'],
    ]);

    // Consumers of an event whose producer left are the ones to tell.
    expect(report.findings[0]?.consumers).toEqual(['LedgerService', 'NotificationService']);
    expect(report.hasBreaking).toBe(false);
    expect(compatibilityBreaks(report, 'full')).toEqual([]);
    expect(renderDriftMarkdown(report)).toContain('no longer sends this event');
  });
});

describe('renames', () => {
  type Schema = { type: string; required: string[]; properties: Record<string, { type: string }> };

  const renamed = (from: string, to: string, schema: Schema = paymentSchema): Schema => {
    const { [from]: moved = { type: 'string' }, ...properties } = schema.properties;

    return {
      ...schema,
      required: schema.required.map((name) => (name === from ? to : name)),
      properties: { ...properties, [to]: moved },
    };
  };

  it('reports one removed and one added field of the same type as one rename', async () => {
    const manifest = { ...paymentManifest, consumerFields: { NotificationService: ['paymentId'] } };
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', manifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', manifest, renamed('amount', 'total'));

    const report = await driftCatalogs(baseDir, currDir);
    const changes = report.findings.filter((f) => f.diff || f.rename);

    expect(changes.map((f) => [f.kind, f.severity])).toEqual([['field_renamed', 'breaking']]);
    expect(changes[0]).toMatchObject({
      message: 'field `amount` (number) looks renamed to `total`',
      rename: { from: 'amount', to: 'total' },
      consumers: ['LedgerService'],
    });
    // A rename is a removal plus an addition to a registry, whatever it is called.
    expect(compatibilityBreaks(report, 'backward').length).toBeGreaterThan(0);
    expect(compatibilityBreaks(report, 'forward').length).toBeGreaterThan(0);
  });

  it('keeps separate findings when the types differ or more than one field moved', async () => {
    const { amount: _amount, ...kept } = paymentSchema.properties;
    const retyped = { ...paymentSchema, properties: { ...kept, total: { type: 'string' } } };

    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, retyped);
    const report = await driftCatalogs(baseDir, currDir);

    expect(report.findings.some((f) => f.kind === 'field_renamed')).toBe(false);
    expect(report.findings.some((f) => f.kind === 'field_removed')).toBe(true);

    const two = renamed('note', 'memo', renamed('paymentId', 'id'));
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, two);
    const both = await driftCatalogs(baseDir, currDir);

    expect(both.findings.some((f) => f.kind === 'field_renamed')).toBe(false);
  });
});

describe('acknowledging a breaking change', () => {
  const versioned = (version: string) => ({ ...paymentManifest, version });

  it('tells the author how to land it: keep the field, or bump the major version', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, withoutAmount());
    const report = await driftCatalogs(baseDir, currDir);
    const removed = report.findings.find((f) => f.kind === 'field_removed');

    expect(removed?.acknowledged).toBeUndefined();
    expect(removed?.advice).toBe(
      'Next: keep `amount` (mark it deprecated) until consumers move off it, or bump to 2.0.0 to mark it intentional and notify LedgerService, NotificationService',
    );
    expect(report.hasBreaking).toBe(true);
    expect(renderDriftGitHub(report)).toContain('NotificationService. Next: keep `amount`');
  });

  it('accepts a major bump: still reported with who to tell, but not gated', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', versioned('2.0.0'), withoutAmount());
    const report = await driftCatalogs(baseDir, currDir);
    const removed = report.findings.find((f) => f.kind === 'field_removed');

    expect(removed).toMatchObject({ severity: 'breaking', acknowledged: true });
    expect(removed?.advice).toBe(
      'Acknowledged by the major bump 1.0.0 → 2.0.0: notify LedgerService, NotificationService before it ships',
    );
    expect(report).toMatchObject({ breaking: 1, acknowledged: 1, hasBreaking: false });
    expect(renderDriftGitHub(report)).toMatch(/^::warning .*was removed/m);
    expect(renderDriftMarkdown(report)).toContain('**1 breaking** (1 acknowledged)');
    // A registry strategy is a different promise and a version does not change it.
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(1);
  });

  it('counts an EventCatalog V-integer increase as a major bump', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', versioned('V1'), paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', versioned('V2'), withoutAmount());

    expect((await driftCatalogs(baseDir, currDir)).hasBreaking).toBe(false);
  });

  it('says a minor bump is not enough, and which version would be', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', versioned('1.1.0'), withoutAmount());
    const report = await driftCatalogs(baseDir, currDir);

    expect(report.hasBreaking).toBe(true);
    expect(report.findings.find((f) => f.kind === 'field_removed')?.advice).toContain(
      'or bump to 2.0.0 (1.1.0 is not a major bump) to mark it intentional',
    );
  });
});

describe('source lines', () => {
  it('annotates the line of the changed field in a JSON Schema contract', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-src-'));
    const file = 'contracts/payment.json';
    const traced = { ...paymentManifest, source: { type: 'code', file, symbol: 'payment.json' } };
    const current = { ...withoutAmount(), required: ['paymentId'] };
    await fs.mkdir(path.join(source, 'contracts'));
    await fs.writeFile(path.join(source, file), JSON.stringify(current, null, 2));
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', traced, paymentSchema);
    await writeEvent(currDir, 'payments', 'PaymentCompleted', traced, current);

    const report = await driftCatalogs(baseDir, currDir, { sourceRoot: source });
    await fs.rm(source, { recursive: true, force: true });

    // `amount` is gone, so the line is its parent's `properties`.
    expect(report.findings.find((f) => f.kind === 'field_removed')?.source).toEqual({
      file,
      line: 6,
    });
  });
});

describe('renderDriftMarkdown', () => {
  it('leads with breaking counts and names consumers', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    const mutated = withoutAmount();
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, mutated);

    const md = renderDriftMarkdown(await driftCatalogs(baseDir, currDir));
    expect(md).toContain('# Contract drift');
    expect(md).toContain('BREAKING');
    expect(md).toContain('breaks consumers: LedgerService, NotificationService');
  });

  it('says so when there is nothing to report', () => {
    expect(
      renderDriftMarkdown({
        findings: [],
        breaking: 0,
        suspicious: 0,
        additive: 0,
        acknowledged: 0,
        hasBreaking: false,
      }),
    ).toContain('No contract drift');
  });
});

describe('compatibilityBreaks', () => {
  const finding = (kind: DriftFinding['kind'], diff?: DriftFinding['diff']): DriftReport => ({
    findings: [
      { domain: 'x', eventId: 'e', severity: 'breaking', kind, message: '', consumers: [], diff },
    ],
    breaking: 1,
    suspicious: 0,
    additive: 0,
    acknowledged: 0,
    hasBreaking: true,
  });

  it('fails BACKWARD when a field becomes required, and passes FORWARD', () => {
    const report = finding('required_added');
    expect(compatibilityBreaks(report, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(0);
    expect(compatibilityBreaks(report, 'full')).toHaveLength(1);
  });

  it('fails FORWARD when a field stops being required, and passes BACKWARD', () => {
    const report = finding('required_removed');
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(1);
    expect(compatibilityBreaks(report, 'backward')).toHaveLength(0);
  });

  it('separates a removed required field from a removed optional one', () => {
    const required = finding('field_removed', {
      kind: 'removed',
      path: 'amount',
      detail: 'number',
      wasRequired: true,
    });

    const optional = finding('field_removed', {
      kind: 'removed',
      path: 'note',
      detail: 'string',
      wasRequired: false,
    });

    expect(compatibilityBreaks(required, 'forward')).toHaveLength(1);

    // This once asserted that removing an optional field was compatible under
    // both strategies. A validator disagrees: with the definition gone and the
    // object still open, a new producer may send `note` as a number, and a
    // reader built from the old schema rejects it. Optional means "sometimes
    // absent", not "any value".
    expect(compatibilityBreaks(optional, 'forward')).toHaveLength(1);

    // Closing the object is what actually removes the field from new payloads.
    const optionalClosed = finding('field_removed', {
      kind: 'removed',
      path: 'note',
      detail: 'string',
      wasRequired: false,
      containerClosedAfter: true,
    });

    expect(compatibilityBreaks(optionalClosed, 'forward')).toHaveLength(0);
  });

  it('fails both strategies on a type change', () => {
    const report = finding('type_changed');
    expect(compatibilityBreaks(report, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(report, 'forward')).toHaveLength(1);
  });

  // Compatibility is decided from the value sets on the diff, not from the
  // kind: a kind can only name one direction, and an enum change is routinely
  // both.
  const enumDiff = (added: unknown[], removed: unknown[]): DriftFinding['diff'] => ({
    kind: 'enum_changed',
    path: 'status',
    detail: '',
    enumAdded: added,
    enumRemoved: removed,
  });

  it('splits enum narrowing from widening', () => {
    const narrowed = finding('enum_narrowed', enumDiff([], ['b']));
    expect(compatibilityBreaks(narrowed, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(narrowed, 'forward')).toHaveLength(0);

    const widened = finding('enum_widened', enumDiff(['c'], []));
    expect(compatibilityBreaks(widened, 'forward')).toHaveLength(1);
    expect(compatibilityBreaks(widened, 'backward')).toHaveLength(0);
  });

  it('fails both strategies when an enum both loses and gains values', () => {
    // ["a","b"] → ["b","c"]: an old reader rejects "c", a new reader rejects "a".
    const mixed = finding('enum_narrowed', enumDiff(['c'], ['a']));
    expect(compatibilityBreaks(mixed, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(mixed, 'forward')).toHaveLength(1);
    expect(compatibilityBreaks(mixed, 'full')).toHaveLength(1);
  });

  it('gates a tightened constraint under BACKWARD and FULL', () => {
    const tightened = finding('constraint_tightened', {
      kind: 'constraint_changed',
      path: 'amountMinor',
      detail: 'minimum 0 → 100',
      constraint: { keyword: 'minimum', previous: 0, current: 100, direction: 'tightened' },
    });

    expect(compatibilityBreaks(tightened, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(tightened, 'full')).toHaveLength(1);
    expect(compatibilityBreaks(tightened, 'forward')).toHaveLength(0);
  });

  it('gates an ambiguous constraint under both, because it could be either', () => {
    const changed = finding('constraint_changed', {
      kind: 'constraint_changed',
      path: 'ref',
      detail: 'pattern "^a" → "^b"',
      constraint: { keyword: 'pattern', previous: '^a', current: '^b', direction: 'changed' },
    });

    expect(compatibilityBreaks(changed, 'backward')).toHaveLength(1);
    expect(compatibilityBreaks(changed, 'forward')).toHaveLength(1);
  });

  it('gates nothing under none', () => {
    expect(compatibilityBreaks(finding('type_changed'), 'none')).toHaveLength(0);
  });
});

describe('renderDriftGitHub', () => {
  it('annotates the defining source file when the scanner traced one', async () => {
    const traced = {
      ...paymentManifest,
      source: { type: 'code', file: 'src/events/payment.ts', line: 12 },
    };

    await writeEvent(baseDir, 'payments', 'PaymentCompleted', traced, paymentSchema);
    const mutated = withoutAmount();
    await writeEvent(currDir, 'payments', 'PaymentCompleted', traced, mutated);

    const out = renderDriftGitHub(await driftCatalogs(baseDir, currDir));
    const breaking = out.split('\n')[0]!;
    expect(breaking).toContain('::error file=src/events/payment.ts,line=12,');
    expect(breaking).toContain('title=payments/payment.completed');
    expect(breaking).toContain('breaks LedgerService, NotificationService');
  });

  it('falls back to a job-level annotation when no source is known', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    const mutated = withoutAmount();
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, mutated);

    const out = renderDriftGitHub(await driftCatalogs(baseDir, currDir));
    expect(out).toContain('::error title=payments/payment.completed::');
    expect(out).not.toContain('file=');
  });

  it('escapes delimiters so a message cannot end its own annotation', () => {
    const out = renderDriftGitHub({
      findings: [
        {
          domain: 'x',
          eventId: 'e',
          severity: 'breaking',
          kind: 'field_removed',
          message: 'line one\nline two: 100%',
          consumers: [],
          source: { file: 'a,b.ts' },
        },
      ],
      breaking: 1,
      suspicious: 0,
      additive: 0,
      acknowledged: 0,
      hasBreaking: true,
    });

    expect(out.split('\n')).toHaveLength(1);
    expect(out).toContain('file=a%2Cb.ts');
    expect(out).toContain('line one%0Aline two: 100%25');
  });

  it('emits nothing for a clean report', () => {
    expect(
      renderDriftGitHub({
        findings: [],
        breaking: 0,
        suspicious: 0,
        additive: 0,
        acknowledged: 0,
        hasBreaking: false,
      }),
    ).toBe('');
  });
});

describe('renderVersionChangelog', () => {
  it('renders plain-language bullets between versions', () => {
    const out = renderVersionChangelog({
      eventId: 'payments/payment.completed',
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      fromSchema: { type: 'object', properties: { amount: { type: 'string' } } },
      toSchema: { type: 'object', properties: { amount: { type: 'number' } } },
    });

    expect(out).toContain('0.9.0 → 1.0.0');
    expect(out).toContain('changed type: string → number');
  });
});

describe('compareSemverish', () => {
  it('orders EventCatalog V-prefixed integer versions numerically', () => {
    expect(['V10', 'V2', 'v1'].sort(compareSemverish)).toEqual(['v1', 'V2', 'V10']);
  });

  it('ignores build metadata when ordering', () => {
    expect(['1.2.1', '1.2.0+build.7', '1.0.0-rc.1+sha.5'].sort(compareSemverish)).toEqual([
      '1.0.0-rc.1+sha.5',
      '1.2.0+build.7',
      '1.2.1',
    ]);
    expect(compareSemverish('1.2.0+a', '1.2.0+b')).toBe(0);
  });

  it('puts a prerelease before its release', () => {
    const versions = ['1.0.0', '1.0.0-beta.10', '0.9.0', '1.0.0-beta.2', '1.0.0-alpha'];
    expect(versions.sort(compareSemverish)).toEqual([
      '0.9.0',
      '1.0.0-alpha',
      '1.0.0-beta.2',
      '1.0.0-beta.10',
      '1.0.0',
    ]);
  });
});

describe('runtime drift against a snapshot', () => {
  const observation = (name: string, fieldPaths: string[]) => ({
    name,
    observedCount: 3,
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-01-02T00:00:00Z',
    producer: 'PaymentService',
    fieldPaths,
  });

  const snapshot = {
    spec: 'autotel-architecture/v1',
    generatedAt: '2026-01-02T00:00:00Z',
    service: 'payment-service',
    events: {
      'payment.completed': observation('payment.completed', ['amount', 'couponCode', 'paymentId']),
      'payment.flagged': observation('payment.flagged', ['paymentId']),
    },
  };

  const refunded = { ...paymentManifest, id: 'payment.refunded', name: 'Payment Refunded' };

  beforeEach(async () => {
    for (const root of [baseDir, currDir]) {
      await writeEvent(root, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
      await writeEvent(root, 'payments', 'PaymentRefunded', refunded, paymentSchema);
    }
  });

  it('joins the schema report: undocumented events and undeclared fields are suspicious, unseen ones info', async () => {
    const report = await driftCatalogs(baseDir, currDir, { snapshot });

    expect(
      report.findings.map(({ domain, eventId, severity, kind }) => ({
        domain,
        eventId,
        severity,
        kind,
      })),
    ).toEqual([
      {
        domain: '',
        eventId: 'payment.flagged',
        severity: 'suspicious',
        kind: 'event_undocumented',
      },
      {
        domain: 'payments',
        eventId: 'payment.completed',
        severity: 'suspicious',
        kind: 'field_undeclared',
      },
      {
        domain: 'payments',
        eventId: 'payment.refunded',
        severity: 'info',
        kind: 'event_unobserved',
      },
    ]);
    expect(report.findings[1]!.message).toContain('`couponCode`');
    expect(report.suspicious).toBe(2);
    expect(report.hasBreaking).toBe(false);
    // Runtime evidence is not a schema change: no registry strategy fails on it.
    expect(compatibilityBreaks(report, 'full')).toEqual([]);
  });

  it('names the consumers the snapshot saw, beside the ones declared', async () => {
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, withoutAmount());

    const report = await driftCatalogs(baseDir, currDir, {
      snapshot: {
        ...snapshot,
        events: {
          'payment.completed': {
            ...observation('payment.completed', ['paymentId']),
            consumers: ['FraudService', 'LedgerService'],
            consumerEvidence: 'observed' as const,
          },
          'payment.refunded': {
            ...observation('payment.refunded', ['paymentId']),
            consumers: ['AuditService'],
            consumerEvidence: 'reported' as const,
          },
        },
      },
    });

    const removed = report.findings.find((finding) => finding.kind === 'field_removed');

    // LedgerService is declared already, so it is named once, as declared.
    expect(removed?.consumers).toEqual([
      'LedgerService',
      'NotificationService',
      'FraudService (seen at runtime)',
    ]);
  });

  it('counts a runtime consumer whose name could inject into a report under a safe label', async () => {
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, withoutAmount());

    const report = await driftCatalogs(baseDir, currDir, {
      snapshot: {
        ...snapshot,
        events: {
          'payment.completed': {
            ...observation('payment.completed', ['paymentId']),
            consumers: ['FraudService', '![x](https://evil/pixel)'],
          },
        },
      },
    });

    const removed = report.findings.find((finding) => finding.kind === 'field_removed');

    expect(removed?.consumers).toContain('FraudService (reported at runtime)');
    expect(removed?.consumers).toContain(`${UNSAFE_CONSUMER} (reported at runtime)`);
    expect(removed?.consumers.join(' ')).not.toContain('evil');
  });

  it('never lets another source narrow what a consumer the event lists reads', async () => {
    await writeEvent(currDir, 'payments', 'PaymentCompleted', paymentManifest, withoutAmount());

    const report = await driftCatalogs(baseDir, currDir, {
      consumersOf: () => ['LedgerService'],
      // Another repository claims LedgerService reads only `note`.
      consumerFieldsOf: () => ({ LedgerService: ['note'] }),
    });

    const removed = report.findings.find((finding) => finding.kind === 'field_removed');

    expect(removed?.consumers).toContain('LedgerService');
    expect(removed?.usage?.unaffected ?? []).not.toContain('LedgerService');
  });

  it('keeps the baseline consumer list when the change drops a consumer from it', async () => {
    // The same pull request removes LedgerService from the list and the field.
    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      { ...paymentManifest, consumers: ['NotificationService'] },
      withoutAmount(),
    );

    const report = await driftCatalogs(baseDir, currDir, {
      consumerFieldsOf: () => ({ LedgerService: ['note'] }),
    });

    const removed = report.findings.find((finding) => finding.kind === 'field_removed');

    expect(removed?.usage?.unaffected ?? []).not.toContain('LedgerService');
  });

  it('says a consumer only reported in message metadata is not proof of delivery', async () => {
    await writeEvent(currDir, 'payments', 'PaymentRefunded', refunded, withoutAmount());

    const report = await driftCatalogs(baseDir, currDir, {
      snapshot: {
        ...snapshot,
        events: {
          'payment.refunded': {
            ...observation('payment.refunded', ['paymentId']),
            consumers: ['AuditService'],
          },
        },
      },
    });

    const removed = report.findings.find(
      (finding) => finding.kind === 'field_removed' && finding.eventId === 'payment.refunded',
    );

    expect(removed?.consumers).toContain('AuditService (reported at runtime)');
  });

  it('renders an undocumented event without an empty domain', async () => {
    const report = await driftCatalogs(baseDir, currDir, { snapshot });

    expect(renderDriftMarkdown(report)).toContain('## payment.flagged\n');
    expect(renderDriftGitHub(report)).toContain('::warning title=payment.flagged::');
  });
});

describe('delivery guarantees', () => {
  const delivered = (delivery: JsonObject, version = '1.0.0') => ({
    ...paymentManifest,
    version,
    delivery,
  });

  const promise = {
    guarantee: 'at-least-once',
    orderingKey: 'paymentId',
    idempotencyKey: 'paymentId',
  };

  it('fails a change to what consumers were promised about delivery, naming them', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', delivered(promise), paymentSchema);
    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ guarantee: 'at-most-once', orderingKey: 'paymentId' }),
      paymentSchema,
    );

    const report = await driftCatalogs(baseDir, currDir);
    const delivery = report.findings.filter((f) => f.kind === 'delivery_changed');

    expect(delivery.map((f) => [f.severity, f.message])).toEqual([
      ['breaking', 'delivery guarantee changed: at-least-once → at-most-once'],
      ['breaking', 'idempotency key removed: consumers can no longer deduplicate on paymentId'],
    ]);
    expect(delivery[0]?.consumers).toEqual(['LedgerService', 'NotificationService']);
    expect(report.hasBreaking).toBe(true);
    // The payload is unchanged, so a schema-registry strategy has nothing to say.
    expect(compatibilityBreaks(report, 'full')).toEqual([]);
    expect(delivery[0]?.advice).toContain('2.0.0');
  });

  it('treats a new promise as additive', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', paymentManifest, paymentSchema);
    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ orderingKey: 'paymentId' }),
      paymentSchema,
    );

    const report = await driftCatalogs(baseDir, currDir);

    expect(report.findings.map((f) => [f.kind, f.severity, f.message])).toEqual([
      ['delivery_changed', 'additive', 'ordering key added: paymentId'],
    ]);
    // Nobody can be broken by a promise they were not relying on yet.
    expect(report.findings[0]?.consumers).toEqual([]);
  });

  it('accepts a changed promise that comes with a major version', async () => {
    await writeEvent(baseDir, 'payments', 'PaymentCompleted', delivered(promise), paymentSchema);
    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ ...promise, orderingKey: 'amount' }, '2.0.0'),
      paymentSchema,
    );

    const report = await driftCatalogs(baseDir, currDir);

    expect(report.findings.find((f) => f.kind === 'delivery_changed')).toMatchObject({
      severity: 'breaking',
      message: 'ordering key changed: paymentId → amount',
      acknowledged: true,
    });
    expect(report.hasBreaking).toBe(false);
  });

  it('fails a longer maximum lateness and accepts a shorter one', async () => {
    await writeEvent(
      baseDir,
      'payments',
      'PaymentCompleted',
      delivered({ maxLateness: 'PT5M' }),
      paymentSchema,
    );
    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ maxLateness: 'PT1H' }),
      paymentSchema,
    );

    const later = await driftCatalogs(baseDir, currDir);

    expect(later.findings.map((f) => [f.kind, f.severity, f.message])).toEqual([
      ['delivery_changed', 'breaking', 'maximum lateness lengthened: PT5M → PT1H'],
    ]);

    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ maxLateness: 'PT300S' }),
      paymentSchema,
    );
    expect((await driftCatalogs(baseDir, currDir)).findings).toEqual([]);

    await writeEvent(
      currDir,
      'payments',
      'PaymentCompleted',
      delivered({ maxLateness: 'PT1M' }),
      paymentSchema,
    );
    expect(
      (await driftCatalogs(baseDir, currDir)).findings.map((f) => [f.severity, f.message]),
    ).toEqual([['additive', 'maximum lateness shortened: PT5M → PT1M']]);

    await writeEvent(currDir, 'payments', 'PaymentCompleted', delivered({}), paymentSchema);
    expect(
      (await driftCatalogs(baseDir, currDir)).findings.map((f) => [f.severity, f.message]),
    ).toEqual([['breaking', 'maximum lateness removed (was PT5M)']]);
  });

  it('fails a change to the correlation key, since tracing follows it', async () => {
    await writeEvent(
      baseDir,
      'payments',
      'PaymentCompleted',
      delivered({ correlationKey: 'paymentId' }),
      paymentSchema,
    );
    await writeEvent(currDir, 'payments', 'PaymentCompleted', delivered({}), paymentSchema);

    expect(
      (await driftCatalogs(baseDir, currDir)).findings.map((f) => [f.severity, f.message]),
    ).toEqual([['breaking', 'correlation key removed: traces can no longer follow paymentId']]);
  });
});
