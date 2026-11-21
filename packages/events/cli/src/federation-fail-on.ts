/** Findings `ac federation status --fail-on` can turn into a failure. */
export const FAIL_ON = ['gateway', 'network', 'unresolved', 'unpinned', 'behind'] as const;

export type FailOn = (typeof FAIL_ON)[number];
