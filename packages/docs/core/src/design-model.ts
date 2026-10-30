import {
  isEventCatalogResource,
  resourceKey,
  type CatalogRelationship,
  type CatalogResource,
} from 'autocatalog-core';
import { z } from 'zod';
import { edgeEvidence, type EdgeEvidence, type EventRuntime } from './diagram';
import {
  designChanges,
  layoutSchema,
  noteSchema,
  type Design,
  type DesignInput,
  type DesignRelation,
} from './designs';

/**
 * A design as EventCatalog Studio's canvas holds one (`@eventcatalog/visualiser/model`'s
 * `Model`, MIT), cut down to what a design file keeps. A resource the catalog
 * has carries its `ref`, which the canvas keeps on the node, so a save writes
 * the reference back rather than a copy. Parsing drops what the canvas adds
 * that a design does not keep: comment threads, authors, versions.
 */
export const studioModelSchema = z.object({
  title: z.string(),
  resources: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      name: z.string(),
      summary: z.string().optional(),
      parent: z.string().optional(),
      technology: z.string().optional(),
      ref: z.string().optional(),
    }),
  ),
  relations: z.array(
    z.object({ from: z.string(), to: z.string(), kind: z.string(), label: z.string().optional() }),
  ),
  // A note being written can be empty; it is left out, not refused.
  notes: z.array(noteSchema.extend({ text: z.string() }).strip()).default([]),
  hotspots: z
    .array(
      z.object({
        title: z.string(),
        severity: z.enum(['critical', 'warning', 'info']).optional(),
        description: z.string().optional(),
        resource: z.string().optional(),
      }),
    )
    .default([]),
  layout: layoutSchema.optional(),
});

export type StudioModel = z.output<typeof studioModelSchema>;

/** The design as Studio's model: resolved names and summaries, with each authored `ref` kept. */
export function designModel(authored: DesignInput, design: Design): StudioModel {
  return {
    title: design.title,
    // resolveDesign keeps the authored order, so each resolved resource has its authored entry.
    resources: design.resources.map((resource, index) => ({
      id: resource.id,
      type: resource.type,
      name: resource.name,
      ...(resource.summary && { summary: resource.summary }),
      ...(resource.parent && { parent: resource.parent }),
      ...(resource.technology && { technology: resource.technology }),
      ...(authored.resources[index]?.ref && { ref: authored.resources[index]!.ref }),
    })),
    relations: design.relations.map(({ from, to, kind, label }) => ({
      from,
      to,
      kind,
      ...(label && { label }),
    })),
    notes: authored.notes,
    hotspots: authored.hotspots,
    ...(authored.layout && { layout: authored.layout }),
  };
}

// Studio draws these as boxes around what is in them, with nowhere to show or edit a summary.
const WITHOUT_SUMMARY = new Set(['domain', 'system']);

/** A name with spaces as an id: `Refund issued` is `refund-issued`. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The id the file gives each resource the canvas made. The canvas gives one an
 * id like `service-1a2b3c4d`; the file names it after itself instead:
 * `FraudCheck`, or `refund-issued` for a name with spaces. Canvas id to file id;
 * a resource the file already had keeps its id and is not listed.
 */
export function fileIds(model: StudioModel, resolved: Design): Map<string, string> {
  const known = new Set(resolved.resources.map(({ id }) => id));
  const taken = new Set(model.resources.map(({ id }) => id));
  const ids = new Map<string, string>();

  for (const resource of model.resources) {
    if (known.has(resource.id) || resource.ref) continue;

    const name = resource.name.trim();
    const base = /\s/.test(name) ? slug(name) : name;

    if (!base || base === resource.id) continue;

    let id = base;

    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;

    taken.add(id);
    ids.set(resource.id, id);
  }

  return ids;
}

/**
 * What a canvas holds, written back as the design's frontmatter. A resource
 * the catalog has stays a `ref`, with only what the canvas changed beside it;
 * the title, summary and status are the file's, which the canvas does not edit.
 * `order` is the keys each resource had in the file, so an unchanged line
 * stays unchanged in review. The result is checked by `designSchema` before
 * anything is written.
 */
export function designFromModel(
  model: StudioModel,
  previous: DesignInput,
  resolved: Design,
  order: string[][] = previous.resources.map((resource) => Object.keys(resource)),
) {
  const before = new Map(
    resolved.resources.map((resource, index) => [
      resource.id,
      { resolved: resource, authored: previous.resources[index], index },
    ]),
  );

  const ids = fileIds(model, resolved);

  const named = (id: string) => ids.get(id) ?? id;

  const renamed = <T>(record: Record<string, T> | undefined) =>
    record && Object.fromEntries(Object.entries(record).map(([id, value]) => [named(id), value]));

  // The canvas lists resources container first; the file keeps its own order, new ones last.
  const place = (id: string) => before.get(id)?.index ?? before.size;
  const ordered = [...model.resources].sort((a, b) => place(a.id) - place(b.id));

  const resources = ordered.map((resource) => {
    const { resolved: was, authored, index } = before.get(resource.id) ?? {};

    // A name or summary is written only when the file had one or the canvas changed it.
    // A domain or system box has no summary on the canvas: what the file said stands.
    const shown = {
      name: resource.name,
      summary: resource.summary ?? (WITHOUT_SUMMARY.has(resource.type) ? was?.summary : undefined),
    };

    // A new resource's name goes without saying when its id is the name.
    const said = (key: 'name' | 'summary') =>
      was ? was[key] : key === 'name' && !resource.ref ? named(resource.id) : undefined;

    const changed = (key: 'name' | 'summary') =>
      shown[key] !== undefined && (authored?.[key] !== undefined || shown[key] !== said(key));

    const fields = {
      ...(changed('name') && { name: shown.name }),
      ...(changed('summary') && { summary: shown.summary }),
      ...(resource.parent && { parent: named(resource.parent) }),
      ...(resource.technology && { technology: resource.technology }),
    };

    const written: Record<string, string> = resource.ref
      ? {
          ...((authored?.id !== undefined || was?.id !== resource.id) && { id: resource.id }),
          ref: resource.ref,
          ...(authored?.type && { type: resource.type }),
          ...fields,
        }
      : { id: named(resource.id), type: resource.type, ...fields };

    const keys = index === undefined ? [] : (order[index] ?? []);
    const rank = (key: string) => (keys.includes(key) ? keys.indexOf(key) : keys.length);

    return Object.fromEntries(Object.entries(written).sort(([a], [b]) => rank(a) - rank(b)));
  });

  return {
    title: previous.title,
    ...(previous.summary && { summary: previous.summary }),
    status: previous.status,
    resources,
    relations: model.relations.map(({ from, to, kind, label }) => ({
      from: named(from),
      to: named(to),
      kind,
      ...(label && { label }),
    })),
    notes: model.notes.flatMap((note) =>
      note.text.trim()
        ? [{ ...note, ...(note.resource && { resource: named(note.resource) }) }]
        : [],
    ),
    hotspots: model.hotspots.map(({ title, severity, description, resource }) => ({
      title,
      ...(severity && { severity }),
      ...(description && { description }),
      ...(resource && { resource: named(resource) }),
    })),
    ...(model.layout && {
      layout: {
        ...(model.layout.overview && { overview: renamed(model.layout.overview) }),
        ...(model.layout.services && { services: renamed(model.layout.services) }),
        ...(model.layout.messages && { messages: renamed(model.layout.messages) }),
      },
    }),
  };
}

/** One catalog resource a design changes, and who to ask about it. */
export interface DesignImpact {
  /** The resource, as the design names it. */
  name: string;
  kind: string;
  owner?: string | undefined;
  /** What the design does to it, in a line each: "RefundService receives it". */
  changes: string[];
  /** Who depends on it today, from the catalog: its producers and consumers. */
  dependents: string[];
}

export interface DesignReview {
  /** "2 new services and 3 new relations", as the designs index says it. */
  changes: string;
  /** Resources the catalog does not have yet. */
  added: Array<{ id: string; name: string; type: string }>;
  /** Catalog resources a new relation touches, with their owners: who reviews the change. */
  impact: DesignImpact[];
  /** What a runtime snapshot saw of it, when one covers anything it draws. */
  runtime?: DesignEvidence | undefined;
}

const VERBS: Partial<Record<DesignRelation['kind'], string>> = {
  'routes-through': 'routes through',
  connects: 'connects to',
};

/**
 * What a design asks of the catalog: what it adds, and each catalog resource a
 * new relation touches, with its owner and who depends on it today. The
 * owners are who a pull request with the design needs to hear from.
 */
export function designReview(
  design: Design,
  catalog: { resources: CatalogResource[]; relationships: CatalogRelationship[] },
  runtime: Map<string, EventRuntime> = new Map(),
): DesignReview {
  const byKey = new Map(catalog.resources.map((resource) => [resourceKey(resource.ref), resource]));
  const parts = new Map(design.resources.map((resource) => [resource.id, resource]));

  const impact = new Map<string, DesignImpact>();

  for (const relation of design.relations.filter(({ state }) => state === 'new')) {
    const verb = relation.label ?? VERBS[relation.kind] ?? relation.kind;

    for (const [end, other, said] of [
      [relation.to, relation.from, (name: string) => `${name} ${verb} it`],
      [relation.from, relation.to, (name: string) => `it ${verb} ${name}`],
    ] as const) {
      const part = parts.get(end);

      if (!part?.ref) continue;

      const key = resourceKey(part.ref);
      const resource = byKey.get(key);

      const entry = impact.get(key) ?? {
        name: part.name,
        kind: part.ref.kind,
        owner: resource?.owner?.team,
        changes: [],
        dependents: dependentsOf(key, catalog, byKey),
      };

      entry.changes.push(said(parts.get(other)?.name ?? other));
      impact.set(key, entry);
    }
  }

  return {
    changes: designChanges(design),
    added: design.resources
      .filter(({ state }) => state === 'new')
      .map(({ id, name, type }) => ({ id, name, type })),
    impact: [...impact.values()],
    runtime: designEvidence(design, runtime),
  };
}

/** Who produces or consumes an event, or what a service produces and consumes, by title. */
function dependentsOf(
  key: string,
  catalog: { relationships: CatalogRelationship[] },
  byKey: Map<string, CatalogResource>,
): string[] {
  const title = (ref: CatalogRelationship['from']) => byKey.get(resourceKey(ref))?.title ?? ref.id;
  const resource = byKey.get(key);

  const names = catalog.relationships.flatMap((relationship) => {
    if (!['produces', 'consumes', 'sends', 'handles'].includes(relationship.type)) return [];

    const from = resourceKey(relationship.from);
    const to = resourceKey(relationship.to);

    if (resource && isEventCatalogResource(resource)) {
      if (to === key) return [title(relationship.from)];

      if (from === key) return [title(relationship.to)];

      return [];
    }

    return from === key ? [title(relationship.to)] : to === key ? [title(relationship.from)] : [];
  });

  return [...new Set(names)].sort();
}

/** What a runtime snapshot says of a design: of each relation it drew, and of what it left out. */
export interface DesignEvidence {
  /** A drawn relation between a catalog service and a catalog event, and what the snapshot saw of it. */
  relations: Array<{ from: string; to: string; kind: string; evidence: EdgeEvidence }>;
  /** A producer or consumer the snapshot saw on a drawn event that the design does not draw. */
  undrawn: Array<{ event: string; service: string; role: 'produces' | 'consumes'; count: number }>;
}

/**
 * The design against what ran: each relation it draws between a catalog
 * service and a catalog event, as the maps draw one (ran, never seen, ran
 * though nobody declared it), and each producer or consumer the snapshot saw
 * on a drawn event that the design leaves off. Undefined when no snapshot
 * covers anything the design draws.
 */
export function designEvidence(
  design: Design,
  runtime: Map<string, EventRuntime>,
): DesignEvidence | undefined {
  const parts = new Map(design.resources.map((resource) => [resource.id, resource]));

  const runtimeOf = (id: string) => {
    const ref = parts.get(id)?.ref;

    return ref?.kind === 'event' ? runtime.get(`${ref.namespace}/${ref.id}`) : undefined;
  };

  const relations = design.relations.flatMap((relation) => {
    const service = parts.get(relation.from)?.ref;
    const event = parts.get(relation.to)?.ref;
    const seen = runtimeOf(relation.to);
    const role = relation.kind === 'sends' ? 'produces' : 'consumes';

    if (!seen || !event || service?.kind !== 'service') return [];

    if (relation.kind !== 'sends' && relation.kind !== 'receives') return [];

    const evidence = edgeEvidence(role, event.id, service.id, seen);

    return evidence
      ? [{ from: relation.from, to: relation.to, kind: relation.kind, evidence }]
      : [];
  });

  const drawn = new Set(
    design.relations.flatMap(({ from, to, kind }) => {
      const service = parts.get(from)?.ref;

      return service ? [`${kind === 'sends' ? 'produces' : 'consumes'} ${service.id} ${to}`] : [];
    }),
  );

  const undrawn = design.resources.flatMap((part) => {
    const seen = runtimeOf(part.id)?.observed;

    if (!seen) return [];

    return (['produces', 'consumes'] as const).flatMap((role) =>
      (role === 'produces' ? seen.producers : seen.consumers)
        .filter((service) => !drawn.has(`${role} ${service} ${part.id}`))
        .map((service) => ({ event: part.name, service, role, count: seen.count })),
    );
  });

  if (relations.length === 0 && undrawn.length === 0) return undefined;

  return { relations, undrawn };
}
