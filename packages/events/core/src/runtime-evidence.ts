import type { EventFrontmatter } from './schema';

/** One read model for snapshot evidence, independent of UI and backend SDKs. */
export function eventRuntimeEvidence(event: EventFrontmatter) {
  const observation = event.observed;
  const declaredConsumers = observation?.declaredConsumers ?? event.consumers;

  if (!observation) {
    return {
      status: 'no-evidence' as const,
      declaredConsumers,
      caveat: 'No runtime evidence is attached. This does not mean the event has no traffic.',
    };
  }

  return {
    status: 'snapshot' as const,
    snapshot: observation.snapshot,
    observedRange: { firstSeen: observation.firstSeen, lastSeen: observation.lastSeen },
    count: observation.count,
    declaredConsumers,
    observedConsumers: observation.consumers,
    additionalConsumers: observation.consumers.filter((name) => !declaredConsumers.includes(name)),
    neverObserved: declaredConsumers.filter((name) => !observation.consumers.includes(name)),
    consumerEvidence: observation.consumerEvidence ?? 'unknown',
    observedProducers: observation.producers,
    sources: observation.sources ?? [],
    consumerOutcomes: observation.consumerOutcomes ?? [],
    sampleTraceIds: [...new Set(observation.sampleTraceIds ?? [])].slice(0, 3),
    fieldPaths: observation.fieldPaths ?? [],
    fieldTypes: observation.fieldTypes ?? {},
    coverage: 'unknown' as const,
    caveat:
      'A consumer absent from the evidence is not proof it is gone. Reported consumer metadata is not proof of delivery. First/last seen describe observations, not continuous coverage; counts may be sampled. Environment, release and backend identity are not established by this snapshot.',
  };
}

export type EventRuntimeEvidence = ReturnType<typeof eventRuntimeEvidence>;
