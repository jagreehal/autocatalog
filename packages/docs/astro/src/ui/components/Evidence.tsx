/** @jsxImportSource react */
import type { ProvenanceValue } from 'autocatalog-core';

/** How the catalog learned something, as autocatalog-core records it. */
export type ProvenanceMethod = ProvenanceValue;

export interface EvidenceView {
  method: ProvenanceMethod;
  /** `file:line`, or the repository when no file is recorded. */
  location: string | null;
  /** The export or type the definition was read from, when that adds anything. */
  symbol: string | null;
  /** 0 to 1; absent when the reader that found it gives no score. */
  confidence: number | null;
  needsReview: boolean;
  /** What it was learned from, when there is no file to point at. */
  basis?: string | undefined;
}

/**
 * The evidence rule: where a definition was read, and how sure the catalog is.
 * The rule's colour is the method; an inference is dashed, so certainty reads
 * without colour too (DESIGN.md).
 */
export const rule: Record<ProvenanceMethod, string> = {
  observed: 'border-extracted',
  extracted: 'border-extracted',
  declared: 'border-declared',
  overridden: 'border-declared',
  inferred: 'border-dashed border-inferred',
};

export const tone: Record<ProvenanceMethod, string> = {
  observed: 'text-extracted',
  extracted: 'text-extracted',
  declared: 'text-declared',
  overridden: 'text-declared',
  inferred: 'text-inferred',
};

/** Whether a stored provenance string is one this design draws. */
export const isMethod = (value: string): value is ProvenanceMethod => Object.hasOwn(rule, value);

const said: Record<ProvenanceMethod, string> = {
  observed: 'Observed at runtime',
  extracted: 'Extracted from code',
  declared: 'Declared by its owners',
  overridden: 'Overridden by its owners',
  inferred: 'Inferred',
};

export function Evidence({
  method,
  location,
  symbol,
  confidence,
  needsReview,
  basis,
}: EvidenceView) {
  return (
    <div
      className={`not-content flex flex-col gap-1 border-0 border-l-2 py-0.5 pl-3 ${rule[method]}`}
      data-provenance={method}
    >
      <p className="m-0 text-sm text-muted-foreground">
        <span className={`font-medium ${tone[method]}`}>{said[method]}</span>
        {basis && ` ${basis}`}
        {confidence !== null && `, ${Math.round(confidence * 100)}% confident`}.
        {needsReview && <span className="text-foreground"> A person should confirm it.</span>}
      </p>
      {location && (
        <p className="m-0 text-xs text-muted-foreground">
          Read from <code className="font-mono break-all">{location}</code>
          {symbol && (
            <>
              {' '}
              as <code className="font-mono">{symbol}</code>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export default Evidence;
