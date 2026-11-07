import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { JsonObject } from 'autocatalog-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Flow, readFlows } from '../src/flows';
import {
  checkLifecycles,
  FLOW_EVIDENCE_SPEC,
  type FlowEvidence,
  flowNotes,
  type LifecycleEntity,
  parseTransitionObservations,
  readFlowEvidence,
  stepEvidence,
  TRANSITIONS_SPEC,
  verifyFlows,
  writeFlowEvidence,
} from '../src/lifecycles';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-lifecycles-'));
  await fs.mkdir(path.join(root, 'flows'));
  await fs.mkdir(path.join(root, 'src'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const order: LifecycleEntity = {
  id: 'order',
  lifecycles: {
    status: {
      states: ['new', 'working', 'done', 'failed'],
      initial: ['new'],
      terminal: ['done'],
    },
  },
  properties: [{ name: 'status', enum: ['new', 'working', 'done', 'failed'] }],
};

const FLOW = `---
title: Fulfilling an order
entity: order
field: status
steps:
  - id: started
    title: Work started
    transition: { from: new, to: working }
    code:
      - { file: src/worker.js, contains: "status: 'working'" }
    rules: [Stock must be reserved first]
    stuck: { signs: no task is running, recovery: docs/runbooks/order.md }
    next_steps:
      - { id: finished, label: all work succeeds }
      - { id: failed, label: an error reaches the end }
      - { id: lookup-failed, label: a lookup fails }
  - id: finished
    title: Work finished
    transition: { from: working, to: done, via: worker }
  - id: failed
    title: Work failed
    transition: { from: [working], to: failed }
  - id: lookup-failed
    title: Lookup failed, run continues
    next_step: finished
---
`;

const RERUN = `---
title: Re-running a stuck order
entity: order
field: status
steps:
  - id: rerun
    actor: { name: Operator }
    summary: Sets done so a task can start. Nothing finished.
    transition: { from: working, to: done, via: operator }
---
`;

async function flows(...files: Array<[string, string]>) {
  for (const [name, body] of files) await fs.writeFile(path.join(root, 'flows', name), body);

  const result = readFlows([{ repository: 'orders', dir: root }], {
    resources: [],
    relationships: [],
  });

  expect(result.failures).toEqual([]);

  return result.flows;
}

const observed = (over = {}) =>
  parseTransitionObservations(
    JSON.stringify({
      spec: TRANSITIONS_SPEC,
      window: { from: '2026-10-01', to: '2026-11-01' },
      source: 'fixture',
      instrumented: [{ entity: 'order', field: 'status' }],
      transitions: [
        { entity: 'order', field: 'status', from: 'working', to: 'done', via: 'worker', count: 9 },
        {
          entity: 'order',
          field: 'status',
          from: 'working',
          to: 'done',
          via: 'operator',
          count: 2,
        },
      ],
      ...over,
    }),
  );

it('applies a flow’s entity and field to its steps, and a step can make no transition', async () => {
  const [flow] = await flows(['fulfil.md', FLOW]);

  expect(flow!.steps[0]!.transition).toEqual({
    entity: 'order',
    field: 'status',
    from: ['new'],
    to: 'working',
  });
  expect(flow!.steps[3]!.transition).toBeUndefined();
});

it('refuses a transition with no entity to apply it to', async () => {
  await fs.writeFile(
    path.join(root, 'flows/x.md'),
    '---\ntitle: X\nsteps:\n  - id: a\n    transition: { from: a, to: b }\n---\n',
  );

  const { failures } = readFlows([{ repository: 'orders', dir: root }], {
    resources: [],
    relationships: [],
  });

  expect(failures[0]).toContain('no entity and field');
});

describe('checkLifecycles', () => {
  it('fails a state the lifecycle does not have', async () => {
    const flow = await flows([
      'x.md',
      '---\ntitle: X\nentity: order\nfield: status\nsteps:\n  - id: a\n    transition: { from: new, to: gone }\n---\n',
    ]);

    expect(checkLifecycles(flow, [order]).failures).toEqual([
      "orders/flows/x.md: step 'a': 'gone' is not a state of order.status",
    ]);
  });

  it('does not warn about an initial state nothing leads to', async () => {
    const { warnings } = checkLifecycles(await flows(['f.md', FLOW]), [order]);

    expect(warnings).toEqual([]);
  });

  it('warns about a non-initial state no flow reaches', async () => {
    const flow = await flows([
      'x.md',
      '---\ntitle: X\nentity: order\nfield: status\nsteps:\n  - id: a\n    transition: { from: new, to: working }\n---\n',
    ]);

    expect(checkLifecycles(flow, [order]).warnings).toEqual([
      "order.status: no flow reaches 'done', and it is not an initial state",
      "order.status: no flow reaches 'failed', and it is not an initial state",
    ]);
  });

  it('keeps apart lifecycles whose names read the same when joined', async () => {
    const lifecycle = { states: ['new', 'done'], initial: ['new'], terminal: [] };

    const entities: LifecycleEntity[] = [
      { id: 'a.b', lifecycles: { c: lifecycle } },
      { id: 'a', lifecycles: { 'b.c': lifecycle } },
    ];

    const flow = await flows([
      'x.md',
      '---\ntitle: X\nentity: a.b\nfield: c\nsteps:\n  - id: a\n    transition: { from: new, to: done }\n---\n',
    ]);

    expect(checkLifecycles(flow, entities).warnings).toEqual([]);

    const other = await flows([
      'x.md',
      '---\ntitle: X\nentity: a.b\nfield: c\nsteps:\n  - id: a\n    transition: { from: new, to: new }\n---\n',
    ]);

    expect(checkLifecycles(other, entities).warnings).toEqual([
      "a.b.c: no flow reaches 'done', and it is not an initial state",
    ]);
  });

  it('leaves an entity another repository defines to the composed site', async () => {
    const flow = await flows(['f.md', FLOW]);

    expect(checkLifecycles(flow, [], { deferMissing: true }).failures).toEqual([]);
    expect(checkLifecycles(flow, []).failures).toHaveLength(3);
  });
});

describe('flowNotes', () => {
  const doc = (data: JsonObject) => ({
    id: 'orders/findings/one',
    repo: 'orders',
    data: { title: 'One', flow: 'fulfil', step: 'started', ...data },
  });

  const hotspot = async (data: JsonObject) =>
    flowNotes([doc(data)], await flows(['fulfil.md', FLOW])).notes[0]!.hotspot;

  it('marks only unresolved defects and questions as hotspots', async () => {
    expect(await hotspot({ nature: 'defect', status: 'draft' })).toBe(true);
    expect(await hotspot({ nature: 'question', status: 'confirmed' })).toBe(true);
    expect(await hotspot({ nature: 'behaviour', status: 'confirmed' })).toBe(false);
    expect(await hotspot({ nature: 'defect', status: 'superseded' })).toBe(false);
    expect(await hotspot({ nature: 'defect', status: 'confirmed', resolved: 'PR 12' })).toBe(false);
  });

  it('attaches any kind of document, and names a step the flow lacks', async () => {
    const all = await flows(['fulfil.md', FLOW]);

    expect(flowNotes([doc({ step: '' })], all).notes[0]!.step).toBeUndefined();
    expect(flowNotes([doc({ step: 'nope' })], all).warnings).toEqual([
      "orders/findings/one: flow 'fulfil' has no step 'nope'",
    ]);
    expect(flowNotes([doc({ flow: 'nope' })], all).warnings).toEqual([
      "orders/findings/one: flow 'nope' is not one this catalog has",
    ]);
  });
});

describe('verifyFlows', () => {
  const verify = async (observations?: ReturnType<typeof observed>) =>
    verifyFlows({
      flows: await flows(['fulfil.md', FLOW], ['rerun.md', RERUN]),
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
      commit: 'abc1234',
      observations,
    });

  const row = (record: Awaited<ReturnType<typeof verify>>, step: string) =>
    record.transitions.find((candidate) => candidate.step === step)!;

  it('counts a transition another repository declares as declared', async () => {
    const [own, sibling] = await flows(['fulfil.md', FLOW], ['rerun.md', RERUN]);

    const input = {
      flows: [sibling!],
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
      observations: observed({
        transitions: [
          { entity: 'order', field: 'status', from: 'new', to: 'working', via: 'api', count: 2 },
        ],
      }),
    };

    expect(verifyFlows(input).undeclared).toHaveLength(1);
    expect(verifyFlows({ ...input, allFlows: [own!, sibling!] }).undeclared).toEqual([]);
  });

  it('keeps each dimension separate, with no overall status', async () => {
    await fs.writeFile(path.join(root, 'src/worker.js'), "update({ status: 'working' })");

    const started = row(await verify(), 'started');

    expect(started).toMatchObject({
      declared: 'yes',
      schema: 'yes',
      code: 'yes',
      observed: 'not checked',
      rules: 'not checked',
    });
  });

  it('reports code that is gone, and refuses a path outside the checkout', async () => {
    expect(row(await verify(), 'started').code).toBe('no');

    const escaped = FLOW.replace('src/worker.js', '../outside.js');

    await fs.writeFile(path.join(path.dirname(root), 'outside.js'), "status: 'working'");

    const [flow] = await flows(['fulfil.md', escaped]);

    const record = verifyFlows({
      flows: [flow!],
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
    });

    expect(row(record, 'started').code).toBe('no');
    await fs.rm(path.join(path.dirname(root), 'outside.js'));
  });

  it('tells two steps sharing a transition apart by via', async () => {
    const record = await verify(observed());

    expect(row(record, 'finished')).toMatchObject({
      observed: 'yes',
      count: 9,
      otherVia: { operator: 2 },
    });
    expect(row(record, 'rerun')).toMatchObject({
      observed: 'yes',
      count: 2,
      otherVia: { worker: 9 },
    });
  });

  it('does not credit a step with a via from database-only observation', async () => {
    const record = await verify(
      observed({
        transitions: [{ entity: 'order', field: 'status', from: 'working', to: 'done', count: 11 }],
      }),
    );

    expect(row(record, 'finished')).toMatchObject({
      observed: 'not observed',
      otherVia: { unknown: 11 },
    });
  });

  it('matches values a backend rewrote, such as Datadog’s lower case', async () => {
    const entity: LifecycleEntity = {
      id: 'order',
      lifecycles: { status: { states: ['In Progress', 'Done'], initial: [], terminal: [] } },
    };

    const [flow] = await flows([
      'x.md',
      '---\ntitle: X\nentity: order\nfield: status\nsteps:\n  - id: a\n    transition: { from: In Progress, to: Done, via: Worker }\n---\n',
    ]);

    const record = verifyFlows({
      flows: [flow!],
      entities: [entity],
      dir: root,
      checkedAt: '2026-11-06',
      observations: observed({
        transitions: [
          {
            entity: 'order',
            field: 'status',
            from: 'in_progress',
            to: 'done',
            via: 'worker',
            count: 4,
          },
        ],
      }),
    });

    expect(row(record, 'a')).toMatchObject({ observed: 'yes', count: 4 });
    expect(record.undeclared).toEqual([]);
  });

  it('reads a test run’s snapshot as observations', async () => {
    const parsed = parseTransitionObservations(
      JSON.stringify({
        spec: 'autotel-architecture/v0.1.0',
        generatedAt: '2026-11-06T12:00:00Z',
        service: 'orders',
        events: {},
        transitions: [
          {
            entity: 'order',
            field: 'status',
            from: 'new',
            to: 'working',
            via: 'worker',
            count: 2,
            firstSeen: '2026-11-06T11:00:00Z',
            lastSeen: '2026-11-06T11:30:00Z',
          },
        ],
      }),
    );

    expect(parsed).toMatchObject({
      source: 'snapshot of orders',
      window: { from: '2026-11-06T11:00:00Z', to: '2026-11-06T11:30:00Z' },
      instrumented: [{ entity: 'order', field: 'status' }],
    });
  });

  it('separates not observed from not instrumented', async () => {
    expect(row(await verify(observed()), 'failed').observed).toBe('not observed');
    expect(row(await verify(observed({ instrumented: [] })), 'failed').observed).toBe(
      'not instrumented',
    );
  });

  it('names what ran and no flow declares, and records its window', async () => {
    const record = await verify(
      observed({
        transitions: [
          { entity: 'order', field: 'status', from: 'done', to: 'new', via: 'admin', count: 1 },
        ],
      }),
    );

    expect(record.undeclared).toEqual([
      { entity: 'order', field: 'status', from: 'done', to: 'new', via: 'admin', count: 1 },
    ]);
    expect(record).toMatchObject({
      commit: 'abc1234',
      window: { from: '2026-10-01', to: '2026-11-01' },
      source: 'fixture',
    });
  });

  it('calls a linked test linked and a rule in prose not checked', async () => {
    await fs.writeFile(path.join(root, 'src/rule.test.js'), '');

    const linked = FLOW.replace(
      'rules: [Stock must be reserved first]',
      'rules: [{ text: Stock must be reserved first, test: src/rule.test.js }]',
    );

    const [flow] = await flows(['fulfil.md', linked]);

    expect(
      row(
        verifyFlows({ flows: [flow!], entities: [order], dir: root, checkedAt: '2026-11-06' }),
        'started',
      ).rules,
    ).toBe('test linked');
  });

  it('gives the same record for the same input', async () => {
    expect(await verify(observed())).toEqual(await verify(observed()));
  });
});

describe('a repository is untrusted input', () => {
  const stepOn = (field: string) =>
    `---\ntitle: X\nentity: order\nfield: ${field}\nsteps:\n  - id: a\n    transition: { from: new, to: done }\n---\n`;

  it.each(['constructor', 'toString', '__proto__'])(
    'treats a field named %s as having no lifecycle',
    async (field) => {
      const flow = await flows(['x.md', stepOn(field)]);

      expect(checkLifecycles(flow, [order]).failures).toEqual([
        `orders/flows/x.md: step 'a': entity 'order' has no lifecycle for '${field}'`,
      ]);

      const record = verifyFlows({
        flows: flow,
        entities: [order],
        dir: root,
        checkedAt: '2026-11-06',
      });

      expect(record.transitions[0]!.declared).toBe('no');
    },
  );

  it('counts a via named like an object property as data', async () => {
    const record = verifyFlows({
      flows: await flows(['fulfil.md', FLOW]),
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
      observations: observed({
        transitions: ['constructor', '__proto__'].map((via) => ({
          entity: 'order',
          field: 'status',
          from: 'working',
          to: 'done',
          via,
          count: 2,
        })),
      }),
    });

    const finished = record.transitions.find((row) => row.step === 'finished')!;

    expect(Object.entries(finished.otherVia!).sort()).toEqual([
      ['__proto__', 2],
      ['constructor', 2],
    ]);
  });

  it('does not read a linked file through a symlink out of the checkout', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

    await fs.writeFile(path.join(outside, 'secret'), "status: 'working'");
    await fs.symlink(path.join(outside, 'secret'), path.join(root, 'src/worker.js'));

    const record = verifyFlows({
      flows: await flows(['fulfil.md', FLOW]),
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
    });

    expect(record.transitions[0]!.code).toBe('no');
    await fs.rm(outside, { recursive: true });
  });

  it('does not read a folder as a linked file', async () => {
    const [flow] = await flows(['fulfil.md', FLOW.replace('src/worker.js', 'src')]);

    const record = verifyFlows({
      flows: [flow!],
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
    });

    expect(record.transitions[0]!.code).toBe('no');
  });

  const evidence = {
    spec: FLOW_EVIDENCE_SPEC,
    checkedAt: '2026-11-06',
    transitions: [],
    undeclared: [],
  } satisfies FlowEvidence;

  it('writes evidence, and reads it back', () => {
    writeFlowEvidence(root, evidence);

    expect(readFlowEvidence(root)).toEqual(evidence);
  });

  it('refuses to write or read evidence through a symlink', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));
    const target = path.join(outside, 'target');

    await fs.writeFile(target, JSON.stringify(evidence));
    await fs.symlink(target, path.join(root, 'flows/evidence.json'));

    expect(readFlowEvidence(root)).toBeUndefined();
    expect(() => writeFlowEvidence(root, { ...evidence, checkedAt: 'x' })).toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe(JSON.stringify(evidence));
    await fs.rm(outside, { recursive: true });
  });

  it('refuses a flows folder that is itself a symlink', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

    await fs.rm(path.join(root, 'flows'), { recursive: true });
    await fs.symlink(outside, path.join(root, 'flows'));

    expect(() => writeFlowEvidence(root, evidence)).toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.rm(outside, { recursive: true });
  });
});

describe('stepEvidence', () => {
  const recorded = async () =>
    verifyFlows({
      flows: await flows(['fulfil.md', FLOW]),
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
      observations: observed(),
    });

  const edited = async (from: string, to: string) => {
    const [flow] = await flows(['fulfil.md', FLOW.replace(from, to)]);

    return flow!;
  };

  const finished = (flow: Flow) => flow.steps.find((step) => step.id === 'finished')!;

  it('finds the record for the transition the step still claims', async () => {
    const evidence = await recorded();
    const [flow] = await flows(['fulfil.md', FLOW]);

    expect(stepEvidence(evidence, flow!, finished(flow!))).toMatchObject({ count: 9 });
  });

  it('ignores the order a list of states is written in', async () => {
    const list = FLOW.replace(
      '{ from: working, to: done, via: worker }',
      '{ from: [new, working], to: done, via: worker }',
    );

    const [flow] = await flows(['fulfil.md', list]);

    const evidence = verifyFlows({
      flows: [flow!],
      entities: [order],
      dir: root,
      checkedAt: '2026-11-06',
    });

    const reordered = await edited(
      '{ from: working, to: done, via: worker }',
      '{ from: [working, new], to: done, via: worker }',
    );

    expect(stepEvidence(evidence, reordered, finished(reordered))).toBeDefined();
  });

  it.each([
    ['to', '{ from: working, to: failed, via: worker }'],
    ['from', '{ from: new, to: done, via: worker }'],
    ['via', '{ from: working, to: done, via: operator }'],
  ])('drops the record when the step changes its %s', async (_, changed) => {
    const evidence = await recorded();
    const flow = await edited('{ from: working, to: done, via: worker }', changed);

    expect(stepEvidence(evidence, flow, finished(flow))).toBeUndefined();
  });

  it('drops the record when the step moves to another field', async () => {
    const evidence = await recorded();
    const flow = await edited('field: status', 'field: stage');

    expect(stepEvidence(evidence, flow, finished(flow))).toBeUndefined();
  });

  it('has nothing to say about a step with no transition', async () => {
    const evidence = await recorded();
    const [flow] = await flows(['fulfil.md', FLOW]);

    expect(stepEvidence(evidence, flow!, flow!.steps[3]!)).toBeUndefined();
  });
});

it('refuses observations in a shape it does not know', () => {
  expect(() => parseTransitionObservations('{"spec":"other"}')).toThrow();
});
