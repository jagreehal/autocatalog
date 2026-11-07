import {
  checkLifecycles,
  flowNotes,
  lifecycleKey,
  readDocs,
  readDomainModel,
  readFlowEvidence,
  readFlows,
  stepEvidence,
} from 'autocatalog-docs-core';
import { checkouts, pickOne } from './knowledge.js';
import type { CatalogSnapshot } from './tools.js';

/**
 * A flow as support needs it: each step's transition, rules, stuck signs and
 * notes, with the committed evidence. For exploring a problem: an agent can
 * explain this record and read autotel-mcp beside it, but `ac flows verify`
 * decides what counts as a match.
 */
export function flowContext(
  catalog: CatalogSnapshot,
  id?: string,
  company?: string,
  audience: readonly string[] = [],
  graph = catalog.mapGraph,
) {
  const repositories = checkouts(catalog, company);

  const { flows, failures } = readFlows(repositories, graph, { deferMissing: true });

  if (!id) {
    return {
      flows: flows.map((flow) => ({
        id: flow.id,
        repository: flow.repository,
        title: flow.title,
        summary: flow.summary,
      })),
    };
  }

  const flow = pickOne(flows, id);

  if (!flow) {
    throw new Error(
      failures.find((line) => line.includes(`/flows/${id}.md:`)) ??
        `No flow '${id}' under flows/. Flows here: ${flows.map((f) => f.id).join(', ') || 'none'}`,
    );
  }

  const { repository } = flow;
  const dir = repositories.find((candidate) => candidate.repository === repository)!.dir;
  const { entities } = readDomainModel(repositories, graph, { deferMissing: true });

  // One repository's unparsable document must not cost every flow its context.
  const documents = readDocs(company ?? catalog.repoRoot, {
    ...(!company && { repo: repository }),
    audience,
    onUnreadable: () => undefined,
  });

  const notes = flowNotes(documents, [flow]).notes;
  const evidence = readFlowEvidence(dir);

  const lifecycles = new Map(
    flow.steps.flatMap(({ transition }) =>
      transition
        ? [
            [
              lifecycleKey(transition.entity, transition.field),
              { entity: transition.entity, field: transition.field },
            ] as const,
          ]
        : [],
    ),
  );

  return {
    flow: { id: flow.id, title: flow.title, summary: flow.summary, repository },
    howToRead:
      'A draft finding or a question is a hypothesis, not established behaviour. Each evidence dimension stands alone: a count says a transition was recorded, not why, and not instrumented does not mean broken.',
    steps: flow.steps.map((step) => ({
      id: step.id,
      title: step.title,
      summary: step.summary,
      transition: step.transition,
      rules: step.rules,
      stuck: step.stuck,
      notes: notes.filter((note) => note.step === step.id),
      // A step edited since the check is unchecked, whatever the old record said.
      evidence:
        stepEvidence(evidence, flow, step) ??
        (step.transition && evidence ? 'not checked' : undefined),
    })),
    notes: notes.filter((note) => !note.step),
    evidence: evidence && {
      checkedAt: evidence.checkedAt,
      commit: evidence.commit,
      window: evidence.window,
      source: evidence.source,
    },
    lifecycleProblems: checkLifecycles([flow], entities, { deferMissing: true }).failures,
    observe: [...lifecycles.values()].map((input) => ({
      tool: 'autotel-mcp get_state_transitions',
      input,
    })),
  };
}
