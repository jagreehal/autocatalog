import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import { stringify as stringifyYaml } from 'yaml';
import {
  cloudEventEnvelopeSchema,
  correlationPath,
  exampleCaseSummary,
  isJsonObject,
  loadCatalog,
  rewriteObjectRefs,
  rewriteRefs,
  type JsonObject,
  type JsonValue,
  type LoadedEvent,
} from 'autocatalog-core';

export interface AsyncApiExample {
  name: string;
  summary?: string;
  payload: JsonValue;
}

export interface AsyncApiMessage {
  name: string;
  title: string;
  summary: string;
  contentType: 'application/json';
  payload: JsonObject;
  correlationId?: { location: string };
  examples?: AsyncApiExample[];
  /** EventCatalog's generator reads these, so its import keeps the type and version. */
  'x-eventcatalog-message-type': 'event';
  'x-eventcatalog-message-version': string;
  /** What AsyncAPI has no field for, which ac from-asyncapi reads back. */
  'x-autocatalog': JsonObject;
}

export interface AsyncApiDocument {
  asyncapi: '3.0.0';
  info: { title: string; version: string };
  defaultContentType: 'application/json';
  channels: Record<
    string,
    {
      address: string;
      messages: Record<string, { $ref: string }>;
      bindings?: Record<string, JsonObject>;
    }
  >;
  operations: Record<
    string,
    { action: 'send' | 'receive'; channel: { $ref: string }; messages: { $ref: string }[] }
  >;
  components: { messages: Record<string, AsyncApiMessage>; schemas?: Record<string, JsonValue> };
}

export interface CatalogToAsyncApiOptions {
  title: string;
  version: string;
  /** One service's view: what it sends and receives. Without it, every event is sent. */
  service?: string | undefined;
}

/**
 * Keys for components and channels, which AsyncAPI limits to letters, digits,
 * `_` and `-`. Two names that read the same once punctuation is replaced, such
 * as `order.placed` and `order_placed`, would share a key and merge; the later
 * one takes a short hash of its name instead, so each keeps its own. A name of
 * several parts is told apart by its parts, not by how they read joined up.
 */
function keys() {
  const owners = new Map<string, string>();

  return (...parts: string[]): string => {
    const name = JSON.stringify(parts);
    const readable = parts.map((part) => part.replace(/[^A-Za-z0-9_-]+/g, '_')).join('_');
    const owner = owners.get(readable);

    if (owner === undefined || owner === name) {
      owners.set(readable, name);

      return readable;
    }

    const unique = `${readable}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
    owners.set(unique, name);

    return unique;
  };
}

/** components.schemas, refusing a key two schemas would share rather than merging them. */
class SchemaComponents {
  readonly entries: Record<string, JsonValue> = {};

  put(key: string, schema: JsonValue): void {
    if (Object.hasOwn(this.entries, key))
      throw new Error(`Schema component ${key} is claimed twice; rename one of the definitions`);

    this.entries[key] = schema;
  }
}

/**
 * The payload as it can sit inside the document. A local reference resolves
 * against the whole document there, so `#/$defs/Line` becomes
 * `#/components/schemas/<prefix>_Line`, and a reference to the payload's own
 * root (`#`, `#/properties/...`) points at the payload stored as
 * `components.schemas.<prefix>`, which the message then refers to.
 */
function liftDefinitions(
  schema: JsonObject,
  prefix: string,
  schemas: SchemaComponents,
): JsonObject {
  let rootReferenced = false;

  const lift = (ref: string) => {
    const definition = /^#\/(?:\$defs|definitions)\/([^/]+)(.*)$/.exec(ref);

    if (definition) return `#/components/schemas/${prefix}_${definition[1]}${definition[2]}`;

    if (ref !== '#' && !ref.startsWith('#/')) return ref;

    rootReferenced = true;

    return `#/components/schemas/${prefix}${ref.slice(1)}`;
  };

  const {
    $schema: _schema,
    $id: _id,
    $defs,
    definitions,
    'x-autocatalog': _meta,
    ...payload
  } = schema;

  // A definition may be a boolean schema, which AsyncAPI does not allow as a
  // component; `{ not: {} }` matches nothing, as `false` does, and `{}` all.
  for (const defs of [definitions, $defs])
    if (isJsonObject(defs))
      for (const [name, definition] of Object.entries(defs))
        schemas.put(
          `${prefix}_${name}`,
          definition === false
            ? { not: {} }
            : definition === true
              ? {}
              : rewriteRefs(definition, lift),
        );

  const lifted = rewriteObjectRefs(payload, lift);

  if (!rootReferenced) return lifted;

  schemas.put(prefix, lifted);

  return { $ref: `#/components/schemas/${prefix}` };
}

function message(event: LoadedEvent, messageKey: string, schemas: SchemaComponents) {
  const fm = event.frontmatter;
  const correlation = correlationPath(event);

  const examples = event.examples.flatMap((example): AsyncApiExample[] => {
    // An invalid example is not a message; a mock server would serve it as one.
    if (example.case === 'invalid') return [];

    const summary = example.summary ?? (example.case && exampleCaseSummary(example.case));

    return [
      {
        // The case folder belongs to the name: it keeps `sample` and
        // `duplicate/sample` apart, and is where EventCatalog's generator writes it.
        name: [example.case, example.name].filter(Boolean).join('/'),
        ...(summary && { summary }),
        payload: example.data,
      },
    ];
  });

  const meta: JsonObject = { id: fm.id, version: fm.version, domain: fm.domain };

  if (fm.owner) meta.owner = { ...fm.owner };

  if (fm.producers.length) meta.producers = fm.producers;

  if (fm.consumers.length) meta.consumers = fm.consumers;

  if (fm.delivery) meta.delivery = { ...fm.delivery };

  if (fm.envelope) meta.envelope = { ...fm.envelope };

  // In structured mode the message is the CloudEvent: its context, and the
  // event as `data`. The examples are whole envelopes, as consumers receive them.
  const structured = fm.envelope?.mode === 'structured';
  const data = liftDefinitions(event.schema, messageKey, schemas);

  return {
    name: fm.id,
    title: fm.name,
    summary: fm.summary,
    contentType: 'application/json',
    payload: structured ? cloudEventEnvelopeSchema(data) : data,
    ...(correlation && {
      correlationId: {
        location: `$message.payload#/${[...(structured ? ['data'] : []), ...correlation.split('.')].join('/')}`,
      },
    }),
    ...(examples.length && { examples }),
    'x-eventcatalog-message-type': 'event',
    'x-eventcatalog-message-version': fm.version,
    'x-autocatalog': meta,
  } satisfies AsyncApiMessage;
}

/**
 * The catalog as an AsyncAPI 3.0 document: one message per event, on the
 * channel its transport names (or its id), with its examples for mock servers.
 */
export function catalogToAsyncApi(
  events: LoadedEvent[],
  options: CatalogToAsyncApiOptions,
): AsyncApiDocument {
  const doc: AsyncApiDocument = {
    asyncapi: '3.0.0',
    info: { title: options.title, version: options.version },
    defaultContentType: 'application/json',
    channels: {},
    operations: {},
    components: { messages: {} },
  };

  const schemas = new SchemaComponents();
  const messageKeyOf = keys();
  const channelKeyOf = keys();
  const operationKeyOf = keys();

  // Keys go to names in a fixed order, by code unit rather than locale, so the
  // same catalog writes the same document on every machine.
  const name = (event: LoadedEvent) => `${event.frontmatter.domain}/${event.frontmatter.id}`;

  const ordered = [...events].sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));

  for (const event of ordered) {
    const fm = event.frontmatter;
    const sends = !options.service || fm.producers.includes(options.service);
    const receives = Boolean(options.service && fm.consumers.includes(options.service));

    if (!sends && !receives) continue;

    // Told apart by its parts, so sales/eu_created and sales_eu/created stay two names.
    const messageKey = messageKeyOf(fm.domain, fm.id);
    doc.components.messages[messageKey] = message(event, messageKey, schemas);

    for (const transport of fm.transport?.length ? fm.transport : [{ protocols: [] }]) {
      const address = transport.address ?? fm.id;
      const channelKey = channelKeyOf(address);

      const channel = (doc.channels[channelKey] ??= { address, messages: {} });
      channel.messages[messageKey] = { $ref: `#/components/messages/${messageKey}` };

      // A binding names the protocol; ac from-asyncapi reads protocols back from them.
      for (const protocol of transport.protocols) (channel.bindings ??= {})[protocol] = {};

      // A service can send an event and receive it too; its view keeps both.
      const actions: Array<'send' | 'receive'> = [];

      if (sends) actions.push('send');

      if (receives) actions.push('receive');

      for (const action of actions)
        doc.operations[operationKeyOf(action, channelKey, messageKey)] = {
          action,
          channel: { $ref: `#/channels/${channelKey}` },
          messages: [{ $ref: `#/channels/${channelKey}/messages/${messageKey}` }],
        };
    }
  }

  if (Object.keys(schemas.entries).length) doc.components.schemas = schemas.entries;

  return doc;
}

export interface RunToAsyncApiOptions {
  root: string;
  out: string;
  service?: string | undefined;
  title?: string | undefined;
  version?: string | undefined;
  quiet?: boolean;
}

export async function runToAsyncApi(opts: RunToAsyncApiOptions): Promise<number> {
  let events: LoadedEvent[];

  try {
    events = await loadCatalog(opts.root, { skipVersioned: true });
  } catch (error) {
    console.error(kleur.red(`✗ ${error instanceof Error ? error.message : String(error)}`));

    return 1;
  }

  let doc: AsyncApiDocument;

  try {
    doc = catalogToAsyncApi(events, {
      title: opts.title ?? (opts.service ? `${opts.service} events` : 'Event catalog'),
      version: opts.version ?? '1.0.0',
      service: opts.service,
    });
  } catch (error) {
    console.error(kleur.red(`✗ ${error instanceof Error ? error.message : String(error)}`));

    return 1;
  }

  const messages = Object.keys(doc.components.messages).length;

  if (messages === 0) {
    console.error(
      kleur.red(
        opts.service
          ? `✗ ${opts.service} neither sends nor receives any event in ${opts.root}`
          : `✗ no events in ${opts.root}`,
      ),
    );

    // The likeliest reason is a misspelt name, so say which ones there are.
    const services = [
      ...new Set(events.flatMap((e) => [...e.frontmatter.producers, ...e.frontmatter.consumers])),
    ].sort();

    if (opts.service && services.length)
      console.error(`  Services in this catalog: ${services.join(', ')}`);

    return 1;
  }

  const text = opts.out.endsWith('.json')
    ? `${JSON.stringify(doc, null, 2)}\n`
    : stringifyYaml(doc, { aliasDuplicateObjects: false });

  await fs.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  await fs.writeFile(opts.out, text);

  if (!opts.quiet) {
    console.log(kleur.green(`✓ ${messages} event(s) to ${opts.out}`));
    console.log(
      kleur.dim('  Next: point a mock server such as Microcks at it, or share it with consumers.'),
    );
  }

  return 0;
}
