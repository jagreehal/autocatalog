import fs from 'node:fs';
import path from 'node:path';
import type { JsonObject } from 'autocatalog-core';
import { z } from 'zod';
import type { Flow, FlowStep, FlowTransition } from './flows';
import { FLOWS_DIR } from './flows';
import { inside } from './inside';

/** The states one field of an entity moves through. */
export interface Lifecycle {
  states: string[];
  /** Where it can begin, so a state nothing leads to is not reported as missed. */
  initial: string[];
  terminal: string[];
}

const state = z.string().trim().min(1);

const oneOrMany = z.union([state.transform((value) => [value]), z.array(state)]);

/** `lifecycles:` on an entity, keyed by field, since one entity can have several. */
export const lifecyclesSchema = z.record(
  state,
  z
    .strictObject({
      states: z.array(state).min(1),
      initial: oneOrMany.default([]),
      terminal: oneOrMany.default([]),
    })
    .superRefine((lifecycle, context) => {
      for (const name of [...lifecycle.initial, ...lifecycle.terminal]) {
        if (!lifecycle.states.includes(name)) {
          context.addIssue({ code: 'custom', message: `'${name}' is not one of its states` });
        }
      }
    }),
);

/** The part of an entity a flow is checked against. */
export interface LifecycleEntity {
  id: string;
  lifecycles: Record<string, Lifecycle>;
  properties?: Array<{ name: string; enum?: string[] | undefined }> | undefined;
}

export interface LifecycleCheck {
  failures: string[];
  warnings: string[];
}

/** Identifies a lifecycle: either part can hold a dot, so joining with one would not. */
export const lifecycleKey = (entity: string, field: string) => JSON.stringify([entity, field]);

/** By own key: a flow's field is the repository's text, and could be `constructor`. */
const lifecycleOf = (entity: LifecycleEntity | undefined, field: string) =>
  entity && Object.hasOwn(entity.lifecycles, field) ? entity.lifecycles[field] : undefined;

const statesOf = ({ from, to }: FlowTransition) => [...from, to];

const place = (flow: Flow, step: FlowStep) => `${flow.repository}/${flow.file}: step '${step.id}'`;

/**
 * Hold each transition to its entity's lifecycle. An entity another repository
 * defines is the composed site's to check, so `deferMissing` lets it pass.
 */
export function checkLifecycles(
  flows: Flow[],
  entities: LifecycleEntity[],
  options: { deferMissing?: boolean } = {},
): LifecycleCheck {
  const failures: string[] = [];
  const warnings: string[] = [];
  const reached = new Map<string, Set<string>>();

  for (const flow of flows) {
    for (const step of flow.steps) {
      if (!step.transition) continue;

      const { entity: id, field, to } = step.transition;
      const entity = entities.find((candidate) => candidate.id === id);

      if (!entity) {
        if (!options.deferMissing) failures.push(`${place(flow, step)}: no entity '${id}'`);
        continue;
      }

      const lifecycle = lifecycleOf(entity, field);

      if (!lifecycle) {
        failures.push(`${place(flow, step)}: entity '${id}' has no lifecycle for '${field}'`);
        continue;
      }

      for (const name of statesOf(step.transition)) {
        if (!lifecycle.states.includes(name)) {
          failures.push(`${place(flow, step)}: '${name}' is not a state of ${id}.${field}`);
        }
      }

      const key = lifecycleKey(id, field);

      reached.set(key, (reached.get(key) ?? new Set()).add(to));
    }
  }

  for (const entity of entities) {
    for (const [field, lifecycle] of Object.entries(entity.lifecycles)) {
      const into = reached.get(lifecycleKey(entity.id, field));

      if (!into) continue;

      for (const name of lifecycle.states) {
        if (!into.has(name) && !lifecycle.initial.includes(name)) {
          warnings.push(
            `${entity.id}.${field}: no flow reaches '${name}', and it is not an initial state`,
          );
        }
      }
    }
  }

  return { failures, warnings };
}

/** What a finding says it is: normal behaviour, a defect, or an open question. */
export type NoteNature = 'behaviour' | 'defect' | 'question';

/** A document attached to a flow step by its `flow:` and `step:`. */
export interface FlowNote {
  /** The document's id, its page's path. */
  id: string;
  title: string;
  repository: string;
  flow: string;
  step?: string | undefined;
  nature?: NoteNature | undefined;
  /** The state of the knowledge, never of the defect: `draft`, `confirmed`, `superseded`. */
  status?: string | undefined;
  resolved?: string | undefined;
  /** A problem still open: a defect or question, neither superseded nor resolved. */
  hotspot: boolean;
}

const noteFields = z.looseObject({
  title: state.optional().catch(undefined),
  flow: state.optional().catch(undefined),
  step: state.optional().catch(undefined),
  nature: z.enum(['behaviour', 'defect', 'question']).optional().catch(undefined),
  status: state.optional().catch(undefined),
  resolved: state.optional().catch(undefined),
});

interface NoteDocument {
  id: string;
  repo: string;
  data: JsonObject;
}

export interface FlowNotes {
  notes: FlowNote[];
  warnings: string[];
}

/**
 * Any document can attach to a flow, whatever its kind, so a company's own kinds
 * join the map the way findings do. `flow:` is a flow's id, or `<repository>/<id>`
 * for one another repository keeps.
 */
export function flowNotes(documents: NoteDocument[], flows: Flow[]): FlowNotes {
  const notes: FlowNote[] = [];
  const warnings: string[] = [];

  for (const { id, repo, data } of documents) {
    const { title, flow: named, step, nature, status, resolved } = noteFields.parse(data);

    if (!named) continue;

    const flow = flows.find((candidate) =>
      named.includes('/')
        ? `${candidate.repository}/${candidate.id}` === named
        : candidate.id === named && candidate.repository === repo,
    );

    if (!flow) {
      warnings.push(`${id}: flow '${named}' is not one this catalog has`);
      continue;
    }

    if (step && !flow.steps.some((candidate) => candidate.id === step)) {
      warnings.push(`${id}: flow '${named}' has no step '${step}'`);
      continue;
    }

    notes.push({
      id,
      title: title ?? id,
      repository: flow.repository,
      flow: flow.id,
      step,
      nature,
      status,
      resolved,
      hotspot:
        (nature === 'defect' || nature === 'question') && status !== 'superseded' && !resolved,
    });
  }

  return { notes, warnings };
}

export const TRANSITIONS_SPEC = 'autotel-transitions/v0.1.0';

const observedRow = z.looseObject({
  entity: state,
  field: state,
  from: state,
  to: state,
  via: state.default('unknown'),
  service: state.optional(),
  count: z.number().int().nonnegative(),
});

const snapshotSchema = z.looseObject({
  spec: z.string().startsWith('autotel-architecture/'),
  service: state,
  generatedAt: state,
  transitions: z.array(observedRow.extend({ firstSeen: state, lastSeen: state })).default([]),
});

const observationsSchema = z.looseObject({
  spec: z.literal(TRANSITIONS_SPEC),
  window: z.strictObject({ from: state, to: state }),
  source: state,
  instrumented: z.array(z.looseObject({ entity: state, field: state })),
  transitions: z.array(observedRow),
});

/** What a runtime recorded over a window, as `autotel-mcp`'s `get_state_transitions` returns it. */
export type TransitionObservations = z.infer<typeof observationsSchema>;

/** Counts are best-effort evidence: what was recorded, never how many times it happened. */
export function parseTransitionObservations(raw: string): TransitionObservations {
  const json = JSON.parse(raw);
  const snapshot = snapshotSchema.safeParse(json);

  if (snapshot.success) return fromSnapshot(snapshot.data);

  const parsed = observationsSchema.safeParse(json);

  if (!parsed.success) throw new Error(z.prettifyError(parsed.error).replace(/\n+/g, '; '));

  return parsed.data;
}

/** A test run's snapshot, as observations: only what ran in those tests, over their window. */
function fromSnapshot(snapshot: z.infer<typeof snapshotSchema>): TransitionObservations {
  const seen = snapshot.transitions.flatMap(({ firstSeen, lastSeen }) => [firstSeen, lastSeen]);

  seen.sort();

  return {
    spec: TRANSITIONS_SPEC,
    window: { from: seen[0] ?? snapshot.generatedAt, to: seen.at(-1) ?? snapshot.generatedAt },
    source: `snapshot of ${snapshot.service}`,
    instrumented: snapshot.transitions.map(({ entity, field }) => ({ entity, field })),
    transitions: snapshot.transitions,
  };
}

export const FLOW_EVIDENCE_SPEC = 'autocatalog-flow-evidence/v0.1.0';

/** Where a repository keeps its evidence, beside the flows it is about. */
export const FLOW_EVIDENCE_FILE = 'flows/evidence.json';

/**
 * One transition's evidence, each dimension on its own. There is deliberately
 * no overall status: a state in a schema says nothing of whether it is reached,
 * and a production count says nothing of why.
 */
export interface TransitionEvidence {
  flow: string;
  step: string;
  entity: string;
  field: string;
  from: string[];
  to: string;
  via?: string | undefined;
  /** Its states are in the entity's lifecycle. */
  declared: 'yes' | 'no';
  /** Its states are in the field's schema enum. */
  schema: 'yes' | 'no' | 'not checked';
  /** The code the step links to is there, at `commit`. */
  code: 'yes' | 'no' | 'not checked';
  /** `not instrumented` is not `not observed`: nobody could have seen it. */
  observed: 'yes' | 'not observed' | 'not instrumented' | 'not checked';
  /** A rule in prose is never checked. A linked test is linked, not proven. */
  rules: 'none' | 'not checked' | 'test linked';
  count?: number | undefined;
  /** Recorded with another `via`, so not counted as this step. */
  otherVia?: Record<string, number> | undefined;
}

export interface UndeclaredTransition {
  entity: string;
  field: string;
  from: string;
  to: string;
  via: string;
  count: number;
}

/** A versioned record of one comparison. Agents explain it; they do not decide it. */
export interface FlowEvidence {
  spec: typeof FLOW_EVIDENCE_SPEC;
  /** When it was checked, so a reader can tell old evidence from current. */
  checkedAt: string;
  /** The commit the code was checked at. */
  commit?: string | undefined;
  window?: { from: string; to: string } | undefined;
  source?: string | undefined;
  transitions: TransitionEvidence[];
  /** Recorded at runtime, and in no flow. */
  undeclared: UndeclaredTransition[];
}

export interface VerifyFlowsInput {
  flows: Flow[];
  entities: LifecycleEntity[];
  /** The checkout code and test links are relative to. */
  dir: string;
  checkedAt: string;
  commit?: string | undefined;
  observations?: TransitionObservations | undefined;
  /** Every flow in this check, so a sibling repository's transition reads as declared. */
  allFlows?: Flow[] | undefined;
}

// A link must stay in the checkout, and be a file: a flow is data, and could name
// any path, a symlink out of the repository, or a pipe that never finishes reading.
function fileText(dir: string, file: string): string | undefined {
  try {
    const full = inside(dir, file);

    return fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

function codeOf(step: FlowStep, dir: string): TransitionEvidence['code'] {
  if (step.code.length === 0) return 'not checked';

  return step.code.every(({ file, contains }) => {
    const found = fileText(dir, file);

    return found !== undefined && (contains === undefined || found.includes(contains));
  })
    ? 'yes'
    : 'no';
}

function rulesOf(step: FlowStep, dir: string): TransitionEvidence['rules'] {
  if (step.rules.length === 0) return 'none';

  return step.rules.every(({ test }) => test && fileText(dir, test) !== undefined)
    ? 'test linked'
    : 'not checked';
}

function schemaOf(
  transition: FlowTransition,
  entity: LifecycleEntity | undefined,
): TransitionEvidence['schema'] {
  const values = entity?.properties?.find(({ name }) => name === transition.field)?.enum;

  if (!values) return 'not checked';

  return statesOf(transition).every((name) => values.includes(name)) ? 'yes' : 'no';
}

/**
 * A backend can rewrite a value on the way through: Datadog tags come back in
 * lower case with spaces as underscores. `Missing Info` is `missing_info` there.
 */
export const sameValue = (a: string, b: string) => normalised(a) === normalised(b);

const normalised = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_');

const sameTarget = (
  row: { entity: string; field: string; from: string; to: string },
  { entity, field, from, to }: { entity: string; field: string; from: string[]; to: string },
) =>
  sameValue(row.entity, entity) &&
  sameValue(row.field, field) &&
  from.some((state) => sameValue(row.from, state)) &&
  sameValue(row.to, to);

function observedOf(
  transition: FlowTransition,
  observations: TransitionObservations | undefined,
): Pick<TransitionEvidence, 'observed' | 'count' | 'otherVia'> {
  if (!observations) return { observed: 'not checked' };

  const { entity, field, via } = transition;

  const instrumented = observations.instrumented.some(
    (candidate) => sameValue(candidate.entity, entity) && sameValue(candidate.field, field),
  );

  if (!instrumented) return { observed: 'not instrumented' };

  const rows = observations.transitions.filter((row) => sameTarget(row, transition));

  const mine = via ? rows.filter((row) => sameValue(row.via, via)) : rows;
  const count = mine.reduce((sum, row) => sum + row.count, 0);
  const others = new Map<string, number>();

  for (const row of via ? rows.filter((candidate) => !sameValue(candidate.via, via)) : []) {
    others.set(row.via, (others.get(row.via) ?? 0) + row.count);
  }

  return {
    observed: count > 0 ? 'yes' : 'not observed',
    count,
    ...(others.size > 0 && { otherVia: Object.fromEntries(others) }),
  };
}

/** The same input gives the same record: the comparison is never an agent's judgement. */
export function verifyFlows(input: VerifyFlowsInput): FlowEvidence {
  const { flows, entities, dir, checkedAt, commit, observations, allFlows = flows } = input;

  const transitions = flows.flatMap((flow) =>
    flow.steps.flatMap((step): TransitionEvidence[] => {
      const { transition } = step;

      if (!transition) return [];

      const entity = entities.find((candidate) => candidate.id === transition.entity);
      const lifecycle = lifecycleOf(entity, transition.field);

      return [
        {
          flow: flow.id,
          step: step.id,
          entity: transition.entity,
          field: transition.field,
          from: transition.from,
          to: transition.to,
          ...(transition.via && { via: transition.via }),
          declared: statesOf(transition).every((name) => lifecycle?.states.includes(name))
            ? 'yes'
            : 'no',
          schema: schemaOf(transition, entity),
          code: codeOf(step, dir),
          rules: rulesOf(step, dir),
          ...observedOf(transition, observations),
        },
      ];
    }),
  );

  const declared = allFlows.flatMap((flow) =>
    flow.steps.flatMap(({ transition }) => (transition ? [transition] : [])),
  );

  const undeclared = (observations?.transitions ?? []).flatMap(
    ({ entity, field, from, to, via, count }): UndeclaredTransition[] =>
      declared.some((row) => sameTarget({ entity, field, from, to }, row))
        ? []
        : [{ entity, field, from, to, via, count }],
  );

  return {
    spec: FLOW_EVIDENCE_SPEC,
    checkedAt,
    ...(commit && { commit }),
    ...(observations && { window: observations.window, source: observations.source }),
    transitions,
    undeclared,
  };
}

const sameStates = (a: string[], b: string[]) =>
  a.length === b.length && a.every((name) => b.includes(name));

/**
 * The record for what a step claims now. A step edited since `ac flows verify`
 * ran has no record: its old results were about a different claim.
 */
export function stepEvidence(
  evidence: FlowEvidence | undefined,
  flow: Flow,
  { id, transition }: FlowStep,
): TransitionEvidence | undefined {
  if (!transition) return undefined;

  return evidence?.transitions.find(
    (row) =>
      row.flow === flow.id &&
      row.step === id &&
      row.entity === transition.entity &&
      row.field === transition.field &&
      row.to === transition.to &&
      row.via === transition.via &&
      sameStates(row.from, transition.from),
  );
}

const transitionEvidence = z.looseObject({
  flow: state,
  step: state,
  entity: state,
  field: state,
  from: z.array(state),
  to: state,
  via: state.optional(),
  declared: z.enum(['yes', 'no']),
  schema: z.enum(['yes', 'no', 'not checked']),
  code: z.enum(['yes', 'no', 'not checked']),
  observed: z.enum(['yes', 'not observed', 'not instrumented', 'not checked']),
  rules: z.enum(['none', 'not checked', 'test linked']),
  count: z.number().optional(),
  otherVia: z.record(state, z.number()).optional(),
});

const evidenceSchema = z.looseObject({
  spec: z.literal(FLOW_EVIDENCE_SPEC),
  checkedAt: state,
  commit: state.optional(),
  window: z.strictObject({ from: state, to: state }).optional(),
  source: state.optional(),
  transitions: z.array(transitionEvidence),
  undeclared: z.array(
    z.looseObject({
      entity: state,
      field: state,
      from: state,
      to: state,
      via: state,
      count: z.number(),
    }),
  ),
});

// A real directory only: a symlink could point anywhere on the build machine.
const realFlowsFolder = (dir: string) =>
  fs.lstatSync(path.join(dir, FLOWS_DIR), { throwIfNoEntry: false })?.isDirectory() === true;

/** Saves the record, refusing to follow a link a checkout could use to overwrite another file. */
export function writeFlowEvidence(dir: string, evidence: FlowEvidence): void {
  if (!realFlowsFolder(dir)) throw new Error(`${FLOWS_DIR} is not a real folder`);

  const target = path.join(dir, FLOW_EVIDENCE_FILE);

  // Windows has no O_NOFOLLOW, so the flag alone would write through the link.
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`${FLOW_EVIDENCE_FILE} is a link`);

  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;

  const file = fs.openSync(target, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);

  try {
    fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    fs.closeSync(file);
  }
}

/** A repository's committed evidence, or nothing when it has none it can stand behind. */
export function readFlowEvidence(dir: string): FlowEvidence | undefined {
  const file = path.join(dir, FLOW_EVIDENCE_FILE);

  try {
    if (!realFlowsFolder(dir) || !fs.lstatSync(file).isFile()) return undefined;

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

    return evidenceSchema.parse(raw);
  } catch {
    return undefined;
  }
}
