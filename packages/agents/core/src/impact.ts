import { entitiesOf, type Catalog } from './loader.js';
import type { EventDirection, EventLink } from './events.js';
import type { EntityKind } from './schemas.js';

export type EntityRef = { kind: EntityKind; id: string };

export type ImpactReport = {
  subject: EntityRef;
  dependencies: EntityRef[];
  dependents: EntityRef[];
  /** Event references an Agent or Tool declares, as written. */
  events?: { produces: string[]; consumes: string[] };
};

const depsOf = (cat: Catalog, ref: EntityRef): EntityRef[] => {
  const deps: EntityRef[] = [];
  const entity = cat.entities.get(ref.kind)?.get(ref.id);

  if (!entity) return deps;

  if (entity.kind === 'agent') {
    deps.push({ kind: 'model', id: entity.model });

    for (const t of entity.tools) deps.push({ kind: 'tool', id: t });

    for (const p of entity.policies) deps.push({ kind: 'policy', id: p });

    if (entity.domain) deps.push({ kind: 'domain', id: entity.domain });
  } else if (entity.kind === 'workflow') {
    for (const id of entity.agents) deps.push({ kind: 'agent', id });
  } else if (entity.kind === 'eval') {
    deps.push({ kind: 'agent', id: entity.target });
  }

  return deps;
};

const dependentsOf = (cat: Catalog, ref: EntityRef): EntityRef[] => {
  const out: EntityRef[] = [];

  for (const a of entitiesOf(cat, 'agent')) {
    const refsMe =
      (ref.kind === 'model' && a.model === ref.id) ||
      (ref.kind === 'tool' && a.tools.includes(ref.id)) ||
      (ref.kind === 'policy' && a.policies.includes(ref.id)) ||
      (ref.kind === 'domain' && a.domain === ref.id);

    if (refsMe) out.push({ kind: 'agent', id: a.id });
  }

  for (const w of entitiesOf(cat, 'workflow')) {
    if (ref.kind === 'agent' && w.agents.includes(ref.id)) {
      out.push({ kind: 'workflow', id: w.id });
    }
  }

  for (const e of entitiesOf(cat, 'eval')) {
    if (ref.kind === 'agent' && e.target === ref.id) {
      out.push({ kind: 'eval', id: e.id });
    }
  }

  return out;
};

const eventsOf = (cat: Catalog, ref: EntityRef): ImpactReport['events'] => {
  const entity = cat.entities.get(ref.kind)?.get(ref.id);

  if (entity?.kind !== 'agent' && entity?.kind !== 'tool') return undefined;

  if (!entity.produces?.length && !entity.consumes?.length) return undefined;

  return {
    produces: [...new Set(entity.produces ?? [])].sort(),
    consumes: [...new Set((entity.consumes ?? []).map(({ event }) => event))].sort(),
  };
};

export const computeImpact = (cat: Catalog, ref: EntityRef): ImpactReport => {
  const report: ImpactReport = {
    subject: ref,
    dependencies: depsOf(cat, ref),
    dependents: dependentsOf(cat, ref),
  };

  const events = eventsOf(cat, ref);

  if (events) report.events = events;

  return report;
};

export type EventImpactReport = {
  /** `domain/id`. */
  event: string;
  producers: EntityRef[];
  consumers: EntityRef[];
  /** Agents that never name the event but call a Tool that does. */
  viaTools: Array<{ agent: EntityRef; tool: EntityRef; direction: EventDirection }>;
};

/** Which Agents and Tools a change to one event reaches, from resolved links. */
export const computeEventImpact = (
  cat: Catalog,
  links: EventLink[],
  event: string,
): EventImpactReport => {
  const mine = links.filter((link) => link.event === event);

  const pick = (direction: EventDirection) =>
    mine.flatMap((link) => (link.direction === direction ? [link.from] : []));

  const viaTools: EventImpactReport['viaTools'] = [];

  for (const link of mine.filter((l) => l.from.kind === 'tool')) {
    for (const agent of entitiesOf(cat, 'agent')) {
      if (agent.tools.includes(link.from.id)) {
        viaTools.push({
          agent: { kind: 'agent', id: agent.id },
          tool: link.from,
          direction: link.direction,
        });
      }
    }
  }

  return { event, producers: pick('produces'), consumers: pick('consumes'), viaTools };
};
