import fs from 'node:fs';
import path from 'node:path';
import {
  normaliseEventId,
  parseFrontmatter,
  resourceKey,
  type WorkflowObservation,
  type WorkflowStepObservation,
  type CatalogRelationship,
  type CatalogResource,
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { aboutReference, resolveAbout } from './about';

/** Where a repository keeps its process flows: one Markdown file each. */
export const FLOWS_DIR = 'flows';

/** What a step stands for: a catalog resource, or someone or something outside it. */
export type FlowStepKind = 'event' | 'service' | 'agent' | 'actor' | 'external' | 'custom';

export interface FlowStep {
  id: string;
  title: string;
  summary?: string | undefined;
  kind: FlowStepKind;
  /** The resource it names, for an event, service or agent step. */
  ref?: ResourceRef | undefined;
  /** Where an external system or custom step links to. */
  url?: string | undefined;
  /** The steps it leads to, in the order written, each with its branch label. */
  next: Array<{ id: string; label?: string | undefined }>;
  /** The lanes the author puts it in, over what the catalog says. */
  lane?: StepLane | undefined;
  /** The step that undoes this one when a later step fails, such as a refund for a charge. */
  compensatedBy?: { id: string; label?: string | undefined } | undefined;
}

/** What a flow's steps can be grouped by, as EventCatalog's visualiser names them. */
export type FlowGroupBy = 'domain' | 'system' | 'team' | 'domain-system';

/** A step's lanes by name: the domain, system or team it sits in. */
export type StepLane = Partial<Record<'domain' | 'system' | 'team', string>>;

/**
 * A business process a repository declares: the steps in order, with their
 * branches. Declared, never inferred: events joining two services do not make
 * a process, so a flow is checked against the catalog but not derived from it.
 */
export interface Flow {
  repository: string;
  /** Its file name without `.md`, its page's segment. */
  id: string;
  /** Where the repository keeps it, from the repository's root. */
  file: string;
  title: string;
  summary?: string | undefined;
  /** The Markdown narrative below the frontmatter. */
  body: string;
  steps: FlowStep[];
  /** How its map is grouped when it opens: by what, and as lanes or boxes. */
  lanes?: { by: FlowGroupBy; style: 'lanes' | 'boxes' } | undefined;
  /** The workflow that runs it, as autotel names it, when that is not its id or title. */
  workflow?: string | undefined;
}

const text = z.string().trim().min(1);

// A step's link is followed when its node is clicked: web addresses only, never `javascript:`.
const link = z.url({ protocol: /^https?$/ });

const stepId = z.union([text, z.number().transform(String)]);

// A step it leads to, by id alone or with the label its branch carries.
const target = z.union([
  stepId.transform((id) => ({ id })),
  z.object({ id: stepId, label: text.optional() }).strict(),
]);

// A step names an event as `domain/id`, the form `about:` and consumers use.
const stepSchema = z
  .object({
    id: stepId,
    title: text.optional(),
    summary: text.optional(),
    event: text.optional(),
    service: text.optional(),
    agent: text.optional(),
    actor: z.object({ name: text, summary: text.optional() }).strict().optional(),
    externalSystem: z
      .object({ name: text, summary: text.optional(), url: link.optional() })
      .strict()
      .optional(),
    custom: z
      .object({ title: text.optional(), summary: text.optional(), url: link.optional() })
      .strict()
      .optional(),
    next_step: target.optional(),
    next_steps: z.array(target).optional(),
    compensated_by: target.optional(),
    lane: z
      .object({ domain: text.optional(), system: text.optional(), team: text.optional() })
      .strict()
      .refine((lane) => Object.keys(lane).length > 0, 'name a domain, system or team')
      .optional(),
  })
  .strict();

const groupBy = z.enum(['domain', 'system', 'team', 'domain-system']);

// `lanes: team` groups by team as boxes; the object form also picks the style.
const lanesSchema = z.union([
  groupBy.transform((by) => ({ by, style: 'boxes' as const })),
  z.object({ by: groupBy, style: z.enum(['lanes', 'boxes']).default('boxes') }).strict(),
]);

const flowSchema = z
  .object({
    title: text,
    summary: text.optional(),
    lanes: lanesSchema.optional(),
    workflow: text.optional(),
    steps: z.array(stepSchema).min(1),
  })
  .strict();

type AuthoredStep = z.infer<typeof stepSchema>;

const POINTERS = ['event', 'service', 'agent', 'actor', 'externalSystem', 'custom'] as const;

export interface ReadFlowsResult {
  flows: Flow[];
  /** One line per flow left out, naming its file and what is wrong. */
  failures: string[];
  /**
   * One line per hop the catalog does not back: the flow says a service
   * produces an event, and no producer declaration says so.
   */
  warnings: string[];
}

/**
 * The flows each repository declares under `flows/`, with each step's
 * resource resolved against the composed catalog the way `about:` is. A flow
 * that does not hold together is left out and named, and the others publish.
 */
export interface ReadFlowsOptions {
  /**
   * Leave a step naming nothing in `catalog` unresolved rather than failing
   * its flow. One checkout holds only its own resources, so a flow naming
   * another repository's event is checked by the composed site instead.
   */
  deferMissing?: boolean;
}

export function readFlows(
  repositories: Array<{ repository: string; dir: string }>,
  catalog: { resources: CatalogResource[]; relationships: CatalogRelationship[] },
  options: ReadFlowsOptions = {},
): ReadFlowsResult {
  const result: ReadFlowsResult = { flows: [], failures: [], warnings: [] };

  for (const { repository, dir } of repositories) {
    const folder = path.join(dir, FLOWS_DIR);

    // A real directory only: a symlink could point anywhere on the build machine.
    if (!fs.lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) continue;

    let entries: fs.Dirent[];

    // One repository's unreadable folder leaves its flows out, not everyone's.
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      result.failures.push(
        `${repository}/${FLOWS_DIR}: not read — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const file = `${FLOWS_DIR}/${entry.name}`;
      const where = `${repository}/${file}`;

      try {
        const flow = readFlow(
          repository,
          file,
          fs.readFileSync(path.join(folder, entry.name), 'utf8'),
          catalog.resources,
          options,
        );

        result.flows.push(flow);

        // The walkthrough starts at the first step nothing leads to.
        const targets = new Set(
          flow.steps.flatMap((step) => [
            ...step.next.map(({ id }) => id),
            ...(step.compensatedBy ? [step.compensatedBy.id] : []),
          ]),
        );

        if (flow.steps.every((step) => targets.has(step.id))) {
          result.warnings.push(
            `${where}: every step has one leading to it, so its walkthrough has nowhere to start`,
          );
        }

        result.warnings.push(
          ...unbacked(flow, catalog.relationships).map((line) => `${where}: ${line}`),
        );
      } catch (error) {
        result.failures.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  result.flows.sort((a, b) => a.repository.localeCompare(b.repository) || a.id.localeCompare(b.id));

  return result;
}

function readFlow(
  repository: string,
  file: string,
  raw: string,
  resources: CatalogResource[],
  options: ReadFlowsOptions,
): Flow {
  const id = path.posix.basename(file, '.md');

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`'${id}' cannot be a page's address; use letters, digits, '.', '-' and '_'`);
  }

  const { data, content } = parseFrontmatter(raw);

  const parsed = flowSchema.safeParse(data);

  if (!parsed.success) throw new Error(z.prettifyError(parsed.error).replace(/\n+/g, '; '));

  const ids = new Set<string>();

  for (const step of parsed.data.steps) {
    if (ids.has(step.id)) throw new Error(`step '${step.id}' appears twice`);
    ids.add(step.id);
  }

  const steps = parsed.data.steps.map((step) =>
    resolveStep(step, ids, resources, repository, options),
  );

  return {
    repository,
    id,
    file,
    title: parsed.data.title,
    summary: parsed.data.summary,
    body: content.trim(),
    steps,
    lanes: parsed.data.lanes,
    workflow: parsed.data.workflow,
  };
}

/** A workflow's runs from one repository's runtime snapshot. */
export interface WorkflowRuns {
  repository: string;
  workflow: WorkflowObservation;
}

const sameName = (a: string, b: string) => normaliseEventId(a) === normaliseEventId(b);

/**
 * The runs of the workflow that carries out a flow: the one its `workflow:`
 * names, or failing that one named as the flow is. The flow's own repository
 * wins when two record the same name; with neither, two is one too many to
 * guess between.
 */
export interface FlowWorkflow {
  found?: WorkflowRuns;
  /** The repositories that each record a workflow it could be, when more than one does. */
  ambiguous: string[];
}

export function flowWorkflow(flow: Flow, runs: WorkflowRuns[]): FlowWorkflow {
  const names = flow.workflow ? [flow.workflow] : [flow.id, flow.title];

  const named = runs.filter((run) => names.some((name) => sameName(name, run.workflow.name)));
  const own = named.filter((run) => run.repository === flow.repository);
  const pick = own.length > 0 ? own : named;

  return pick.length === 1
    ? { found: pick[0]!, ambiguous: [] }
    : { ambiguous: pick.map((run) => run.repository).sort() };
}

/**
 * Each flow step's runs, matched to the workflow step of the same id or title,
 * and the workflow steps no flow step names.
 */
export interface FlowStepRuns {
  /** By flow step id. */
  steps: Map<string, WorkflowStepObservation>;
  /** Workflow steps no flow step names. */
  unnamed: string[];
}

export function flowStepRuns(flow: Flow, workflow: WorkflowObservation): FlowStepRuns {
  const steps = new Map<string, WorkflowStepObservation>();
  const unnamed: string[] = [];

  for (const ran of workflow.steps) {
    const step = flow.steps.find(
      (candidate) => sameName(candidate.id, ran.name) || sameName(candidate.title, ran.name),
    );

    if (step) steps.set(step.id, ran);
    else unnamed.push(ran.name);
  }

  return { steps, unnamed };
}

function resolveStep(
  step: AuthoredStep,
  ids: Set<string>,
  resources: CatalogResource[],
  repository: string,
  options: ReadFlowsOptions,
): FlowStep {
  const named = POINTERS.filter((pointer) => step[pointer] !== undefined);

  if (named.length > 1) {
    throw new Error(`step '${step.id}' names ${named.join(' and ')}; a step is one thing`);
  }

  const next = [
    ...(step.next_step === undefined ? [] : [step.next_step]),
    ...(step.next_steps ?? []),
  ];

  for (const { id } of next) {
    if (!ids.has(id)) throw new Error(`step '${step.id}' leads to '${id}', which is not a step`);
  }

  const compensatedBy = step.compensated_by;

  if (compensatedBy && !ids.has(compensatedBy.id)) {
    throw new Error(
      `step '${step.id}' is compensated by '${compensatedBy.id}', which is not a step`,
    );
  }

  if (compensatedBy?.id === step.id) {
    throw new Error(`step '${step.id}' cannot compensate itself`);
  }

  const base = { id: step.id, summary: step.summary, next, lane: step.lane, compensatedBy };

  if (step.event ?? step.service ?? step.agent) {
    const kind = step.event ? 'event' : step.service ? 'service' : 'agent';

    const reference = `${kind}/${step.event ?? step.service ?? step.agent}`;

    const resolution = resolveAbout(reference, resources, repository);

    const missing = !resources.some((resource) => aboutReference(resource) === reference);

    if ('failure' in resolution && options.deferMissing && missing) {
      return { ...base, kind, title: step.title ?? reference.slice(kind.length + 1) };
    }

    if ('failure' in resolution) {
      throw new Error(`step '${step.id}': ${resolution.failure.replace(/^about /, '')}`);
    }

    const resource = resources.find(
      (candidate) => resourceKey(candidate.ref) === resourceKey(resolution.ref),
    );

    return {
      ...base,
      kind,
      ref: resolution.ref,
      title: step.title ?? resource?.title ?? resolution.ref.id,
      summary: step.summary ?? resource?.summary,
    };
  }

  if (step.actor) {
    return {
      ...base,
      kind: 'actor',
      title: step.title ?? step.actor.name,
      summary: step.summary ?? step.actor.summary,
    };
  }

  if (step.externalSystem) {
    return {
      ...base,
      kind: 'external',
      title: step.title ?? step.externalSystem.name,
      summary: step.summary ?? step.externalSystem.summary,
      url: step.externalSystem.url,
    };
  }

  return {
    ...base,
    kind: 'custom',
    title: step.title ?? step.custom?.title ?? step.id,
    summary: step.summary ?? step.custom?.summary,
    url: step.custom?.url,
  };
}

/**
 * The hops a flow declares that no producer or consumer declaration backs: a
 * service or agent leading to an event it is not said to produce, or an event
 * leading to one it is not said to reach.
 */
function unbacked(flow: Flow, relationships: CatalogRelationship[]): string[] {
  const edges = new Set(
    relationships.flatMap(({ type, from, to }) =>
      type === 'produces' || type === 'consumes'
        ? [`${type} ${resourceKey(from)} ${resourceKey(to)}`]
        : [],
    ),
  );

  const steps = new Map(flow.steps.map((step) => [step.id, step]));
  const actors = new Set(['service', 'agent']);

  return flow.steps.flatMap((step) =>
    step.next.flatMap(({ id }) => {
      const after = steps.get(id)!;

      if (!step.ref || !after.ref) return [];

      if (actors.has(step.kind) && after.kind === 'event') {
        return edges.has(`produces ${resourceKey(step.ref)} ${resourceKey(after.ref)}`)
          ? []
          : [`${step.title} produces ${after.title} here, and no producer declaration says so`];
      }

      if (step.kind === 'event' && actors.has(after.kind)) {
        return edges.has(`consumes ${resourceKey(step.ref)} ${resourceKey(after.ref)}`)
          ? []
          : [`${after.title} consumes ${step.title} here, and no consumer declaration says so`];
      }

      return [];
    }),
  );
}
