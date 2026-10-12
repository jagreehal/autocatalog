import {
  auditCatalog,
  computeImpact,
  ENTITY_KINDS,
  EntityKindSchema,
  estimateAgentCost,
  filterForAudience,
  groupFindings,
  refKey,
  rollupCost,
  totalMonthlyCost,
  type Catalog,
  type Entity,
  type EntityKind,
  type EntityRef,
  type ImpactReport,
  type RollupKey,
  type Severity,
} from 'autocatalog-agents-core';
import { computeDrift, loadObservations } from 'autocatalog-agents-adapter-autotel';

const parseRef = (s: string): EntityRef => {
  const idx = s.indexOf('/');

  if (idx <= 0 || idx === s.length - 1) {
    throw new Error(`invalid ref "${s}" — expected <kind>/<id>`);
  }

  const rawKind = s.slice(0, idx);
  const kind = EntityKindSchema.safeParse(rawKind);

  if (!kind.success) {
    throw new Error(`unknown kind "${rawKind}" — must be one of ${ENTITY_KINDS.join(', ')}`);
  }

  return { kind: kind.data, id: s.slice(idx + 1) };
};

type EntitySummary = {
  ref: string;
  id: string;
  name: string;
  status: Entity['status'];
  owner: string;
  description?: string;
};

const summarise = (kind: EntityKind, e: Entity): EntitySummary => {
  const summary: EntitySummary = {
    ref: `${kind}/${e.id}`,
    id: e.id,
    name: e.name,
    status: e.status,
    owner: e.owner,
  };

  if (e.description) summary.description = e.description;

  return summary;
};

export const listEntities = (cat: Catalog, kind: EntityKind) => {
  const bucket = cat.entities.get(kind);

  if (!bucket) return [];

  return [...bucket.values()].map((e) => summarise(kind, e));
};

export const describeEntity = (cat: Catalog, refStr: string) => {
  const ref = parseRef(refStr);
  const entity = cat.entities.get(ref.kind)?.get(ref.id);

  if (!entity) throw new Error(`not found: ${refStr}`);
  const meta = cat.meta.get(refKey(ref.kind, ref.id));
  const body = meta?.body ? filterForAudience(meta.body, 'agent').trim() : '';

  return body ? { ref: refStr, ...entity, body } : { ref: refStr, ...entity };
};

/** An impact report with refs flattened to `kind/id`, for a client reading JSON. */
type ImpactResult = {
  subject: string;
  dependsOn: string[];
  dependedOnBy: string[];
  events?: ImpactReport['events'];
};

export const impactEntity = (cat: Catalog, refStr: string) => {
  const ref = parseRef(refStr);

  if (!cat.entities.get(ref.kind)?.has(ref.id)) {
    throw new Error(`not found: ${refStr}`);
  }

  const report = computeImpact(cat, ref);

  const result: ImpactResult = {
    subject: `${report.subject.kind}/${report.subject.id}`,
    dependsOn: report.dependencies.map((d) => `${d.kind}/${d.id}`),
    dependedOnBy: report.dependents.map((d) => `${d.kind}/${d.id}`),
  };

  if (report.events) result.events = report.events;

  return result;
};

const matchesQuery = (query: string, e: Entity): boolean => {
  const q = query.toLowerCase();
  const haystack = [e.id, e.name, e.description ?? '', e.owner].join(' ').toLowerCase();

  return haystack.includes(q);
};

export const searchEntities = (cat: Catalog, query: string) => {
  const results: Array<ReturnType<typeof summarise>> = [];

  for (const kind of ENTITY_KINDS) {
    for (const e of cat.entities.get(kind)?.values() ?? []) {
      if (matchesQuery(query, e)) results.push(summarise(kind, e));
    }
  }

  return results;
};

const attrMatches = (entity: Entity, attribute: string, value: string): boolean => {
  const raw = Object.entries(entity).find(([key]) => key === attribute)?.[1];

  if (raw === undefined || raw === null) return false;

  if (Array.isArray(raw)) return raw.some((v) => String(v) === value);

  return String(raw) === value;
};

export const findBy = (cat: Catalog, attribute: string, value: string) => {
  const results: Array<ReturnType<typeof summarise>> = [];

  for (const kind of ENTITY_KINDS) {
    for (const e of cat.entities.get(kind)?.values() ?? []) {
      if (attrMatches(e, attribute, value)) results.push(summarise(kind, e));
    }
  }

  return results;
};

export const cost = (cat: Catalog, args: { agent?: string; by?: RollupKey }) => {
  if (args.by) {
    return {
      rollup: rollupCost(cat, args.by),
      total: totalMonthlyCost(cat),
    };
  }

  if (args.agent) {
    const id = args.agent.startsWith('agent/') ? args.agent.slice('agent/'.length) : args.agent;

    if (!cat.entities.get('agent')?.has(id)) {
      throw new Error(`unknown agent: ${id}`);
    }

    return estimateAgentCost(cat, id);
  }

  return { total: totalMonthlyCost(cat) };
};

export const audit = (cat: Catalog, args: { minSeverity?: Severity } = {}) => {
  const findings = auditCatalog(cat);

  const filtered = args.minSeverity
    ? findings.filter((f) => {
        const order = { P0: 0, P1: 1, P2: 2 };

        return order[f.severity] <= order[args.minSeverity!];
      })
    : findings;

  const grouped = groupFindings(filtered);

  return {
    counts: { P0: grouped.P0.length, P1: grouped.P1.length, P2: grouped.P2.length },
    findings: filtered,
  };
};

export const drift = async (cat: Catalog, args: { file: string }) => {
  const obs = await loadObservations(args.file);

  return computeDrift(cat, obs);
};
