/**
 * The tile classes for each resource kind's hue (theme.css, --ac-kind-*).
 * Whole class names, so Tailwind finds them; a kind with no hue of its own
 * keeps the accent.
 */
const TONES = {
  event: 'bg-kind-event/12 text-kind-event',
  command: 'bg-kind-command/12 text-kind-command',
  query: 'bg-kind-query/12 text-kind-query',
  service: 'bg-kind-service/12 text-kind-service',
  data: 'bg-kind-data/12 text-kind-data',
  domain: 'bg-kind-domain/14 text-kind-domain',
  flow: 'bg-kind-flow/12 text-kind-flow',
  endpoint: 'bg-kind-endpoint/12 text-kind-endpoint',
  entity: 'bg-kind-entity/12 text-kind-entity',
  document: 'bg-kind-document/12 text-kind-document',
} as const;

const ALIASES = {
  table: 'data',
  collection: 'data',
  datastore: 'data',
  api: 'endpoint',
  doc: 'document',
  spec: 'document',
  specification: 'document',
} as const satisfies Record<string, keyof typeof TONES>;

export type KindTone = keyof typeof TONES;

const TONE_OF = new Map<string, string>([
  ...Object.entries(TONES),
  ...Object.entries(ALIASES).map(([alias, kind]) => [alias, TONES[kind]] as const),
]);

/** The tone for a kind, or undefined when it has none and keeps the accent. */
export function kindTone(kind: string | undefined): string | undefined {
  return kind === undefined ? undefined : TONE_OF.get(kind);
}
