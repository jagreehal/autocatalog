import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFlows, stormWarnings, type Flow } from '../src/flows';
import type { FlowNote } from '../src/lifecycles';
import { bigPicture, stormBoard, type StormRow } from '../src/storm';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-storm-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const read = async (files: Record<string, string>) => {
  for (const [file, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, 'flows', file)), { recursive: true });
    await fs.writeFile(path.join(root, 'flows', file), body);
  }

  return readFlows([{ repository: 'imports', dir: root }], { resources: [], relationships: [] });
};

const IMPORT = `---
title: Catalogue import
entity: import
field: status
steps:
  - id: request
    stage: Request import
    actor: { name: Supplier user }
    command: Run catalogue import
    systems: [Job queue]
    next_step: load
  - id: load
    stage: Load import record
    title: Import loaded
    systems: [Database]
    decidedBy: Import
    next_steps: [parse, { id: missing, label: no import has that id }]
  - id: missing
    title: Import not found
  - id: parse
    stage: Parse file
    title: File parsed
    command: Parse file
    policy: Whenever the file is parsed, ingest every product
    next_steps: [ingest, { id: unreadable, label: the parser gives up }]
  - id: unreadable
    title: File unreadable
    policy: Whenever it can't be parsed, fail the import
    next_step: errored
  - id: ingest
    stage: Ingest each product
    title: Product saved
    repeats: once per parsed product
    flow: ingest-product
    next_steps: [progress, { id: failed, label: a product fails }]
  - id: failed
    title: Product ingest failed
    policy: Whenever a product fails, record it and carry on
    next_step: ingest
  - id: progress
    stage: Ingest each product
    title: Progress recorded
    next_steps: [completed, partial]
  - id: completed
    stage: Finish import
    title: Import completed
    transition: { from: running, to: complete }
    readModels: [Import status screen]
    policy:
      - Whenever the import finishes, notify the user
      - Always save the final status
  - id: partial
    stage: Finish import
    track: happy
    title: Import partially completed
    transition: { from: running, to: complete }
  - id: errored
    stage: Finish import
    title: Import errored
    transition: { from: running, to: errored }
scenarios:
  - given: No import with that id
    when: The import runs
    then: Nothing visible happens
    expected: The user is told the import failed
    step: missing
---
`;

const INGEST = `---
title: Ingest a product
steps:
  - id: save
    title: Product saved
---
`;

const flowOf = async () => {
  const { flows, failures } = await read({
    'catalogue-import.md': IMPORT,
    'ingest-product.md': INGEST,
  });

  expect(failures).toEqual([]);

  return flows.find((flow) => flow.id === 'catalogue-import')!;
};

const texts = (board: ReturnType<typeof stormBoard>, stage: string, row: StormRow) =>
  board.columns.find((column) => column.stage === stage)?.rows[row].map((sticky) => sticky.text);

describe('a flow as an EventStorming board', () => {
  it('lays the happy track out as columns, and stacks steps that share a stage', async () => {
    const board = stormBoard(await flowOf());

    expect(board.columns.map((column) => column.stage)).toEqual([
      'Request import',
      'Load import record',
      'Parse file',
      'Ingest each product',
      'Finish import',
    ]);
    expect(texts(board, 'Ingest each product', 'happy')).toEqual([
      'Product saved',
      'Progress recorded',
    ]);
    expect(texts(board, 'Finish import', 'happy')).toEqual([
      'Import completed',
      'Import partially completed',
    ]);
  });

  it('puts who takes part, the command and what decides above the facts', async () => {
    const board = stormBoard(await flowOf());

    expect(texts(board, 'Request import', 'who')).toEqual(['Supplier user', 'Job queue']);
    expect(texts(board, 'Request import', 'command')).toEqual(['Run catalogue import']);
    expect(texts(board, 'Load import record', 'decidedBy')).toEqual(['Import']);
    expect(texts(board, 'Finish import', 'who')).toEqual(['Import status screen']);

    // A transition names what decides, when the step does not.
    expect(texts(board, 'Finish import', 'decidedBy')).toEqual(['import']);
  });

  it('puts each failure under the stage it branches from, or the stage it names', async () => {
    const board = stormBoard(await flowOf());

    expect(texts(board, 'Load import record', 'failure')).toEqual(['Import not found']);
    expect(texts(board, 'Parse file', 'failure')).toEqual(['File unreadable']);
    expect(texts(board, 'Ingest each product', 'failure')).toEqual(['Product ingest failed']);
    expect(texts(board, 'Finish import', 'failure')).toEqual(['Import errored']);
    expect(Object.fromEntries(board.tracks)).toMatchObject({
      partial: 'happy',
      failed: 'failure',
      errored: 'failure',
    });
  });

  it('raises a hotspot for a failure after which nothing happens', async () => {
    const board = stormBoard(await flowOf());

    expect(board.hotspots).toEqual([
      {
        title: 'No policy after “Import not found”: nothing happens next',
        step: 'missing',
        derived: true,
      },
    ]);
    expect(texts(board, 'Load import record', 'policy')).toEqual([
      'No policy after “Import not found”: nothing happens next',
    ]);
    const { flows } = await read({ 'catalogue-import.md': IMPORT, 'ingest-product.md': INGEST });

    expect(stormWarnings(flows)).toEqual([
      "imports/flows/catalogue-import.md: step 'missing' is a failure with no policy, no next step and no status change, so nothing happens after it",
    ]);
  });

  it('marks the facts a finding questions, and lists the finding as a hotspot', async () => {
    const flow = await flowOf();

    const note: FlowNote = {
      id: 'imports/findings/partial',
      title: "Partial isn't its own status",
      repository: 'imports',
      flow: 'catalogue-import',
      step: 'partial',
      nature: 'question',
      status: 'draft',
      hotspot: true,
    };

    const board = stormBoard(flow, [note]);

    const partial = board.columns
      .flatMap((column) => column.rows.happy)
      .find((sticky) => sticky.step === 'partial');

    expect(partial?.hotspots).toBe(1);
    expect(board.hotspots[0]).toMatchObject({
      title: "Partial isn't its own status",
      derived: false,
    });
  });

  it('says how a run can end, with the status it leaves and who hears of it', async () => {
    const board = stormBoard(await flowOf());

    expect(board.endings.map(({ title, status, track }) => [title, status, track])).toEqual([
      ['Import not found', 'unchanged', 'failure'],
      ['Import completed', 'complete', 'happy'],
      ['Import partially completed', 'complete', 'happy'],
      ['Import errored', 'errored', 'failure'],
    ]);
    expect(board.endings[1]!.policies).toEqual([
      'Whenever the import finishes, notify the user',
      'Always save the final status',
    ]);
  });

  it('keeps the loop, the zoom-in and the scenarios', async () => {
    const board = stormBoard(await flowOf());
    const ingest = board.columns.find((column) => column.stage === 'Ingest each product');

    expect(ingest).toMatchObject({
      repeats: 'once per parsed product',
      subflow: 'imports/ingest-product',
    });
    expect(board.scenarios).toEqual([
      {
        given: 'No import with that id',
        when: 'The import runs',
        // oxlint-disable-next-line unicorn/no-thenable -- Given, When, Then, not a Promise
        then: 'Nothing visible happens',
        expected: 'The user is told the import failed',
        step: 'missing',
        outcome: 'Import not found',
      },
    ]);
  });
});

describe('a board of failures alone', () => {
  it('gives each failure a column, and raises a hotspot for each one nothing handles', async () => {
    const { flows } = await read({
      'outages.md': `---
title: Outages
steps:
  - id: timeout
    stage: Call the bank
    track: failure
    title: Bank timed out
    policy: Whenever the bank times out, retry in a minute
  - id: refused
    stage: Call the bank
    track: failure
    title: Bank refused the call
  - id: lost
    track: failure
    title: Callback lost
---
`,
    });

    const board = stormBoard(flows[0]!);

    expect(
      board.columns.map(({ stage, rows }) => [stage, rows.failure.map(({ text }) => text)]),
    ).toEqual([
      ['Call the bank', ['Bank timed out', 'Bank refused the call']],
      ['Callback lost', ['Callback lost']],
    ]);
    expect(board.hotspots.map(({ step }) => step)).toEqual(['refused', 'lost']);
  });
});

describe('reading a flow for a board', () => {
  it('refuses a scenario that ends on no step, and a flow that zooms into itself', async () => {
    const scenario = IMPORT.replace('step: missing', 'step: nowhere');

    const self = INGEST.replace(
      'title: Product saved',
      'title: Product saved\n    flow: ingest-product',
    );

    const { failures } = await read({ 'catalogue-import.md': scenario, 'ingest-product.md': self });

    expect(failures).toEqual([
      "imports/flows/catalogue-import.md: a scenario ends on 'nowhere', which is not a step",
      "imports/flows/ingest-product.md: step 'save' zooms into this flow itself",
    ]);
  });

  it('warns when a stage zooms into a flow nobody declares', async () => {
    const { flows } = await read({ 'catalogue-import.md': IMPORT });

    expect(stormWarnings(flows)).toContain(
      "imports/flows/catalogue-import.md: step 'ingest' zooms into 'ingest-product', which is not a flow",
    );
  });

  it('takes a command from the catalog when it names one', async () => {
    const command = IMPORT.replace(
      'command: Parse file',
      'command: { ref: imports/parse-file, summary: one file at a time }',
    );

    const { flows, failures } = await read({ 'catalogue-import.md': command });

    expect(failures[0]).toMatch(/step 'parse': .*command\/imports\/parse-file/);
    expect(flows).toEqual([]);
  });
});

describe('the big picture', () => {
  it('draws each flow as a lane of its happy facts, with what is open on it', async () => {
    const flow: Flow = await flowOf();

    expect(bigPicture([flow])).toEqual([
      {
        repository: 'imports',
        id: 'catalogue-import',
        title: 'Catalogue import',
        summary: undefined,
        events: [
          'Import loaded',
          'File parsed',
          'Product saved',
          'Progress recorded',
          'Import completed',
          'Import partially completed',
        ],
        failures: 4,
        hotspots: 1,
      },
    ]);
  });
});
