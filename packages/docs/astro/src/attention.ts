import type { DocsCatalog } from './catalog';

/** What the homepage puts above Explore: dark spots and review work. */
export interface AttentionSnapshot {
  needsReview: number;
  needsReviewHref: string;
  failures: Array<{ repository: string; message: string }>;
  /** Events with no producer declared. */
  orphanProducers: number;
  /** Events with no consumer declared. */
  orphanConsumers: number;
  /** Resources with no owner. */
  unowned: number;
  ownersHref: string;
  catalogHref: string;
}

type Frontmatter = DocsCatalog['events'][number]['event']['frontmatter'];

/** The parts of the catalog the attention strip counts. */
export interface AttentionSource {
  events: Array<{ event: { frontmatter: Pick<Frontmatter, 'producers' | 'consumers'> } }>;
  graph: { resources: Array<Pick<DocsCatalog['graph']['resources'][number], 'owner'>> };
  summary: Pick<DocsCatalog['summary'], 'needsReview'>;
  failures: Array<Pick<DocsCatalog['failures'][number], 'repository' | 'message'>>;
}

export function attentionSnapshot(catalog: AttentionSource, base: string): AttentionSnapshot {
  const events = catalog.events.map(({ event }) => event.frontmatter);

  const orphanProducers = events.filter((event) => event.producers.length === 0).length;
  const orphanConsumers = events.filter((event) => event.consumers.length === 0).length;

  const unowned = catalog.graph.resources.filter((resource) => !resource.owner?.team).length;

  return {
    needsReview: catalog.summary.needsReview,
    needsReviewHref: `${base}catalog/?review=1`,
    failures: catalog.failures.map((failure) => ({
      repository: failure.repository,
      message: failure.message,
    })),
    orphanProducers,
    orphanConsumers,
    unowned,
    ownersHref: `${base}owners/`,
    catalogHref: `${base}catalog/`,
  };
}

/** True when the homepage should show the attention strip. */
export function hasAttention(attention: AttentionSnapshot): boolean {
  return (
    attention.needsReview > 0 ||
    attention.failures.length > 0 ||
    attention.orphanProducers > 0 ||
    attention.orphanConsumers > 0 ||
    attention.unowned > 0
  );
}
