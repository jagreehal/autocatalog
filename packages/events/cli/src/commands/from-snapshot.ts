import path from 'node:path';
import kleur from 'kleur';
import {
  applySnapshot,
  pascalCase,
  publishCatalog,
  readSnapshot,
  type AdapterEvent,
  type SnapshotObservation,
} from 'autocatalog-core';

export interface RunFromSnapshotOptions {
  file: string; // a runtime architecture snapshot (autotel-architecture/*)
  out: string;
  /** The domain for events the snapshot names without one. Defaults to the snapshot's service. */
  domain?: string;
  quiet?: boolean;
}

const JSON_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'null']);

/** The part of JSON Schema an inferred contract uses. */
type InferredSchema = {
  type?: string | string[];
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
};

// No prototype: field names are runtime data, and `constructor` or `__proto__` is a field like any other.
const properties = (): Record<string, InferredSchema> => Object.create(null);

/** The node a path segment names under `parent`, created as it is first walked. */
function child(parent: InferredSchema, segment: string): InferredSchema {
  const array = segment.endsWith('[]');
  const key = array ? segment.slice(0, -2) : segment;

  parent.type ??= 'object';
  parent.properties ??= properties();

  const node = (parent.properties[key] ??= {});

  if (!array) return node;

  node.type ??= 'array';

  return (node.items ??= {});
}

/**
 * A JSON Schema for what the runtime was seen to send: every field path it
 * carried, typed as it was observed. Nothing is required and no enum is
 * written: one run shows what a field held, not what it may hold, and sample
 * values can be sensitive, so none reach the contract.
 */
export function inferSchema(observation: SnapshotObservation): InferredSchema {
  const root: InferredSchema = { type: 'object', properties: properties() };
  const stats = observation.fieldStats ?? {};

  const paths = [...new Set([...(observation.fieldPaths ?? []), ...Object.keys(stats)])].sort();

  for (const fieldPath of paths) {
    const node = fieldPath.split('.').reduce(child, root);
    const types = (stats[fieldPath]?.types ?? []).filter((type) => JSON_TYPES.has(type));

    // A field with children is an object whatever else it was seen as.
    const declared = node.properties ? ['object', ...types] : types;
    const unique = [...new Set(declared)].sort();

    if (unique.length === 1) node.type = unique[0]!;
    else if (unique.length > 1) node.type = unique;
  }

  return root;
}

/**
 * Starter contracts for a repository that has none, from what its tests sent.
 * Each one is marked inferred and for review: a snapshot shows what ran, so
 * this is a place to start, not a contract anyone agreed.
 */
export async function runFromSnapshot(opts: RunFromSnapshotOptions): Promise<number> {
  let snapshot;

  try {
    snapshot = await readSnapshot(opts.file);
  } catch (error) {
    console.error(kleur.red(`✗ ${error instanceof Error ? error.message : String(error)}`));

    return 1;
  }

  const fallbackDomain = opts.domain ?? (snapshot.service || 'events');

  const events: AdapterEvent[] = Object.entries(snapshot.events).map(([name, observation]) => {
    const slash = name.indexOf('/');
    const domain = slash === -1 ? fallbackDomain : name.slice(0, slash);
    const id = name.slice(slash + 1);

    const sources = [
      { producer: observation.producer, channel: observation.channel },
      ...(observation.sources ?? []),
    ];

    const producers = [...new Set(sources.flatMap((s) => (s.producer ? [s.producer] : [])))];
    const channels = [...new Set(sources.flatMap((s) => (s.channel ? [s.channel] : [])))];

    return {
      id,
      version: '0.1.0',
      name: pascalCase(id),
      summary: `Inferred from ${observation.observedCount} observation(s) in a runtime snapshot${snapshot.service ? ` of ${snapshot.service}` : ''}. Describe what it means.`,
      domain,
      folderName: pascalCase(id),
      schema: inferSchema(observation),
      examples: [],
      meta: {
        status: 'draft',
        producers,
        consumers: observation.consumers ?? [],
        ...(channels.length > 0 && {
          transport: channels.map((address) => ({ address, protocols: [] })),
        }),
      },
      provenance: { default: 'inferred', fields: {} },
      needsReview: true,
    };
  });

  if (events.length === 0) {
    console.error(kleur.red('✗ nothing to import: the snapshot observed no events'));

    return 1;
  }

  // The evidence the contracts came from rides along, as ac scan --snapshot adds it.
  applySnapshot(events, snapshot);

  try {
    await publishCatalog({ outRoot: path.resolve(opts.out), events, history: [] });
  } catch (error) {
    console.error(
      kleur.red(
        `✗ could not write the catalog: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );

    return 1;
  }

  if (!opts.quiet) {
    for (const event of events) console.log(`${kleur.green('✓')} ${event.domain}/${event.id}`);

    console.log(kleur.bold(`\n${events.length} draft event(s) written to ${opts.out}`));
    console.log(
      kleur.dim(
        '  Each is inferred from one run: nothing is required, and summaries and owners are yours to write.',
      ),
    );
    console.log(
      kleur.dim(
        '  Move each into the code that sends it (a Zod or JSON Schema contract) so ac scan finds it from then on.',
      ),
    );
  }

  return 0;
}
