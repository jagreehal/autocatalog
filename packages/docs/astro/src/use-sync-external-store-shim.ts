/**
 * ESM entry for `use-sync-external-store/shim`. React Aria imports
 * `useSyncExternalStore` from that CommonJS file; the site points it at
 * React 19's own hook so islands hydrate under `ac site --dev`.
 */
export { useSyncExternalStore } from 'react';
