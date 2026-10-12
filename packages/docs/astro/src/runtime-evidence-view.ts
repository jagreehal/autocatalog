import type { EventRuntimeEvidence } from 'autocatalog-core';
import type { RuntimeEvidenceView } from './ui/components/RuntimeEvidence';

/** Shape `eventRuntimeEvidence`'s result, for the event named by `ref`, into the view. */
export function runtimeEvidenceView(
  evidence: EventRuntimeEvidence,
  ref: string,
): RuntimeEvidenceView {
  if (evidence.status === 'no-evidence') {
    return { status: 'no-evidence', ref, caveat: evidence.caveat };
  }

  return {
    status: 'snapshot',
    ref,
    caveat: evidence.caveat,
    count: evidence.count,
    observedRange: evidence.observedRange,
    snapshot: evidence.snapshot,
    declaredConsumers: evidence.declaredConsumers,
    observedConsumers: evidence.observedConsumers,
    additionalConsumers: evidence.additionalConsumers,
    neverObserved: evidence.neverObserved,
    consumerEvidence: evidence.consumerEvidence,
    sources: evidence.sources,
    sampleTraceIds: evidence.sampleTraceIds,
  };
}
