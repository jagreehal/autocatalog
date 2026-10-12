import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import kleur from 'kleur';
import {
  compareSemverish,
  derefLocal as deref,
  exampleCaseOf,
  isJsonObject,
  jsonObjectSchema,
  jsonValueSchema,
  pascalCase,
  publishCatalog,
  readVendorMeta,
  rewriteObjectRefs,
  rewriteRefs,
  type AdapterEvent,
  type AdapterEventMeta,
  type JsonObject,
  type JsonValue,
} from 'autocatalog-core';
import { z } from 'zod';

export interface RunFromAsyncApiOptions {
  file: string; // AsyncAPI 2.x or 3.x document (yaml or json)
  out: string;
  quiet?: boolean;
  /** Exit non-zero if anything was skipped. For a migration running in CI. */
  strict?: boolean;
}

/**
 * The parts of an AsyncAPI document this importer reads. Every node below the
 * root may be a local `$ref`, so each is parsed after it is dereferenced, and
 * leniently: a malformed field reads as absent rather than failing the file.
 */
const namedNodes = z.record(z.string(), z.unknown()).catch({});

const asyncApiDocument = z.looseObject({
  asyncapi: z.string(),
  info: z
    .object({ title: z.unknown().optional(), version: z.unknown().optional() })
    .optional()
    .catch(undefined),
  channels: namedNodes,
  operations: namedNodes,
  servers: namedNodes,
});

type AsyncApiDocument = z.infer<typeof asyncApiDocument>;

const example = z.object({
  name: z.string().optional().catch(undefined),
  payload: jsonValueSchema.optional(),
});

const message = z.object({
  name: z.unknown().optional(),
  title: z.unknown().optional(),
  summary: z.unknown().optional(),
  description: z.unknown().optional(),
  payload: z.unknown().optional(),
  examples: z.array(z.unknown()).optional().catch(undefined),
});

type Message = z.infer<typeof message>;

// AsyncAPI 2.x: an operation carries one message, or a `oneOf` list of them.
const operationV2Messages = z
  .object({ message: z.unknown().optional() })
  .catch({ message: undefined })
  .transform(({ message: single }) => {
    const choice = z.object({ oneOf: z.array(z.unknown()) }).safeParse(single);

    if (choice.success) return choice.data.oneOf;

    return single ? [single] : [];
  });

// Server names (2.x) or server `$ref`s (3.x); absent means every server.
const channelServers = z.array(z.unknown()).optional().catch(undefined);

const channelV2 = z
  .object({
    subscribe: z.unknown().optional(),
    publish: z.unknown().optional(),
    servers: channelServers,
    bindings: namedNodes,
  })
  .catch({ subscribe: undefined, publish: undefined, servers: undefined, bindings: {} });

const channelV3 = z
  .object({
    address: z.unknown().optional(),
    messages: namedNodes,
    servers: channelServers,
    bindings: namedNodes,
  })
  .catch({ address: undefined, messages: {}, servers: undefined, bindings: {} });

const server = z.object({ protocol: z.string() });

const serverName = z.string();

type Transport = NonNullable<NonNullable<AdapterEvent['meta']>['transport']>[number];

/**
 * Where a channel's messages travel: its address and the protocols of the
 * servers it names, or of every server when it names none, as AsyncAPI reads
 * it. A binding is a protocol too. AsyncAPI has no delivery mode of its own.
 */
function transportOf(
  doc: AsyncApiDocument,
  address: string,
  channel: { servers?: unknown[]; bindings: object },
): Transport {
  const servers = channel.servers ?? Object.values(doc.servers);

  const protocols = servers.flatMap((ref) => {
    // 2.x names a server; 3.x points at one.
    const name = serverName.safeParse(ref);

    try {
      const parsed = server.safeParse(deref(doc, name.success ? doc.servers[name.data] : ref));

      return parsed.success ? [parsed.data.protocol] : [];
    } catch {
      return [];
    }
  });

  return {
    address,
    protocols: [...new Set([...protocols, ...Object.keys(channel.bindings)])].sort(),
  };
}

const channelRef = z
  .object({ $ref: z.string() })
  .optional()
  .catch(undefined)
  .transform((ref) => ref?.$ref);

const operationV3 = z
  .object({ channel: channelRef, action: z.unknown().optional() })
  .catch({ channel: undefined, action: undefined });

/**
 * Read and parse the document, failing with something a person can act on.
 *
 * A migration is the first thing anyone runs, usually against a file they
 * half-remember the path of. A Node stack trace is the wrong answer to every
 * mistake they are about to make.
 */
async function readAsyncApiDocument(file: string): Promise<AsyncApiDocument> {
  const resolved = path.resolve(file);

  let raw: string;

  try {
    raw = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;

    if (code === 'ENOENT') throw new Error(`no such file: ${resolved}`, { cause: error });

    if (code === 'EISDIR')
      throw new Error(`${resolved} is a directory — pass the document itself`, {
        cause: error,
      });
    throw new Error(`could not read ${resolved}: ${describe(error)}`, { cause: error });
  }

  let doc: unknown;

  try {
    doc = file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
  } catch (error) {
    throw new Error(
      `${resolved} is not valid ${file.endsWith('.json') ? 'JSON' : 'YAML'}: ${describe(error)}`,
      { cause: error },
    );
  }

  if (!z.looseObject({}).safeParse(doc).success) {
    throw new Error(`${resolved} does not contain an AsyncAPI document`);
  }

  const parsed = asyncApiDocument.safeParse(doc);

  if (!parsed.success) {
    // Being pointed at an OpenAPI spec, a Kubernetes manifest or the wrong
    // yaml entirely is common enough to deserve its own sentence.
    throw new Error(
      `${resolved} has no top-level "asyncapi" version field — is this an AsyncAPI document?`,
    );
  }

  return parsed.data;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

interface ImportedMessage {
  id: string;
  name: string;
  summary: string;
  domain: string;
  /** What the message says of itself under x-autocatalog, as ac to-asyncapi writes it. */
  meta?: AdapterEventMeta | undefined;
  version?: string | undefined;
  payload: AdapterEvent['schema'];
  producers: string[];
  consumers: string[];
  examples: AdapterEvent['examples'];
  transport: Transport[];
}

/**
 * What makes two messages one event: the same id in the same domain at the same
 * version. An id alone would merge billing's `created` with sales'.
 */
const identityOf = (message: Pick<ImportedMessage, 'domain' | 'id' | 'version'>) =>
  `${message.domain}/${message.id}@${message.version ?? ''}`;

function addTransport(entry: ImportedMessage, transport: Transport): void {
  if (!entry.transport.some((known) => known.address === transport.address)) {
    entry.transport.push(transport);
  }
}

function channelDomain(channelName: string): string {
  const seg = channelName.split(/[/.]/)[0] ?? channelName;

  return seg.replace(/[^a-zA-Z0-9_-]/g, '') || 'events';
}

// Case is load-bearing: the event folder is pascalCase(id), and pascalCase can
// only recover word boundaries from separators or existing capitals. Lowercasing
// "orderShipped" here yields the folder "Ordershipped" rather than "OrderShipped".
function messageId(msg: Message, channelName: string): string {
  const raw = msg.name ?? msg.title ?? channelName;

  const id = String(raw)
    .replace(/[/\s]+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '');

  // Separators alone survive the strip — a channel named "///" reduces to ".",
  // which is truthy, becomes an empty folder name, and fails the whole publish
  // with a message about path segments. Treat it as unnamed here instead.
  return /[a-zA-Z0-9]/.test(id) ? id : '';
}

/**
 * A message's examples. A name like `duplicate/redelivered` is a case folder
 * and a file name, as ac to-asyncapi writes it and as EventCatalog's generator
 * lays it out on disk; the example is `redelivered`, in the duplicate case.
 */
function collectExamples(msg: Message): AdapterEvent['examples'] {
  return (msg.examples ?? []).flatMap((raw, i) => {
    const ex = example.safeParse(raw);

    if (!ex.success || ex.data.payload === undefined) return [];

    const written = ex.data.name ?? `example-${i + 1}`;
    const exampleCase = exampleCaseOf(written);

    // A folder that is not a case cannot be part of a file name, so it joins it.
    const name = exampleCase ? written.slice(exampleCase.length + 1) : written.replace(/\//g, '-');

    return [{ name, data: ex.data.payload, ...(exampleCase && { case: exampleCase }) }];
  });
}

/** The component key a `$ref` to `#/components/messages/<key>` names, when it is one. */
const componentMessageKey = z
  .object({ $ref: z.string().regex(/^#\/components\/messages\/[^/]+$/) })
  .transform(({ $ref }) => $ref.slice('#/components/messages/'.length))
  .optional()
  .catch(undefined);

const eventCatalogVersion = z.string().optional().catch(undefined);

/** x-autocatalog on the resolved message, and the version EventCatalog's extension names. */
function messageMeta(message: JsonValue) {
  if (!isJsonObject(message)) return { meta: undefined, version: undefined };

  const meta = readVendorMeta(message);

  return {
    meta,
    version: meta?.version ?? eventCatalogVersion.parse(message['x-eventcatalog-message-version']),
  };
}

/**
 * The payload as a schema that stands alone. Inside the document its references
 * point at `#/components/schemas/...`; the event folder has no components, so
 * each one referenced moves into `$defs`, without the prefix ac to-asyncapi gave
 * it, and its references follow.
 */
function importPayload(doc: AsyncApiDocument, payload: JsonValue, prefix: string): JsonObject {
  const defs: Record<string, JsonValue> = {};

  // A payload that is a reference to a component is that component, so a
  // reference to it from inside is a reference to the payload's own root.
  const root = componentSchemaRef.parse(payload);

  const local = (ref: string): string => {
    const match = /^#\/components\/schemas\/([^/]+)(.*)$/.exec(ref);

    if (!match) return ref;

    const [, component = '', rest = ''] = match;

    if (component === root) return `#${rest}`;

    const name = component.startsWith(`${prefix}_`)
      ? component.slice(prefix.length + 1)
      : component;

    if (!Object.hasOwn(defs, name)) {
      defs[name] = {}; // claimed first, so a recursive reference stops here

      const definition = jsonValueSchema.parse(
        deref(doc, { $ref: `#/components/schemas/${component}` }),
      );

      // A component cannot be a boolean schema, so ac to-asyncapi writes `false`
      // as `{ not: {} }` and `true` as `{}`; each means exactly the same.
      defs[name] = matchesNothing.safeParse(definition).success
        ? false
        : matchesAll.safeParse(definition).success
          ? true
          : rewriteRefs(definition, local);
    }

    return `#/$defs/${name}${rest}`;
  };

  const resolved = rewriteObjectRefs(jsonObjectSchema.parse(deref(doc, payload)), local);

  return Object.keys(defs).length ? { ...resolved, $defs: { ...defs } } : resolved;
}

const matchesNothing = z.strictObject({ not: z.strictObject({}) });

/** The component a `$ref` to `#/components/schemas/<name>` names, when it is one. */
const componentSchemaRef = z
  .object({ $ref: z.string().regex(/^#\/components\/schemas\/[^/]+$/) })
  .transform(({ $ref }) => $ref.slice('#/components/schemas/'.length))
  .optional()
  .catch(undefined);

const matchesAll = z.strictObject({});

// What a structured CloudEvent carries as `data`, the event's own schema.
const envelopeData = z.object({ properties: z.object({ data: jsonValueSchema }) });

/** The event's schema: the payload, or its `data` when the payload is a CloudEvent. */
function eventSchema(doc: AsyncApiDocument, payload: JsonValue, meta?: AdapterEventMeta) {
  if (meta?.envelope?.mode !== 'structured') return payload;

  const envelope = envelopeData.safeParse(deref(doc, payload));

  return envelope.success ? envelope.data.properties.data : payload;
}

function fromV2(doc: AsyncApiDocument, skipped: string[]): ImportedMessage[] {
  const app = String(doc.info?.title ?? 'Application').replace(/\s+/g, '');
  const out = new Map<string, ImportedMessage>();

  for (const [channelName, channelRaw] of Object.entries(doc.channels)) {
    let channel: z.infer<typeof channelV2>;

    try {
      channel = channelV2.parse(deref(doc, channelRaw));
    } catch (error) {
      skipped.push(`channel ${channelName}: ${describe(error)}`);
      continue;
    }

    // AsyncAPI 2.x is written from the application's perspective:
    // subscribe = the app publishes these; publish = others publish to the app.
    for (const [op, role] of [
      ['subscribe', 'producer'],
      ['publish', 'consumer'],
    ] as const) {
      const operation = channel[op];

      if (!operation) continue;

      const messages = operationV2Messages.parse(operation);

      for (const msgRaw of messages) {
        let entry: ImportedMessage;

        try {
          const msg = message.parse(deref(doc, msgRaw));
          const { meta, version } = messageMeta(jsonValueSchema.parse(deref(doc, msgRaw)));
          const id = messageId(msg, channelName);

          // A message that reduces to nothing addressable cannot become a
          // folder, and silently writing it at the domain root is worse.
          if (!id) throw new Error('message has no usable name, title or channel');

          const domain = meta?.domain ?? channelDomain(channelName);

          entry = out.get(identityOf({ domain, id, version })) ?? {
            id,
            name: String(msg.title ?? msg.name ?? pascalCase(id)),
            summary: String(
              msg.summary ?? msg.description ?? `Imported from AsyncAPI channel ${channelName}.`,
            ),
            domain,
            meta,
            version,
            payload: importPayload(
              doc,
              eventSchema(doc, jsonValueSchema.parse(msg.payload ?? { type: 'object' }), meta),
              componentMessageKey.parse(msgRaw) ?? id,
            ),
            producers: [],
            consumers: [],
            examples: collectExamples(msg),
            transport: [],
          };
        } catch (error) {
          // One broken message must not cost the user the other forty.
          skipped.push(`channel ${channelName}: ${describe(error)}`);
          continue;
        }

        addTransport(entry, transportOf(doc, channelName, channel));

        if (role === 'producer' && !entry.producers.includes(app)) entry.producers.push(app);

        if (role === 'consumer' && !entry.consumers.includes(app)) entry.consumers.push(app);
        out.set(identityOf(entry), entry);
      }
    }
  }

  return [...out.values()];
}

function fromV3(doc: AsyncApiDocument, skipped: string[]): ImportedMessage[] {
  const app = String(doc.info?.title ?? 'Application').replace(/\s+/g, '');

  const byChannel = new Map<
    string,
    {
      channelName: string;
      messages: Map<string, { msg: Message; raw: unknown }>;
      transport: Transport;
    }
  >();

  for (const [key, channelRaw] of Object.entries(doc.channels)) {
    try {
      const channel = channelV3.parse(deref(doc, channelRaw));
      const messages = new Map<string, { msg: Message; raw: unknown }>();

      for (const [msgKey, msgRaw] of Object.entries(channel.messages)) {
        try {
          messages.set(msgKey, { msg: message.parse(deref(doc, msgRaw)), raw: msgRaw });
        } catch (error) {
          // Caught per message, not per channel: one unresolvable $ref must not
          // drop the other thirty-nine messages on the same channel.
          skipped.push(`channel ${key} message ${msgKey}: ${describe(error)}`);
        }
      }

      const channelName = String(channel.address ?? key);

      byChannel.set(`#/channels/${key}`, {
        channelName,
        messages,
        transport: transportOf(doc, channelName, channel),
      });
    } catch (error) {
      skipped.push(`channel ${key}: ${describe(error)}`);
    }
  }

  const out = new Map<string, ImportedMessage>();

  for (const [operationKey, operationRaw] of Object.entries(doc.operations)) {
    let operation: z.infer<typeof operationV3>;

    try {
      operation = operationV3.parse(deref(doc, operationRaw));
    } catch (error) {
      skipped.push(`operation ${operationKey}: ${describe(error)}`);
      continue;
    }

    const channelRef = operationV3.parse(operationRaw).channel ?? operation.channel;
    const channel = channelRef ? byChannel.get(channelRef) : undefined;

    if (!channel) {
      // Dropping this quietly loses events from the import with no trace, and
      // the user finds out when a catalog they trusted is missing something.
      skipped.push(
        `operation ${operationKey}: channel ${channelRef ?? '(none declared)'} not found`,
      );
      continue;
    }

    for (const [msgKey, { msg, raw }] of channel.messages) {
      let entry: ImportedMessage;

      try {
        const { meta, version } = messageMeta(jsonValueSchema.parse(deref(doc, raw)));
        const id = messageId(msg, channel.channelName);

        if (!id) throw new Error('message has no usable name, title or channel');

        const domain = meta?.domain ?? channelDomain(channel.channelName);

        entry = out.get(identityOf({ domain, id, version })) ?? {
          id,
          name: String(msg.title ?? msg.name ?? pascalCase(id)),
          summary: String(
            msg.summary ??
              msg.description ??
              `Imported from AsyncAPI channel ${channel.channelName}.`,
          ),
          domain,
          meta,
          version,
          payload: importPayload(
            doc,
            eventSchema(doc, jsonValueSchema.parse(msg.payload ?? { type: 'object' }), meta),
            componentMessageKey.parse(raw) ?? msgKey,
          ),
          producers: [],
          consumers: [],
          examples: collectExamples(msg),
          transport: [],
        };
      } catch (error) {
        skipped.push(`operation ${operationKey}: ${describe(error)}`);
        continue;
      }

      addTransport(entry, channel.transport);

      if (operation.action === 'send' && !entry.producers.includes(app)) entry.producers.push(app);

      if (operation.action === 'receive' && !entry.consumers.includes(app))
        entry.consumers.push(app);
      out.set(identityOf(entry), entry);
    }
  }

  return [...out.values()];
}

export async function runFromAsyncApi(opts: RunFromAsyncApiOptions): Promise<number> {
  let doc: AsyncApiDocument;

  try {
    doc = await readAsyncApiDocument(opts.file);
  } catch (error) {
    console.error(kleur.red(`✗ ${describe(error)}`));

    return 1;
  }

  const versionField = String(doc.asyncapi);
  const docVersion = String(doc.info?.version ?? '1.0.0');
  // Every reason a message did not make it. An import that quietly drops things
  // is worse than one that fails, because the catalog looks complete.
  const skipped: string[] = [];
  let messages: ImportedMessage[];

  if (versionField.startsWith('2')) messages = fromV2(doc, skipped);
  else if (versionField.startsWith('3')) messages = fromV3(doc, skipped);
  else {
    console.error(
      kleur.red(`✗ unsupported asyncapi version "${versionField}" — 2.x and 3.x are supported`),
    );

    return 1;
  }

  const events: AdapterEvent[] = messages.map((msg) => ({
    id: msg.id,
    version: msg.version ?? docVersion,
    name: msg.name,
    summary: msg.summary,
    domain: msg.domain,
    folderName: pascalCase(msg.id),
    schema: msg.payload,
    examples: msg.examples,
    // What the message says of itself wins over what the document's view implies.
    meta: {
      ...msg.meta,
      producers: msg.meta?.producers ?? msg.producers,
      consumers: msg.meta?.consumers ?? msg.consumers,
      transport: msg.transport,
    },
    source: { type: 'url' as const, schema: opts.file },
    provenance: { default: 'declared', fields: {} },
  }));

  if (messages.length === 0) {
    // Exiting 1 with only a count leaves the user guessing at which of a dozen
    // possible causes they hit.
    console.error(kleur.red('✗ nothing to import'));

    for (const reason of skipped) console.error(kleur.yellow(`  ! ${reason}`));
    console.error(
      skipped.length > 0
        ? '  Every message in the document was skipped for the reasons above.'
        : `  The document declares no ${versionField.startsWith('2') ? 'channels with messages' : 'operations bound to channels with messages'}.`,
    );

    return 1;
  }

  // One event in several versions: the newest is the event, the rest its history.
  const versions = new Map<string, AdapterEvent[]>();

  for (const event of events) {
    const key = `${event.domain}/${event.id}`;
    versions.set(key, [...(versions.get(key) ?? []), event]);
  }

  const current: AdapterEvent[] = [];
  const history: Array<{ event: AdapterEvent; parentFolderName: string }> = [];

  for (const same of versions.values()) {
    const [newest, ...older] = [...same].sort((a, b) => compareSemverish(b.version, a.version));

    if (!newest) continue;

    current.push(newest);
    history.push(...older.map((event) => ({ event, parentFolderName: newest.folderName })));
  }

  try {
    await publishCatalog({ outRoot: path.resolve(opts.out), events: current, history });
  } catch (error) {
    console.error(kleur.red(`✗ could not write the catalog: ${describe(error)}`));

    return 1;
  }

  if (!opts.quiet) {
    for (const msg of messages) {
      console.log(`${kleur.green('✓')} ${msg.domain}/${msg.id}@${docVersion}`);
    }

    for (const reason of skipped) console.warn(kleur.yellow(`  ! skipped ${reason}`));
    console.log(kleur.bold(`\n${messages.length} event(s) imported to ${opts.out}`));

    if (skipped.length > 0) {
      console.log(kleur.yellow(`${skipped.length} skipped — the catalog is incomplete.`));
    }

    // An import that ends in a count leaves the user wondering whether it
    // worked. Ending on the next command answers that.
    console.log(
      kleur.dim(
        `  Commit ${opts.out}: ac site and ac drift read it, and only re-running this import updates it.`,
      ),
    );
    console.log(kleur.dim('  Next: ac validate, then ac site . --dev to browse it.'));
  }

  // A partial import is the right default for a person working through a
  // migration, and the wrong one for a pipeline that will publish the result.
  return opts.strict && skipped.length > 0 ? 1 : 0;
}
