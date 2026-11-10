import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFlows, stormBoard, stormWarnings } from 'autocatalog-docs-core';
import { Effect, Layer } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { draftFlow, EffectAnalyzer, factOf, runFlowsDraft } from '../src/commands/flows-draft';

const fixture = path.join(import.meta.dirname, 'fixtures', 'effect-import');

afterEach(() => {
  vi.restoreAllMocks();
});

const draft = async (program: string, file = 'src/import.ts') => {
  let printed = '';

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    printed += String(chunk);

    return true;
  });

  const code = await runFlowsDraft({ file, program, root: fixture, write: false, force: false });

  vi.restoreAllMocks();

  return { code, printed };
};

it('names the fact a step records, in the past tense', () => {
  expect(factOf('loadImport')).toBe('Import loaded');
  expect(factOf('findSupplier')).toBe('Supplier found');
  expect(factOf('parseFile')).toBe('File parsed');
  expect(factOf('applyDiscount')).toBe('Discount applied');
  expect(factOf('import')).toBe('Import completed');
});

it('drafts a board from an Effect program: a stage per step, a failure per error', async () => {
  const { code, printed } = await draft('runImport');

  expect(code).toBe(0);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-flows-draft-'));

  try {
    await fs.mkdir(path.join(root, 'flows'));
    await fs.writeFile(path.join(root, 'flows', 'catalogue-import.md'), printed);

    const { flows, failures } = readFlows([{ repository: 'imports', dir: root }], {
      resources: [],
      relationships: [],
    });

    expect(failures).toEqual([]);

    const board = stormBoard(flows[0]!);

    expect(board.columns.map(({ stage }) => stage)).toEqual([
      'Load import',
      'Resolve supplier',
      'Download file',
      'Parse file',
      'Ingest product',
      'Finish import',
    ]);
    expect(board.columns[0]!.rows.who.map(({ text }) => text)).toEqual(['Imports']);
    expect(board.columns[4]).toMatchObject({ repeats: 'once per item in parsed' });

    // Errors the program catches carry on; the four it lets escape have no policy.
    expect(board.columns[4]!.rows.policy.map(({ text }) => text)).toEqual([
      'Whenever OutsideSalesRegion is caught, carry on with the next one',
      'Whenever ProductIngestFailed is caught, carry on with the next one',
    ]);
    expect(board.hotspots.map(({ step }) => step)).toEqual([
      'import-not-found',
      'supplier-not-found',
      'file-missing',
      'file-unreadable',
    ]);
    expect(stormWarnings(flows)).toHaveLength(4);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);

it('names the programs a file has when the one asked for is not there', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  const code = await runFlowsDraft({
    file: 'src/import.ts',
    program: 'runExport',
    root: fixture,
    write: false,
    force: false,
  });

  expect(code).toBe(1);
  expect(String(error.mock.calls[0]?.[0])).toMatch(
    /^No program runExport in src\/import\.ts\. It has: .*runImport/,
  );
}, 60_000);

const readDraft = async (markdown: string) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-flows-draft-'));

  try {
    await fs.mkdir(path.join(root, 'flows'));
    await fs.writeFile(path.join(root, 'flows', 'sync.md'), markdown);

    return readFlows([{ repository: 'sync', dir: root }], { resources: [], relationships: [] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

it('gives each step its own failure, so two steps that fail the same way carry on from where they are', async () => {
  const { code, printed } = await draft('runSync', 'src/sync.ts');

  expect(code).toBe(0);

  const { flows, failures } = await readDraft(printed);

  expect(failures).toEqual([]);

  const steps = new Map(flows[0]!.steps.map((step) => [step.id, step]));

  // The read is piped through its handler, and is still a step.
  expect(steps.get('read-items-storage-error')?.next).toEqual([{ id: 'write-item' }]);
  expect(steps.get('write-item-storage-error')?.next).toEqual([{ id: 'write-item' }]);
}, 60_000);

it('keeps a successful ending when the last step can fail', async () => {
  const { printed } = await draft('runSync', 'src/sync.ts');
  const { flows } = await readDraft(printed);
  const board = stormBoard(flows[0]!);

  expect(board.endings.map(({ title, track }) => [title, track])).toEqual([
    ['Run sync completed', 'happy'],
    ['Report rejected', 'failure'],
  ]);
}, 60_000);

const noPrograms = Layer.succeed(EffectAnalyzer, {
  programs: () => Effect.succeed([]),
  childrenOf: () => [],
});

it('fails with the programs a file has, as a typed error, when the one named is not there', async () => {
  const error = await Effect.runPromise(
    draftFlow({
      file: 'src/import.ts',
      program: 'runImport',
      root: fixture,
      write: false,
      force: false,
    }).pipe(Effect.provide(noPrograms), Effect.flip),
  );

  expect(error).toMatchObject({ _tag: 'ProgramNotFound', program: 'runImport', available: [] });
});

it('fails with SourceMissing before reading anything, for a file that is not there', async () => {
  const error = await Effect.runPromise(
    draftFlow({
      file: 'src/gone.ts',
      program: 'runImport',
      root: fixture,
      write: false,
      force: false,
    }).pipe(Effect.provide(noPrograms), Effect.flip),
  );

  expect(error).toMatchObject({ _tag: 'SourceMissing', file: 'src/gone.ts' });
});

const draftSteps = async (program: string) => {
  const { code, printed } = await draft(program, 'src/sync.ts');

  expect(code).toBe(0);

  const { flows, failures } = await readDraft(printed);

  expect(failures).toEqual([]);

  return new Map(flows[0]!.steps.map((step) => [step.id, step]));
};

it('gives each call its own step when a program makes the same call twice', async () => {
  const steps = await draftSteps('runAudit');

  expect([...steps.keys()]).toEqual([
    'read-items',
    'write-item',
    'read-items-2',
    'publish-report',
    'run-audit-completed',
    'read-items-storage-error',
    'write-item-storage-error',
    'read-items-2-storage-error',
    'report-rejected',
  ]);
  expect(steps.get('read-items')?.next.map(({ id }) => id)).toEqual([
    'write-item',
    'read-items-storage-error',
  ]);
}, 60_000);

it('reads what each call catches from its own handlers, not from the whole program', async () => {
  const steps = await draftSteps('runAudit');

  // Both reads catch StorageError and carry on; the write lets it escape.
  expect(steps.get('read-items-storage-error')).toMatchObject({
    next: [{ id: 'write-item' }],
    policies: [{ text: 'Whenever StorageError is caught, carry on' }],
  });
  expect(steps.get('read-items-2-storage-error')?.next).toEqual([{ id: 'publish-report' }]);
  expect(steps.get('write-item-storage-error')).toMatchObject({ next: [], policies: [] });
}, 60_000);

it('stops the run at a failure a handler around the whole program catches', async () => {
  const steps = await draftSteps('runReport');

  expect(steps.get('report-rejected')).toMatchObject({
    next: [],
    policies: [{ text: 'Whenever ReportRejected is caught, stop the run' }],
  });
}, 60_000);

it('follows a handler that fails again to the failure it raises, and does not carry on', async () => {
  const steps = await draftSteps('runStrict');

  expect(steps.get('storage-error')).toMatchObject({
    next: [{ id: 'storage-error-report-rejected', label: 'fails with ReportRejected' }],
    policies: [{ text: 'Whenever StorageError is caught, fail with ReportRejected' }],
  });
  expect(steps.get('storage-error-report-rejected')).toMatchObject({
    title: 'Report rejected',
    next: [],
  });
}, 60_000);

it('keeps both outcomes of a handler that may recover or fail again', async () => {
  const steps = await draftSteps('runMaybe');

  expect(steps.get('storage-error')).toMatchObject({
    next: [
      { id: 'publish-report' },
      { id: 'storage-error-report-rejected', label: 'fails with ReportRejected' },
    ],
    policies: [{ text: 'Whenever StorageError is caught, carry on, or fail with ReportRejected' }],
  });
}, 60_000);

it('reads a handler inside a loop the same way, from its source', async () => {
  const steps = await draftSteps('runPurge');

  expect(steps.get('write-item-storage-error')).toMatchObject({
    next: [{ id: 'write-item-storage-error-report-rejected' }],
    policies: [{ text: 'Whenever StorageError is caught, fail with ReportRejected' }],
  });
}, 60_000);

it('carries on when a later handler recovers from the error an earlier one raises', async () => {
  const steps = await draftSteps('runRelay');

  expect(steps.get('storage-error')).toMatchObject({
    next: [{ id: 'publish-report' }],
    policies: [{ text: 'Whenever StorageError is caught, carry on' }],
  });

  // The error passed between the two handlers never leaves the call.
  expect([...steps.keys()].filter((id) => id.includes('report-rejected'))).toEqual([
    'report-rejected',
  ]);
}, 60_000);

it('chains handlers the same way inside a loop', async () => {
  const steps = await draftSteps('runRelayAll');

  expect(steps.get('write-item-storage-error')).toMatchObject({
    next: [{ id: 'write-item' }],
    policies: [{ text: 'Whenever StorageError is caught, carry on with the next one' }],
  });
}, 60_000);

it('reads a loop handler that logs and then fails as failing, not as carrying on', async () => {
  const steps = await draftSteps('runLoud');

  expect(steps.get('write-item-storage-error')).toMatchObject({
    next: [{ id: 'write-item-storage-error-report-rejected' }],
    policies: [{ text: 'Whenever StorageError is caught, fail with ReportRejected' }],
  });
}, 60_000);

it('keeps both outcomes of a loop handler behind a condition it can see', async () => {
  const steps = await draftSteps('runChoosy');

  expect(steps.get('write-item-storage-error')?.next).toEqual([
    { id: 'write-item' },
    { id: 'write-item-storage-error-report-rejected', label: 'fails with ReportRejected' },
  ]);
}, 60_000);

it('claims nothing for a loop handler that both recovers and fails with no condition', async () => {
  const steps = await draftSteps('runMuddled');

  expect(steps.get('write-item-storage-error')).toMatchObject({
    summary: 'Caught by a handler the draft cannot read: say what happens next.',
    next: [],
    policies: [],
  });
}, 60_000);
