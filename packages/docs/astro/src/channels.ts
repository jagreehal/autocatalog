import type { ResourceGraph } from 'autocatalog-core';
import { z } from 'zod';
import { catalogHref } from './view';

/** One messaging destination the catalog can name. */
export interface ChannelRow {
  id: string;
  href: string;
  system?: string | undefined;
  /** Services or events bound to it. */
  bindings: string[];
  source: 'observed' | 'design';
  designHref?: string | undefined;
}

interface DesignChannelSource {
  repository: string;
  id: string;
  resources: Array<{ id: string; type: string; name?: string | undefined }>;
}

/** A queue's messaging system, when runtime evidence named one. */
const queueAttributes = z.object({ system: z.string().optional().catch(undefined) });

// Kafka and SQS can each have a destination called `orders`.
function queueKey(ref: { namespace?: string | undefined; id: string }): string {
  return ref.namespace ? `${ref.namespace}:${ref.id}` : ref.id;
}

/**
 * Queues observed on the graph plus channels drawn in designs, for the
 * channels browse page.
 */
export function buildChannels(
  graph: ResourceGraph,
  designs: DesignChannelSource[],
  base: string,
): ChannelRow[] {
  const byId = new Map<string, ChannelRow>();

  for (const resource of graph.resources) {
    if (resource.ref.kind !== 'queue') continue;

    const key = queueKey(resource.ref);

    const bindings = graph.relationships
      .filter(
        (edge) =>
          (edge.to.kind === 'queue' && queueKey(edge.to) === key) ||
          (edge.from.kind === 'queue' && queueKey(edge.from) === key),
      )
      .map((edge) => {
        const other = edge.from.kind === 'queue' ? edge.to : edge.from;

        return other.id;
      });

    byId.set(key, {
      id: key,
      href: catalogHref(resource.ref),
      system: queueAttributes.parse(resource.attributes ?? {}).system,
      bindings: [...new Set(bindings)].sort(),
      source: 'observed',
    });
  }

  for (const design of designs) {
    for (const resource of design.resources) {
      if (resource.type !== 'channel') continue;

      // A design names a channel without its system: it joins the one
      // observed queue of that name, and stays its own row when several share it.
      const named = [...byId.values()].filter(
        (row) => row.source === 'observed' && row.id.split(':').at(-1) === resource.id,
      );

      const existing = byId.get(resource.id) ?? (named.length === 1 ? named[0] : undefined);

      if (existing) {
        existing.designHref = `${base}designs/${design.repository}/${design.id}/`;
        continue;
      }

      byId.set(resource.id, {
        id: resource.id,
        href: `${base}channels/${encodeURIComponent(resource.id)}/`,
        bindings: [],
        source: 'design',
        designHref: `${base}designs/${design.repository}/${design.id}/`,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function channelById(channels: ChannelRow[], id: string): ChannelRow | undefined {
  return channels.find((channel) => channel.id === id);
}
