import type { Flow, FlowStep, FlowTrack } from './flows';
import type { FlowNote } from './lifecycles';

/** The kinds of sticky an EventStorming board uses, each its own colour. */
export type StickyKind =
  | 'actor'
  | 'system'
  | 'command'
  | 'aggregate'
  | 'event'
  | 'failure'
  | 'policy'
  | 'read-model'
  | 'hotspot';

/** The rows of a process-level board, top to bottom. */
export const STORM_ROWS = ['who', 'command', 'decidedBy', 'happy', 'failure', 'policy'] as const;

export type StormRow = (typeof STORM_ROWS)[number];

export interface StormSticky {
  kind: StickyKind;
  text: string;
  summary?: string | undefined;
  /** The step it comes from, so a reader can go from a sticky to the step's facts. */
  step?: string | undefined;
  /** Open findings on its step, shown as a hotspot tag on the sticky. */
  hotspots?: number | undefined;
  /** The code behind it, for a reader who asks to see it. */
  code?: Array<{ file: string; contains?: string | undefined }> | undefined;
}

export interface StormColumn {
  /** Its heading: the stage the steps in it share, or the one step's command or title. */
  stage: string;
  /** "once per parsed work", for a stage that runs in a loop. */
  repeats?: string | undefined;
  /** The flow that zooms into it, as `<repository>/<id>`. */
  subflow?: string | undefined;
  rows: Record<StormRow, StormSticky[]>;
}

/** A problem or open question, from a finding or from a failure nothing handles. */
export interface StormHotspot {
  title: string;
  step?: string | undefined;
  /** The finding's page id, when a finding raised it. */
  note?: string | undefined;
  nature?: string | undefined;
  status?: string | undefined;
  /** Raised by autocatalog: a failure with no policy and nowhere to go. */
  derived: boolean;
}

/** One way a run can end, with what it leaves behind. */
export interface StormEnding {
  step: string;
  title: string;
  track: FlowTrack;
  summary?: string | undefined;
  /** The state it leaves, or `unchanged` when it records none. */
  status: string;
  /** What happens next: who is told, what is saved. */
  policies: string[];
}

export interface StormScenario {
  given: string;
  when: string;
  then: string;
  expected?: string | undefined;
  step?: string | undefined;
  /** The title of the step it ends on. */
  outcome?: string | undefined;
  test?: string | undefined;
}

export interface StormBoard {
  columns: StormColumn[];
  hotspots: StormHotspot[];
  endings: StormEnding[];
  scenarios: StormScenario[];
  /** Each step's track, by id. */
  tracks: Map<string, FlowTrack>;
}

/**
 * The first step nothing leads to, or the first written when every step has
 * one leading to it.
 */
function startOf(flow: Flow): FlowStep {
  const targets = new Set(flow.steps.flatMap((step) => step.next.map(({ id }) => id)));

  return flow.steps.find((step) => !targets.has(step.id)) ?? flow.steps[0]!;
}

/**
 * Each step's track. The happy track follows the first branch out of each step
 * from the start; every other step is a failure, and a compensation always is.
 * A step's own `track` wins over both.
 */
export function stormTracks(flow: Flow): Map<string, FlowTrack> {
  const byId = new Map(flow.steps.map((step) => [step.id, step]));
  const tracks = new Map<string, FlowTrack>();
  const compensations = new Set(flow.steps.flatMap((step) => step.compensatedBy?.id ?? []));

  for (let step: FlowStep | undefined = startOf(flow); step && !tracks.has(step.id);) {
    tracks.set(step.id, 'happy');

    const first: string | undefined = step.next[0]?.id;

    step = first === undefined ? undefined : byId.get(first);
  }

  for (const step of flow.steps) {
    if (step.track) tracks.set(step.id, step.track);
    else if (compensations.has(step.id) || !tracks.has(step.id)) tracks.set(step.id, 'failure');
  }

  return tracks;
}

const emptyRows = (): Record<StormRow, StormSticky[]> => ({
  who: [],
  command: [],
  decidedBy: [],
  happy: [],
  failure: [],
  policy: [],
});

const stageOf = (step: FlowStep) => step.stage ?? step.command?.name ?? step.title;

/**
 * The happy steps in the order a run meets them: the track first, then any the
 * author put on it, each after the step that leads to it.
 */
function happyOrder(flow: Flow, tracks: Map<string, FlowTrack>): FlowStep[] {
  const byId = new Map(flow.steps.map((step) => [step.id, step]));
  const ordered: FlowStep[] = [];
  const seen = new Set<string>();

  const visit = (step: FlowStep) => {
    if (seen.has(step.id) || tracks.get(step.id) !== 'happy') return;

    seen.add(step.id);
    ordered.push(step);

    for (const { id } of step.next) {
      const next = byId.get(id);

      if (next) visit(next);
    }
  };

  visit(startOf(flow));

  for (const step of flow.steps) visit(step);

  return ordered;
}

/** The happy step a failure branches from, the nearest one back along the branches. */
function anchorOf(
  step: FlowStep,
  flow: Flow,
  tracks: Map<string, FlowTrack>,
): FlowStep | undefined {
  const leadsTo = (target: string) =>
    flow.steps.filter(
      (candidate) =>
        candidate.next.some(({ id }) => id === target) || candidate.compensatedBy?.id === target,
    );

  const queue = [step.id];
  const seen = new Set(queue);

  while (queue.length > 0) {
    for (const before of leadsTo(queue.shift()!)) {
      if (tracks.get(before.id) === 'happy') return before;

      if (!seen.has(before.id)) {
        seen.add(before.id);
        queue.push(before.id);
      }
    }
  }

  return undefined;
}

const sticky = (kind: StickyKind, text: string, extra: Partial<StormSticky> = {}): StormSticky => ({
  kind,
  text,
  ...extra,
});

/** Who and what a step involves, in the row above its command. */
function whoOf(step: FlowStep): StormSticky[] {
  const own =
    step.kind === 'actor'
      ? [sticky('actor', step.title, { summary: step.summary, step: step.id })]
      : step.kind === 'external' || step.kind === 'service' || step.kind === 'agent'
        ? [sticky('system', step.title, { summary: step.summary, step: step.id })]
        : [];

  return [
    ...own,
    ...step.actors.map(({ name, summary }) => sticky('actor', name, { summary })),
    ...step.systems.map(({ name, summary }) => sticky('system', name, { summary })),
    ...step.readModels.map(({ name, summary }) => sticky('read-model', name, { summary })),
  ];
}

/** A step that records something: an event, or a step nothing names otherwise. */
const isFact = (step: FlowStep) => step.kind === 'event' || step.kind === 'custom';

/**
 * A flow written for a board: one that names a stage, a command, a policy or a
 * track, or anything else only a board shows. Only such a flow is held to
 * "every failure has a policy"; an older flow's branches may be alternatives.
 */
export const stormed = (flow: Flow) =>
  flow.scenarios.length > 0 ||
  flow.steps.some(
    (step) =>
      step.stage ??
      step.command ??
      step.decidedBy ??
      step.track ??
      step.subflow ??
      step.repeats ??
      step.policies.length + step.actors.length + step.systems.length + step.readModels.length,
  );

/** A failure after which nothing happens: no policy, nowhere to go, and no status recorded. */
export const unhandled = (step: FlowStep) =>
  step.policies.length === 0 && step.next.length === 0 && !step.transition;

const add = (stickies: StormSticky[], item: StormSticky) => {
  const same = (existing: StormSticky) =>
    existing.kind === item.kind && existing.text.toLowerCase() === item.text.toLowerCase();

  if (!stickies.some(same)) {
    stickies.push(item);
  }
};

/**
 * A flow as a process-level EventStorming board: a column per stage of the
 * happy track, with who takes part, the command, what decides, the facts on
 * each track and the policies under them. A failure that nothing handles
 * raises a hotspot of its own.
 */
export function stormBoard(flow: Flow, notes: FlowNote[] = []): StormBoard {
  const tracks = stormTracks(flow);
  const open = new Map<string, number>();

  const own = notes.filter((note) => note.repository === flow.repository && note.flow === flow.id);

  for (const note of own) {
    if (note.hotspot && note.step) open.set(note.step, (open.get(note.step) ?? 0) + 1);
  }

  const columns: StormColumn[] = [];
  const columnOf = new Map<string, StormColumn>();

  for (const step of happyOrder(flow, tracks)) {
    const stage = stageOf(step);
    let column = step.stage ? columns.find((candidate) => candidate.stage === stage) : undefined;

    if (!column) {
      column = { stage, rows: emptyRows() };
      columns.push(column);
    }

    columnOf.set(step.id, column);
  }

  const derived: StormHotspot[] = [];
  const strict = stormed(flow);

  for (const step of flow.steps) {
    const anchor = tracks.get(step.id) === 'happy' ? step : anchorOf(step, flow, tracks);

    // A failure with no happy step before it, such as on a board of failures
    // alone, stands in a column of its own rather than dropping off the board.
    const column =
      (step.stage && columns.find((candidate) => candidate.stage === step.stage)) ||
      (anchor && columnOf.get(anchor.id)) ||
      columns.find((candidate) => candidate.stage === stageOf(step)) ||
      columns[columns.push({ stage: stageOf(step), rows: emptyRows() }) - 1]!;

    const { rows } = column;

    column.repeats ??= step.repeats;
    column.subflow ??= step.subflow && qualified(step.subflow, flow.repository);

    for (const item of whoOf(step)) add(rows.who, item);

    if (step.command) add(rows.command, sticky('command', step.command.name, step.command));

    const decidedBy = step.decidedBy ?? (step.transition && step.transition.entity);

    if (decidedBy) add(rows.decidedBy, sticky('aggregate', decidedBy));

    const track = tracks.get(step.id)!;

    if (isFact(step)) {
      rows[track].push(
        sticky(track === 'happy' ? 'event' : 'failure', step.title, {
          summary: step.summary,
          step: step.id,
          hotspots: open.get(step.id),
          code: step.code,
        }),
      );
    }

    for (const policy of step.policies) add(rows.policy, sticky('policy', policy.text));

    if (strict && track === 'failure' && unhandled(step)) {
      const title = `No policy after “${step.title}”: nothing happens next`;

      rows.policy.push(sticky('hotspot', title, { step: step.id }));
      derived.push({ title, step: step.id, derived: true });
    }
  }

  const titles = new Map(flow.steps.map((step) => [step.id, step.title]));

  return {
    columns,
    tracks,
    hotspots: [
      ...own.flatMap((note) =>
        note.hotspot
          ? [
              {
                title: note.title,
                step: note.step,
                note: note.id,
                nature: note.nature,
                status: note.status,
                derived: false,
              },
            ]
          : [],
      ),
      ...derived,
    ],
    endings: flow.steps
      .filter((step) => step.next.length === 0 && isFact(step))
      .map((step) => ({
        step: step.id,
        title: step.title,
        track: tracks.get(step.id)!,
        summary: step.summary,
        status: step.transition?.to ?? 'unchanged',
        policies: step.policies.map(({ text }) => text),
      })),
    scenarios: flow.scenarios.map((scenario) => ({
      ...scenario,
      outcome: scenario.step && titles.get(scenario.step),
    })),
  };
}

const qualified = (subflow: string, repository: string) =>
  subflow.includes('/') ? subflow : `${repository}/${subflow}`;

/** One flow on the big-picture board: its happy facts in order, and what is open on it. */
export interface BigPictureLane {
  repository: string;
  id: string;
  title: string;
  summary?: string | undefined;
  events: string[];
  failures: number;
  hotspots: number;
}

/**
 * Every flow as one lane of a big-picture board: the facts a run meets on the
 * happy track, how many ways it can fail, and how many hotspots are open.
 */
export function bigPicture(flows: Flow[], notes: FlowNote[] = []): BigPictureLane[] {
  return flows.map((flow) => {
    const board = stormBoard(flow, notes);

    return {
      repository: flow.repository,
      id: flow.id,
      title: flow.title,
      summary: flow.summary,
      events: board.columns.flatMap((column) => column.rows.happy.map(({ text }) => text)),
      failures: board.columns.reduce((sum, column) => sum + column.rows.failure.length, 0),
      hotspots: board.hotspots.length,
    };
  });
}
