import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import type { ResourceRef } from 'autocatalog-core';
import type { WorkflowStepObservation } from 'autocatalog-core';
import {
  bigPicture,
  flowDiagram,
  type FlowEvidence,
  type FlowNote,
  flowStepRuns,
  sameValue,
  stepEvidence,
  flowWorkflow,
  stormBoard,
  type StormSticky,
  stormed,
  type Flow,
  type FlowStep,
  type TransitionEvidence,
} from 'autocatalog-docs-core';
import type { DocsCatalog } from './catalog';
import { remarkMermaid } from './mermaid';
import { remarkWikiRefs } from './wiki-refs';
import type { ResourceLinksProps } from './ui/components/ResourceLinks';
import type { StormColumnView } from './ui/components/Storm';
import type { VisualiserGraph } from './ui/lib/visualiser';
import { docPage } from './ui/lib/docs';
import type {
  FlowPageEvidence,
  FlowPageEvidenceSummary,
  FlowPageNote,
  FlowPageProps,
  FlowStormView,
  FlowsPageProps,
} from './ui/pages';
import { pageOf, type CatalogGraphOptions } from './visualiser';

/** Where a flow's page lives on the site, relative to its base. */
export const flowPath = (flow: Flow) => `flows/${flow.repository}/${flow.id}/`;

/** A flow's map (see `flowDiagram`), with where each step links. */
export function flowVisualiser(
  flow: Flow,
  catalog: Pick<DocsCatalog, 'graph'>,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
  notes: FlowNote[] = [],
): VisualiserGraph {
  const { nodes, edges, steps, lanes, resources } = flowDiagram(flow, catalog.graph);

  // Said in the label as well as the list, so a problem is on the map itself.
  const open = openHotspots(flow, notes);

  const marked = nodes.map((node) => {
    const count = open.get(node.id);

    return count ? { ...node, label: `${node.label} (${count} open)` } : node;
  });

  const hrefs: Record<string, string> = {};

  for (const step of flow.steps) {
    const resource = resources[step.id];
    const href = resource ? pageOf(resource, base, pages) : step.url;

    if (href) hrefs[step.id] = href;
  }

  return {
    graph: { nodes: marked, edges, options: { legend: true, search: nodes.length > 6 } },
    hrefs,
    ...(steps && { steps }),
    ...(lanes && { lanes }),
  };
}

const notesOf = (flow: Flow, notes: FlowNote[]) =>
  notes.filter((note) => note.repository === flow.repository && note.flow === flow.id);

function openHotspots(flow: Flow, notes: FlowNote[]): Map<string, number> {
  const open = new Map<string, number>();

  for (const { hotspot, step } of notesOf(flow, notes)) {
    if (hotspot && step) open.set(step, (open.get(step) ?? 0) + 1);
  }

  return open;
}

const noteRow = (note: FlowNote, base: string): FlowPageNote => ({
  title: note.title,
  href: `${base}${docPage(note.id)}/`,
  nature: note.nature,
  status: note.status,
  hotspot: note.hotspot,
});

/** Evidence older than this reads as old on the page: it may no longer be true. */
const STALE_DAYS = 30;

const DAY = 86_400_000;

const staleAt = (checkedAt: string, now: number) => now - Date.parse(checkedAt) > STALE_DAYS * DAY;

const observedLine = (row: TransitionEvidence) => {
  const other = Object.entries(row.otherVia ?? {}).map(([via, count]) => `${count} via ${via}`);
  const seen = row.count === undefined ? row.observed : `${row.observed}, ${row.count}`;

  return other.length > 0 ? `${seen}; also ${other.join(', ')}` : seen;
};

/** Each dimension on its own line: there is no overall verdict to show. */
const EVIDENCE_LABELS = [
  'Declared in model',
  'In the schema',
  'Code linked',
  'Observed',
  'Business rules',
];

const evidenceRows = (row: TransitionEvidence): FlowPageEvidence[] =>
  [row.declared, row.schema, row.code, observedLine(row), row.rules].map((value, index) => ({
    label: EVIDENCE_LABELS[index]!,
    value,
  }));

/** A transition the record does not cover reads unchecked, so nothing old passes as current. */
function stepEvidenceRows(
  evidence: FlowEvidence | undefined,
  flow: Flow,
  step: FlowStep,
): FlowPageEvidence[] {
  if (!evidence || !step.transition) return [];

  const row = stepEvidence(evidence, flow, step);

  return row
    ? evidenceRows(row)
    : EVIDENCE_LABELS.map((label) => ({ label, value: 'not checked' }));
}

function evidenceSummary(evidence: FlowEvidence, flow: Flow, now: number): FlowPageEvidenceSummary {
  const transitions = flow.steps.flatMap(({ transition }) => (transition ? [transition] : []));

  return {
    checkedAt: evidence.checkedAt,
    commit: evidence.commit,
    window: evidence.window,
    source: evidence.source,
    stale: staleAt(evidence.checkedAt, now),
    undeclared: evidence.undeclared
      .filter(({ entity, field }) =>
        transitions.some(
          (transition) =>
            sameValue(transition.entity, entity) && sameValue(transition.field, field),
        ),
      )
      .map(
        ({ from, to, via, count }) =>
          `${from} → ${to}, recorded ${times(count)} via ${via}, is in no flow.`,
      ),
  };
}

// A flow's narrative is prose and diagrams: fences stay plain, and the page's
// own highlighter colours them, so Shiki is not loaded for it.
let processor: ReturnType<typeof createMarkdownProcessor> | undefined;

// `[[kind|id]]` links read as they do in documents, under the site's base.
const narrative = () =>
  (processor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    remarkPlugins: [
      remarkMermaid,
      [remarkWikiRefs, { base: (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') }],
    ],
  }));

/** A flow's, design's or overview's Markdown body as HTML. */
export const renderNarrative = async (body: string) =>
  (await (await narrative()).render(body)).code;

/** Where a step sits in its flow page's list, so a sticky can lead to its facts. */
export const stepAnchor = (id: string) => `step-${id.replace(/[^\w-]+/g, '-')}`;

/**
 * A flow as an EventStorming board, with each sticky leading to its step, each
 * hotspot to the finding that raised it, and each zoom-in to its own board.
 */
export function flowStormView(
  flow: Flow,
  catalog: Pick<DocsCatalog, 'flows' | 'flowNotes'>,
  base: string,
): FlowStormView {
  const board = stormBoard(flow, catalog.flowNotes);
  const titles = new Map(flow.steps.map((step) => [step.id, step.title]));

  const view = (stickies: StormSticky[]) =>
    stickies.map((sticky) => ({
      kind: sticky.kind,
      text: sticky.text,
      summary: sticky.summary,
      hotspots: sticky.hotspots,
      code: sticky.code,
      href: sticky.step && `${base}${flowPath(flow)}#${stepAnchor(sticky.step)}`,
    }));

  const columns: StormColumnView[] = board.columns.map((column) => {
    const zoom = column.subflow
      ? catalog.flows.find(
          (candidate) => `${candidate.repository}/${candidate.id}` === column.subflow,
        )
      : undefined;

    return {
      stage: column.stage,
      repeats: column.repeats,
      subflow: zoom && { title: zoom.title, href: `${base}${flowPath(zoom)}` },
      rows: {
        who: view(column.rows.who),
        command: view(column.rows.command),
        decidedBy: view(column.rows.decidedBy),
        happy: view(column.rows.happy),
        failure: view(column.rows.failure),
        policy: view(column.rows.policy),
      },
    };
  });

  return {
    stormed: stormed(flow),
    columns,
    hotspots: board.hotspots.map((hotspot) => ({
      title: hotspot.title,
      step: hotspot.step && titles.get(hotspot.step),
      href: hotspot.note ? `${base}${docPage(hotspot.note)}/` : undefined,
      nature: hotspot.nature,
      status: hotspot.status,
      derived: hotspot.derived,
    })),
    endings: board.endings,
    scenarios: board.scenarios,
  };
}

export async function flowPageProps(
  flow: Flow,
  catalog: Pick<DocsCatalog, 'graph' | 'workflows' | 'flowNotes' | 'flowEvidence' | 'flows'>,
  base: string,
  pages: Pick<CatalogGraphOptions, 'servicePages' | 'eventPages'>,
  now = Date.now(),
): Promise<FlowPageProps> {
  const notes = notesOf(flow, catalog.flowNotes);
  const visualiser = flowVisualiser(flow, catalog, base, pages, notes);
  const evidence = catalog.flowEvidence.get(flow.repository);

  const titles = new Map(flow.steps.map((step) => [step.id, step.title]));

  const { found } = flowWorkflow(flow, catalog.workflows);
  const ran = found && flowStepRuns(flow, found.workflow);

  return {
    runtime: found && {
      workflow: found.workflow.name,
      repository: found.repository,
      summary: runsLine(found.workflow.runs, [
        [found.workflow.completed, 'completed'],
        [found.workflow.failed, 'failed'],
        [found.workflow.compensated, 'compensated'],
        [found.workflow.compensationFailed, 'failed to compensate'],
      ]),
      unnamed: ran?.unnamed ?? [],
      sampleTraceIds: found.workflow.sampleTraceIds ?? [],
    },
    repository: flow.repository,
    file: flow.file,
    visualiser,
    storm: flowStormView(flow, catalog, base),
    notes: notes.filter((note) => !note.step).map((note) => noteRow(note, base)),
    evidence: evidence && evidenceSummary(evidence, flow, now),
    // The same steps as a list: for a reader without JavaScript, and for one
    // who would rather read the process than look at it.
    steps: flow.steps.map((step) => ({
      id: step.id,
      anchor: stepAnchor(step.id),
      title: step.title,
      kind: step.kind,
      summary: step.summary,
      href: visualiser.hrefs[step.id],
      next: step.next.map((next) => ({ title: titles.get(next.id) ?? next.id, label: next.label })),
      compensatedBy:
        step.compensatedBy && (titles.get(step.compensatedBy.id) ?? step.compensatedBy.id),
      runtime: stepLine(ran?.steps.get(step.id)),
      transition: step.transition && {
        field: `${step.transition.entity}.${step.transition.field}`,
        change: `${step.transition.from.join(' or ')} → ${step.transition.to}`,
        via: step.transition.via,
      },
      rules: step.rules.map(({ text }) => text),
      stuck: step.stuck,
      notes: notes.filter((note) => note.step === step.id).map((note) => noteRow(note, base)),
      evidence: stepEvidenceRows(evidence, flow, step),
    })),
    narrativeHtml: flow.body ? await renderNarrative(flow.body) : null,
  };
}

const times = (count: number) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? 'time' : 'times'}`;

/** "Ran 12 times: 10 completed, 2 compensated." */
function runsLine(runs: number, outcomes: Array<[number | undefined, string]>): string {
  const parts = outcomes.flatMap(([count, label]) =>
    count ? [`${count.toLocaleString('en-GB')} ${label}`] : [],
  );

  return `Ran ${times(runs)}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
}

const stepLine = (ran: WorkflowStepObservation | undefined) =>
  ran &&
  runsLine(ran.count, [
    [ran.failed, 'failed'],
    [ran.skipped, 'skipped'],
    [ran.compensated, 'compensated'],
    [ran.compensationFailed, 'failed to compensate'],
  ]);

export function flowsPageProps(
  flows: Flow[],
  base: string,
  notes: FlowNote[] = [],
): FlowsPageProps {
  const byKey = new Map(flows.map((flow) => [`${flow.repository}/${flow.id}`, flow]));

  return {
    bigPicture: bigPicture(flows, notes).map((lane) => ({
      title: lane.title,
      summary: lane.summary,
      repository: lane.repository,
      events: lane.events,
      failures: lane.failures,
      hotspots: lane.hotspots,
      href: `${base}${flowPath(byKey.get(`${lane.repository}/${lane.id}`)!)}`,
    })),
    flows: flows.map((flow) => ({
      title: flow.title,
      summary: flow.summary,
      repository: flow.repository,
      steps: flow.steps.length,
      href: `${base}${flowPath(flow)}`,
    })),
  };
}

/** The flows a resource is a step in, as a card on its page; none when it is in none. */
export function flowRecords(flows: Flow[], ref: ResourceRef, base: string): ResourceLinksProps[] {
  // Any version: a page is about the resource, and a step names its current one.
  const same = (step: FlowStep) =>
    step.ref?.kind === ref.kind && step.ref.namespace === ref.namespace && step.ref.id === ref.id;

  const links = flows.flatMap((flow) =>
    flow.steps.some(same)
      ? [{ href: `${base}${flowPath(flow)}`, title: flow.title, label: flow.repository }]
      : [],
  );

  return links.length > 0 ? [{ id: 'flows', heading: 'Flows', links }] : [];
}
