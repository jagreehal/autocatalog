import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import utils from '@eventcatalog/sdk';
import { stringify as stringifyYaml } from 'yaml';
import {
  assertPathSegment,
  createCatalogProjection,
  exampleCaseSummary,
  loadCatalogSnapshot,
  parseFrontmatter,
  isServiceCatalogResource,
  jsonObjectSchema,
  provenanceSummary,
  readResourceGraph,
  resourceKey,
  type CatalogResource,
  type JsonObject,
  type LoadedEvent,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { AdapterExecutionError } from './adapters';

/**
 * Write an autocatalog catalog into an EventCatalog project.
 *
 * autocatalog finds, verifies and publishes contracts; EventCatalog is the
 * richer place to look at them. This keeps the two honest with each other:
 * every domain, service and event comes from the published catalog through
 * EventCatalog's own MIT-licensed SDK, and each event page says where its
 * contract was found.
 */
/** A repository's events, current and historical, as the exporter takes them. */
export interface EventCatalogSource {
  name: string;
  events: LoadedEvent[];
  /** Its commands, services and datastores: the `.autocatalog/resources.json` beside `events/`. */
  graph?: ResourceGraph | undefined;
}

/** Load published `events/` roots, one per repository, for {@link exportToEventCatalog}. */
export async function loadEventCatalogSources(roots: string[]): Promise<EventCatalogSource[]> {
  return Promise.all(
    roots.map(async (root) => ({
      name: root,
      events: (await loadCatalogSnapshot(root)).events,
      graph: await readResourceGraph(path.dirname(path.resolve(root))),
    })),
  );
}

export interface ExportToEventCatalogOptions {
  /** One loaded catalog per repository, named for messages about it. */
  catalogs: EventCatalogSource[];
  /** The EventCatalog project to write into. */
  catalogDir: string;
  /**
   * Copy each event's narrative into its EventCatalog page. Off unless asked:
   * EventCatalog compiles pages as MDX, which runs any code in them, so only
   * turn it on for repositories you trust to run code on this machine.
   */
  narrative?: boolean;
}

export interface ExportToEventCatalogResult {
  domains: number;
  services: number;
  /** Distinct events written. */
  events: number;
  /** Every version written, current and historical. */
  versions: number;
  teams: number;
  /** Commands and queries written, from the repositories' resource graphs. */
  commands: number;
  dataStores: number;
  /** Resources left alone because autocatalog did not write them. */
  skipped: string[];
  /** The current version of each resource written, keyed by autocatalog's id: what EventCatalog calls it. */
  written: Record<'events' | 'services' | 'domains', Record<string, EventCatalogPointer>>;
}

export interface EventCatalogPointer {
  id: string;
  version: string;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One line a reader can check: where the contract is defined and how we know. */
export function provenanceLine(event: LoadedEvent): string | null {
  const { location, symbol, facts } = provenanceSummary(event.frontmatter);

  if (!location) return null;
  const where = `${codeSpan(location)}${symbol ? ` as ${codeSpan(symbol)}` : ''}`;

  return `Defined in ${where} · ${facts.join(' · ')}. Published by [autocatalog](https://github.com/jagreehal/autocatalog).`;
}

/**
 * Literal text in an MDX page: a code span fenced longer than any backtick run
 * inside it, so a value from a repository cannot close it and become MDX.
 */
function codeSpan(value: string): string {
  const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1);

  // CommonMark trims one space each side, which a value starting or ending
  // with a backtick needs to keep it apart from the fence.
  const pad = /^`|`$/.test(value) ? ' ' : '';

  return `${fence}${pad}${value}${pad}${fence}`;
}

/**
 * EventCatalog has no field for an event's classification, so it travels as a
 * badge: visible on the event page, and read back by `ac from-eventcatalog`.
 */
export const CLASSIFICATION_BADGE_PREFIX = 'classification: ';

/** What autocatalog marks as its own inside an EventCatalog project. */
const MARKER = 'x-autocatalog';

/** Every file the last export wrote, so the next one removes exactly those. */
const MANIFEST = '.autocatalog-export.json';

const exportManifest = z.object({ files: z.array(z.string()) });

/** The ids of the services a domain page lists; entries without a string id are passed over. */
const domainServiceIds = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const service = z.object({ id: z.string() }).safeParse(entry);

      return service.success ? [service.data.id] : [];
    }),
  );

/** An address that can be a channel id, and so a folder, as it is. */
const SAFE_CHANNEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * An address that is already a safe id is its own id. Any other is slugged and
 * suffixed with a hash of the address, so `orders/{id}` and `orders-id` stay two
 * channels however they slug.
 */
function channelId(address: string): string {
  if (SAFE_CHANNEL_ID.test(address)) return address;
  const hash = createHash('sha256').update(address).digest('hex').slice(0, 8);

  return [slug(address), hash].filter(Boolean).join('-');
}

const RESOURCE_FILE = /^index\.mdx?$/;

const IGNORED = new Set(['node_modules', 'dist', '.eventcatalog-core', '.git']);

async function readFrontmatter(file: string): Promise<JsonObject | null> {
  try {
    return parseFrontmatter(await fs.readFile(file, 'utf8')).data;
  } catch {
    return null;
  }
}

/** Every service page an export has written ends with this sentence. */
const SERVICE_SIGNATURE =
  'Inferred by autocatalog from the producers and consumers each event declares.';

interface PreviousExport {
  /** Files the last export provably wrote, to remove. */
  files: string[];
  /** Files it may have written but nothing proves it; kept, and reported. */
  unproven: string[];
}

/**
 * What an export from before the manifest wrote. Only files with evidence go:
 * the index.mdx of a resource, or of a version under versioned/, whose own
 * page carries the x-autocatalog marker, the schema.json of such an event, and a service page, unmarked in
 * that format, that ends with the sentence the export wrote. Examples carry no
 * evidence either way, so they stay; the export overwrites the ones it writes
 * again and reports the rest. Notes, diagrams and anything else stay too.
 */
async function legacyExport(catalogDir: string): Promise<PreviousExport> {
  const files: string[] = [];
  const unproven: string[] = [];

  // The export only ever wrote index.mdx, plus a schema and examples for
  // events. A schema beside a domain or service came from someone else.
  const pageFiles = async (dir: string, isEvent: boolean) => {
    files.push(path.join(dir, 'index.mdx'));
    const schema = path.join(dir, 'schema.json');

    if (isEvent) files.push(schema);
    else if (await fs.stat(schema).catch(() => null)) unproven.push(schema);

    if (!isEvent) return;

    for (const name of await fs.readdir(path.join(dir, 'examples')).catch(() => [])) {
      unproven.push(path.join(dir, 'examples', name));
    }
  };

  const marked = async (dir: string) => {
    for (const name of ['index.mdx', 'index.md']) {
      const data = await readFrontmatter(path.join(dir, name));

      if (data && MARKER in data) return true;
    }

    return false;
  };

  const generated = async (dir: string) => {
    // It wrote events to domains/<domain>/events/<id>.
    const isEvent = path.basename(path.dirname(dir)) === 'events';
    await pageFiles(dir, isEvent);

    for (const version of await fs.readdir(path.join(dir, 'versioned')).catch(() => [])) {
      const versionDir = path.join(dir, 'versioned', version);

      if (await marked(versionDir)) await pageFiles(versionDir, isEvent);
    }
  };

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name) && entry.name !== 'versioned') await walk(full);
        continue;
      }

      if (!RESOURCE_FILE.test(entry.name)) continue;
      const data = await readFrontmatter(full);

      if (!data || !(MARKER in data)) continue;
      await generated(dir);

      // A domain lists its services, but a hand-written service linked to it
      // is listed the same way. Only the export's own sentence proves it.
      for (const id of domainServiceIds.parse(data.services)) {
        const serviceDir = path.join(dir, 'services', id);
        const page = await fs.readFile(path.join(serviceDir, 'index.mdx'), 'utf8').catch(() => '');

        if (!page || (await marked(serviceDir))) continue; // absent, or found by the walk

        if (page.trimEnd().endsWith(SERVICE_SIGNATURE)) await generated(serviceDir);
        else unproven.push(path.join(serviceDir, 'index.mdx'));
      }
    }
  };

  await walk(catalogDir);

  return { files, unproven };
}

/**
 * The files the last export owns. No manifest means an export from before
 * there was one. A manifest that cannot be read stops the export: guessing
 * would mean deleting on a wider rule than the one that wrote the files.
 */
async function previousExport(catalogDir: string): Promise<PreviousExport> {
  const file = path.join(catalogDir, MANIFEST);
  let text: string;

  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return legacyExport(catalogDir);
    }

    throw error;
  }

  let files: string[] | undefined;

  try {
    files = exportManifest.safeParse(JSON.parse(text)).data?.files;
  } catch {
    files = undefined;
  }

  if (!files) {
    throw new Error(
      `${file} is not a list of the files autocatalog wrote. Restore it from version control, or delete it to clean up as an export from before the manifest.`,
    );
  }

  return { files: files.map((entry) => path.resolve(catalogDir, entry)), unproven: [] };
}

/**
 * Runtime evidence `autotel-eventcatalog stamp` writes into an event page,
 * between markers it owns. The page is ours, the block is autotel's.
 */
const STAMP = /<!-- autotel:stamp-start -->[\s\S]*?<!-- autotel:stamp-end -->/;

async function readStamps(files: string[]): Promise<Map<string, string>> {
  const stamps = new Map<string, string>();

  for (const file of files.filter((name) => name.endsWith('.mdx'))) {
    const block = (await fs.readFile(file, 'utf8').catch(() => '')).match(STAMP)?.[0];

    if (block) stamps.set(file, block);
  }

  return stamps;
}

/** Replace the manifest in one step, so a crash never leaves half of it. */
async function saveManifest(catalogDir: string, files: string[]): Promise<void> {
  const target = path.join(catalogDir, MANIFEST);
  const body = { files: files.map((file) => file.split(path.sep).join('/')).sort() };
  await fs.writeFile(`${target}.tmp`, `${JSON.stringify(body, null, 2)}\n`);
  await fs.rename(`${target}.tmp`, target);
}

/** Remove the files, then any folder they leave empty. Nothing outside the project. */
async function removeFiles(files: string[], catalogDir: string): Promise<void> {
  const inside = (file: string) => file.startsWith(catalogDir + path.sep);

  for (const file of files.filter(inside)) {
    await fs.rm(file, { force: true });

    for (let dir = path.dirname(file); inside(dir); dir = path.dirname(dir)) {
      const left = await fs.readdir(dir).catch(() => null);

      if (left === null || left.length > 0) break;
      await fs.rmdir(dir);
    }
  }
}

/**
 * EventCatalog ids are global, so an event id published from two roots or
 * two domains cannot become one event without merging unrelated contracts.
 * Refuse before anything is written.
 */
function eventsById(catalogs: EventCatalogSource[]) {
  const byId = new Map<string, { root: string; event: LoadedEvent }[]>();

  for (const { name, events } of catalogs) {
    for (const event of events) {
      const id = event.frontmatter.id;
      byId.set(id, [...(byId.get(id) ?? []), { root: name, event }]);
    }
  }

  const problems: string[] = [];

  for (const [id, entries] of byId) {
    const places = [
      ...new Set(entries.map(({ root, event }) => `${root} (${event.frontmatter.domain})`)),
    ];

    const current = entries.filter(({ event }) => !event.folder.isVersioned).length;

    if (places.length > 1) problems.push(`${id} is published by ${places.join(' and ')}`);
    else if (current !== 1) problems.push(`${id} has ${current} current versions in ${places[0]}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `Cannot export to EventCatalog, where an event id names one event:\n  ${problems.join('\n  ')}\nRename one of them, or export them to separate catalogs.`,
    );
  }

  return new Map([...byId].map(([id, entries]) => [id, entries.map(({ event }) => event)]));
}

type Guarantee = NonNullable<LoadedEvent['frontmatter']['delivery']>['guarantee'];

/** Where an example goes under examples/: its case folder, as EventCatalog nests them. */
function examplePath(example: LoadedEvent['examples'][number]): string[] {
  return [...(example.case ? [example.case] : []), `${example.name}.json`];
}

/**
 * EventCatalog's examples.config.yaml: a name and summary for each example that
 * has more to say than its file name, so its readers see what each case shows.
 */
function exampleConfig(event: LoadedEvent) {
  const entries = event.examples.flatMap((example) => {
    const summary = example.summary ?? (example.case && exampleCaseSummary(example.case));

    if (!summary && !example.title) return [];

    return [
      [
        examplePath(example).join('/'),
        { name: example.title ?? example.name, ...(summary && { summary }) },
      ] as const,
    ];
  });

  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** A link a reader can follow; a git remote or a `javascript:` URL is not one. */
export const webAddress = z.url({ protocol: /^https?$/ });

/**
 * An owner's contact as the team page field EventCatalog reads it from: an
 * address is its email, a Microsoft Teams link its Teams chat, and any other
 * web address its Slack link, where ac from-eventcatalog looks first. The
 * contact may be another repository's, so anything else is left out.
 */
function contactFields(contact: string | undefined) {
  const email = z.email().safeParse(contact?.replace(/^mailto:/, ''));

  if (contact?.startsWith('mailto:') && email.success) return { email: email.data };

  const url = webAddress.safeParse(contact);

  if (!url.success) return {};

  return new URL(url.data).hostname === 'teams.microsoft.com'
    ? { msTeamsDirectMessageUrl: url.data }
    : { slackDirectMessageUrl: url.data };
}

/** The system a service is part of; the graph's attributes are free-form. */
const systemAttribute = z
  .object({ id: z.string().min(1), name: z.string().min(1).optional() })
  .optional()
  .catch(undefined);

/** Where ac from-eventcatalog files the datastores it imports. */
export const EVENTCATALOG_NAMESPACE = 'eventcatalog';

/** EventCatalog's id for a datastore: the one it was imported with, else its namespace and name. */
const dataStoreId = (ref: ResourceRef) =>
  !ref.namespace || ref.namespace === EVENTCATALOG_NAMESPACE
    ? ref.id
    : slug(`${ref.namespace}-${ref.id}`);

const CONTAINER_TYPES = [
  'database',
  'cache',
  'objectStore',
  'searchIndex',
  'dataWarehouse',
  'dataLake',
  'externalSaaS',
  'other',
] as const;

// A graph's attributes are free-form; these are the ones the export reads.
const commandAttributes = z
  .object({
    schema: jsonObjectSchema.optional().catch(undefined),
    transport: z
      .array(z.object({ address: z.string(), protocols: z.array(z.string()).catch([]) }))
      .catch([]),
  })
  .catch({ transport: [] });

const dataStoreAttributes = z
  .object({
    technology: z.string().optional().catch(undefined),
    containerType: z.enum(CONTAINER_TYPES).optional().catch(undefined),
  })
  .catch({});

/**
 * Every repository's resource graph as one, the first declaration of each
 * resource standing: its commands, services and datastores, and who sends,
 * handles, reads and writes what.
 */
function repositoryGraph(catalogs: EventCatalogSource[]) {
  const resources = new Map<string, CatalogResource>();
  const edges = new Map<string, { type: string; from: ResourceRef; to: ResourceRef }>();

  for (const { graph } of catalogs) {
    for (const resource of graph?.resources ?? [])
      if (!resources.has(resourceKey(resource.ref)))
        resources.set(resourceKey(resource.ref), resource);

    for (const edge of graph?.relationships ?? [])
      edges.set(`${resourceKey(edge.from)} ${edge.type} ${resourceKey(edge.to)}`, edge);
  }

  const all = [...resources.values()];

  return {
    commands: all.filter((resource) => resource.ref.kind === 'command'),
    dataStores: all.filter((resource) => ['table', 'collection'].includes(resource.ref.kind)),
    services: new Map(
      all.flatMap((r) => (isServiceCatalogResource(r) ? [[r.ref.id, r] as const] : [])),
    ),
    /** What a service does to what: sends and handles commands, reads and writes datastores. */
    of: (service: string, type: 'sends' | 'handles' | 'reads' | 'writes') =>
      [...edges.values()].flatMap((edge) => {
        const target = resources.get(resourceKey(edge.to));

        return edge.type === type &&
          edge.from.kind === 'service' &&
          edge.from.id === service &&
          target
          ? [target]
          : [];
      }),
  };
}

export async function exportToEventCatalog(
  opts: ExportToEventCatalogOptions,
): Promise<ExportToEventCatalogResult> {
  const byId = eventsById(opts.catalogs);
  const events = opts.catalogs.flatMap((catalog) => catalog.events);
  const projection = createCatalogProjection(events);
  const catalogDir = path.resolve(opts.catalogDir);

  // Each of these becomes a directory in the project. Checked before anything
  // is removed or written, so a hostile value leaves the project untouched.
  for (const event of events) {
    const { domain, id, version } = event.frontmatter;

    assertPathSegment(event.folder.path, 'domain', domain);
    assertPathSegment(event.folder.path, 'id', id);
    assertPathSegment(event.folder.path, 'version', version);
  }

  for (const service of projection.services.values()) {
    assertPathSegment(catalogDir, 'service', service.name);
  }

  const graph = repositoryGraph(opts.catalogs);

  for (const command of graph.commands) {
    assertPathSegment(catalogDir, 'command', command.ref.id);
    assertPathSegment(catalogDir, 'domain', command.ref.namespace ?? 'default');
    assertPathSegment(catalogDir, 'version', command.ref.version ?? '1.0.0');
  }

  for (const store of graph.dataStores)
    assertPathSegment(catalogDir, 'data store', dataStoreId(store.ref));

  for (const [name, service] of graph.services) {
    assertPathSegment(catalogDir, 'service', name);

    for (const domain of service.attributes.domains)
      assertPathSegment(catalogDir, 'domain', domain);

    const system = systemAttribute.parse(service.attributes.system);

    if (system) assertPathSegment(catalogDir, 'system', system.id);
  }

  // One channel per address, however many events travel on it. EventCatalog 4
  // points at channels from a service's sends (`to`) and receives (`from`), and
  // its build moves an event's own `channels` there; only an event no service
  // sends or receives keeps them. The delivery mode rides on the pointer, where
  // `ac from-eventcatalog` reads it back.
  const channels = new Map<
    string,
    { id: string; protocols: Set<string>; guarantees: Set<Guarantee | undefined> }
  >();

  for (const event of events)
    for (const { address, protocols } of event.frontmatter.transport ?? []) {
      if (!address) continue;

      const channel = channels.get(address) ?? {
        id: channelId(address),
        protocols: new Set<string>(),
        guarantees: new Set<Guarantee | undefined>(),
      };

      protocols.forEach((protocol) => channel.protocols.add(protocol));

      // A channel's guarantee covers everything on it, so it is claimed only
      // when every current event on it makes the same one.
      if (!event.folder.isVersioned) channel.guarantees.add(event.frontmatter.delivery?.guarantee);
      channels.set(address, channel);
    }

  // A command makes no delivery promise, so a channel carrying one claims none.
  for (const command of graph.commands)
    for (const { address, protocols } of commandAttributes.parse(command.attributes).transport) {
      const channel = channels.get(address) ?? {
        id: channelId(address),
        protocols: new Set<string>(),
        guarantees: new Set<Guarantee | undefined>(),
      };

      protocols.forEach((protocol) => channel.protocols.add(protocol));
      channel.guarantees.add(undefined);
      channels.set(address, channel);
    }

  // Distinct addresses are distinct channels: one id for two would merge their
  // transports and point both at whichever was written last. Refused here,
  // before cleanup, so the previous export survives.
  const claimed = new Map<string, string>();

  for (const [address, { id }] of channels) {
    const other = claimed.get(id);

    if (other !== undefined) {
      throw new Error(`Channel addresses ${other} and ${address} both map to channel id ${id}`);
    }

    claimed.set(id, address);
  }

  await fs.mkdir(catalogDir, { recursive: true });

  // Remove exactly what autocatalog wrote last time, so a retired event,
  // service or domain disappears. Every other file, including one someone
  // added beside a generated page, stays.
  const previous = await previousExport(catalogDir);
  // Kept by path: an event that moves domain gets its stamp at the next `stamp`.
  const stamps = await readStamps(previous.files);
  await removeFiles(previous.files, catalogDir);
  // Ownership is recorded before each file is written, so an export that
  // fails part way leaves a manifest the next run can clean up from.
  const written: string[] = [];

  const own = async (...files: string[][]) => {
    written.push(...files.map((parts) => path.join(...parts)));
    await saveManifest(catalogDir, written);
  };

  await own();
  // The SDK caches its file index and checks only the project folder's mtime,
  // so say that the tree changed underneath it.
  const now = new Date();
  await fs.utimes(catalogDir, now, now);
  const sdk = utils(catalogDir);

  const skipped: string[] = [];
  const pointers: ExportToEventCatalogResult['written'] = { events: {}, services: {}, domains: {} };

  /** Whatever is still there after cleanup is someone else's, and is left alone. */
  const foreign = (kind: string, id: string, exists: boolean) => {
    if (!exists) return false;
    skipped.push(`${kind} ${id} exists and was not written by autocatalog; left as it is`);

    return true;
  };

  const current = projection.currentEvents;

  const domains = [
    ...new Set([
      ...current.map((event) => event.frontmatter.domain),
      ...graph.commands.map((command) => command.ref.namespace ?? 'default'),
      ...[...graph.services.values()].flatMap((service) => service.attributes.domains),
    ]),
  ].sort();

  const teams = new Map<string, NonNullable<CatalogResource['owner']>>();

  for (const owner of [
    ...events.map((event) => event.frontmatter.owner),
    ...[...graph.commands, ...graph.dataStores, ...graph.services.values()].map((r) => r.owner),
  ])
    if (owner && !teams.get(slug(owner.team))?.name) teams.set(slug(owner.team), owner);

  let teamsWritten = 0;

  for (const [id, { team, name, contact }] of teams) {
    // A team or person page is theirs; create a team page when there is
    // neither, and never overwrite one.
    if ((await sdk.getTeam(id)) || (await sdk.getUser(id))) continue;
    await sdk.writeTeam({ id, name: name ?? team, ...contactFields(contact), markdown: '' });
    teamsWritten += 1;
  }

  const channelPointers = (event: LoadedEvent) => {
    const pointers = new Map<string, { id: string; version: string; delivery_mode?: string }>();

    for (const { address, deliveryMode } of event.frontmatter.transport ?? []) {
      const id = address && channels.get(address)?.id;

      if (id && !pointers.has(id)) {
        pointers.set(id, {
          id,
          version: '1.0.0',
          ...(deliveryMode && { delivery_mode: deliveryMode }),
        });
      }
    }

    return [...pointers.values()];
  };

  for (const [address, { id, protocols, guarantees }] of channels) {
    if (foreign('channel', id, Boolean(await sdk.getChannel(id)))) continue;

    const [guarantee] = guarantees.size === 1 ? guarantees : [];

    await own(['channels', id, 'index.mdx']);
    await sdk.writeChannel(
      {
        id,
        name: address,
        version: '1.0.0',
        summary: `Where events travel on ${address}.`,
        markdown: '',
        address,
        protocols: [...protocols],
        ...(guarantee && { deliveryGuarantee: guarantee }),
        [MARKER]: { managed: true },
      },
      { path: id, override: true },
    );
  }

  // Every version of every event: the current one in the event's folder,
  // earlier ones under versioned/<version>, each with its schema and examples.
  const exported = new Set<string>();

  for (const [id, versions] of byId) {
    if (foreign('event', id, Boolean(await sdk.getEvent(id)))) {
      continue;
    }

    const latest = versions.find((event) => !event.folder.isVersioned)!;
    const eventDir = path.join('domains', latest.frontmatter.domain, 'events', id);

    const versionDir = (event: LoadedEvent) =>
      event === latest ? eventDir : path.join(eventDir, 'versioned', event.frontmatter.version);

    for (const event of versions) {
      const fm = event.frontmatter;

      const markdown = [
        provenanceLine(event),
        (opts.narrative === true && event.body.trim()) || null,
        '<SchemaViewer file="schema.json" />',
      ]
        .filter(Boolean)
        .join('\n\n');

      await own(
        [versionDir(event), 'index.mdx'],
        [versionDir(event), 'schema.json'],
        ...event.examples.map((example) => [
          versionDir(event),
          'examples',
          ...examplePath(example),
        ]),
        ...(exampleConfig(event) ? [[versionDir(event), 'examples', 'examples.config.yaml']] : []),
      );
      await sdk.writeEvent(
        {
          id: fm.id,
          name: fm.name,
          version: fm.version,
          summary: fm.summary,
          markdown,
          schemaPath: 'schema.json',
          ...(fm.producers.length + fm.consumers.length === 0 &&
            channelPointers(event).length > 0 && { channels: channelPointers(event) }),
          ...(fm.owner && { owners: [slug(fm.owner.team)] }),
          // EventCatalog requires both colours; autocatalog leaves them optional.
          ...((fm.badges.length > 0 || fm.classification) && {
            badges: [
              ...fm.badges,
              ...(fm.classification
                ? [{ content: `${CLASSIFICATION_BADGE_PREFIX}${fm.classification}` }]
                : []),
            ].map((badge) => ({
              content: badge.content,
              backgroundColor: badge.backgroundColor ?? 'gray',
              textColor: badge.textColor ?? 'gray',
            })),
          }),
          ...(fm.status === 'deprecated' && {
            deprecated: fm.deprecation
              ? { date: fm.deprecation.since, message: fm.deprecation.notes }
              : true,
          }),
          [MARKER]: {
            managed: true,
            provenance: fm.provenance,
            ...(fm.source && { source: fm.source }),
            ...(fm.confidence !== undefined && { confidence: fm.confidence }),
            ...(fm.delivery && { delivery: fm.delivery }),
            needsReview: fm.needsReview,
          },
        },
        // Each version is written where EventCatalog keeps it: the latest in
        // the event's folder, earlier ones under versioned/<version>. Paths
        // resolve from the SDK's own events/ folder, hence the leading '..'.
        { path: path.join('..', versionDir(event)), override: true },
      );
      const dir = path.join(catalogDir, versionDir(event));
      await fs.writeFile(
        path.join(dir, 'schema.json'),
        `${JSON.stringify(event.schema, null, 2)}\n`,
      );

      for (const example of event.examples) {
        const file = path.join(dir, 'examples', ...examplePath(example));

        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, `${JSON.stringify(example.data, null, 2)}\n`);
      }

      const config = exampleConfig(event);

      if (config)
        await fs.writeFile(
          path.join(dir, 'examples', 'examples.config.yaml'),
          stringifyYaml(config),
        );
    }

    exported.add(id);
    pointers.events[id] = { id, version: latest.frontmatter.version };
  }

  // Commands and queries, where EventCatalog keeps them in their domain. A
  // query is a command tagged `query`, as ac from-eventcatalog imports one.
  let commandsWritten = 0;

  for (const command of graph.commands) {
    const { id, version = '1.0.0', namespace = 'default' } = command.ref;
    const query = command.tags.includes('query');
    const kind = query ? 'query' : 'command';
    const exists = query ? await sdk.getQuery(id) : await sdk.getCommand(id);

    if (foreign(kind, id, Boolean(exists))) continue;

    const dir = path.join('domains', namespace, query ? 'queries' : 'commands', id);
    const { schema, transport } = commandAttributes.parse(command.attributes);

    const channelsOf = [
      ...new Set(transport.flatMap(({ address }) => channels.get(address)?.id ?? [])),
    ].map((channel) => ({ id: channel, version: '1.0.0' }));

    const data = {
      id,
      name: command.title,
      version,
      summary: command.summary ?? '',
      markdown: schema ? '<SchemaViewer file="schema.json" />' : '',
      ...(schema && { schemaPath: 'schema.json' }),
      ...(command.owner && { owners: [slug(command.owner.team)] }),
      ...(channelsOf.length > 0 && { channels: channelsOf }),
      [MARKER]: { managed: true },
    };

    await own([dir, 'index.mdx'], ...(schema ? [[dir, 'schema.json']] : []));

    // Paths resolve from the SDK's own commands/ or queries/ folder.
    if (query) await sdk.writeQuery(data, { path: path.join('..', dir), override: true });
    else await sdk.writeCommand(data, { path: path.join('..', dir), override: true });

    if (schema)
      await fs.writeFile(
        path.join(catalogDir, dir, 'schema.json'),
        `${JSON.stringify(schema, null, 2)}\n`,
      );

    commandsWritten += 1;
  }

  // Datastores, as EventCatalog's containers.
  let dataStoresWritten = 0;

  for (const store of graph.dataStores) {
    const id = dataStoreId(store.ref);

    // One only named by a service that uses it, with nothing else known of it,
    // gets no page of its own; the service's pointer to it stays, as it was.
    const placeholder =
      store.provenance.default === 'inferred' &&
      !store.owner &&
      !store.summary &&
      !store.evidence &&
      Object.keys(store.attributes).length === 0;

    if (placeholder) continue;

    if (foreign('data store', id, Boolean(await sdk.getDataStore(id)))) continue;

    const { technology, containerType } = dataStoreAttributes.parse(store.attributes);

    await own(['containers', id, 'index.mdx']);
    await sdk.writeDataStore(
      {
        id,
        name: store.title,
        version: '1.0.0',
        summary: store.summary ?? '',
        markdown: '',
        container_type: containerType ?? 'database',
        ...(technology && { technology }),
        ...(store.owner && { owners: [slug(store.owner.team)] }),
        [MARKER]: { managed: true },
      },
      { path: id, override: true },
    );
    dataStoresWritten += 1;
  }

  const versionOf = new Map(
    current.map((event) => [event.frontmatter.id, event.frontmatter.version]),
  );

  const pointer = ({ id }: { id: string }) => ({ id, version: versionOf.get(id) ?? 'latest' });

  const channelsOf = new Map(
    current.map((event) => [event.frontmatter.id, channelPointers(event)]),
  );

  const travel = (key: 'to' | 'from', id: string) => {
    const pointers = channelsOf.get(id) ?? [];

    return pointers.length > 0 ? { [key]: pointers } : {};
  };

  const consumerFieldsOf = new Map(
    current.map((event) => [event.frontmatter.id, event.frontmatter.consumerFields]),
  );

  const servicesByDomain = new Map<string, string[]>();

  // Systems, with the domain of their first service and the services they group.
  const systems = new Map<string, { name?: string; home?: string; services: string[] }>();
  let servicesWritten = 0;

  // The services events name, and the ones the graph knows that no event does:
  // a service that only sends commands or reads a datastore is one too.
  const names = [...new Set([...projection.services.keys(), ...graph.services.keys()])].sort();

  for (const name of names) {
    if (foreign('service', name, Boolean(await sdk.getService(name)))) {
      continue;
    }

    const service = projection.services.get(name);
    const declared = graph.services.get(name);
    const produces = service?.produces ?? [];
    const consumes = service?.consumes ?? [];
    const sent = graph.of(name, 'sends');
    const handled = graph.of(name, 'handles');

    // A service lives with the events it produces, or failing that the first
    // it consumes, then the domain it says it is in, then its commands'.
    // EventCatalog links it to resources in other domains by id. Nothing
    // placing it, it stays out of every domain, as EventCatalog allows.
    const home =
      produces[0]?.domain ??
      consumes[0]?.domain ??
      declared?.attributes.domains[0] ??
      [...sent, ...handled][0]?.ref.namespace;

    const dir = home ? path.join('domains', home, 'services', name) : path.join('services', name);

    if (home) servicesByDomain.set(home, [...(servicesByDomain.get(home) ?? []), name]);

    const system = systemAttribute.parse(declared?.attributes.system);

    if (system) {
      const grouped = systems.get(system.id) ?? { ...system, home, services: [] };
      grouped.services.push(name);
      systems.set(system.id, grouped);
    }

    const role = [
      produces.length ? `Produces ${produces.length} event(s).` : '',
      consumes.length ? `Consumes ${consumes.length} event(s).` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const commandPointer = (command: CatalogResource) => ({
      id: command.ref.id,
      version: command.ref.version ?? '1.0.0',
    });

    const dataStorePointers = (type: 'reads' | 'writes') =>
      graph.of(name, type).map((store) => ({ id: dataStoreId(store.ref), version: '1.0.0' }));

    // The graph is another repository's file: its repository is checked, not trusted.
    const repository = webAddress.safeParse(declared?.attributes.repository).data;
    const writesTo = dataStorePointers('writes');
    const readsFrom = dataStorePointers('reads');

    await own([dir, 'index.mdx']);
    await sdk.writeService(
      {
        id: name,
        name,
        version: '1.0.0',
        summary: declared?.summary ?? role,
        markdown: `${role} ${SERVICE_SIGNATURE}`.trimStart(),
        sends: [
          ...produces.map((event) => ({ ...pointer(event), ...travel('to', event.id) })),
          ...sent.map(commandPointer),
        ],
        // What the service reads of each event, where it said, is EventCatalog's `fields`.
        receives: [
          ...consumes.map((event) => {
            const fields = consumerFieldsOf.get(event.id)?.[name];

            return { ...pointer(event), ...(fields && { fields }), ...travel('from', event.id) };
          }),
          ...handled.map(commandPointer),
        ],
        ...(writesTo.length > 0 && { writesTo }),
        ...(readsFrom.length > 0 && { readsFrom }),
        ...(declared?.owner && { owners: [slug(declared.owner.team)] }),
        ...(repository && { repository: { url: repository } }),
        [MARKER]: { managed: true },
      },
      // Paths resolve from the SDK's own services/ folder.
      { path: path.join('..', dir), override: true },
    );
    servicesWritten += 1;
    pointers.services[name] = { id: name, version: '1.0.0' };
  }

  for (const [id, { name, home, services }] of systems) {
    if (foreign('system', id, Boolean(await sdk.getSystem(id)))) continue;

    const dir = home ? path.join('domains', home, 'systems', id) : path.join('systems', id);

    await own([dir, 'index.mdx']);
    await sdk.writeSystem(
      {
        id,
        name: name ?? id,
        version: '1.0.0',
        markdown: '',
        services: services.map((service) => ({ id: service, version: '1.0.0' })),
        [MARKER]: { managed: true },
      },
      // Paths resolve from the SDK's own systems/ folder.
      { path: path.join('..', dir), override: true },
    );
  }

  let domainsWritten = 0;

  for (const domain of domains) {
    // A hand-written domain keeps its own page; autocatalog's events and
    // services still sit inside it, and the report says to list them there.
    if (foreign('domain', domain, Boolean(await sdk.getDomain(domain)))) {
      continue;
    }

    await own(['domains', domain, 'index.mdx']);
    await sdk.writeDomain(
      {
        id: domain,
        name: domain,
        version: '1.0.0',
        summary: `Events in the ${domain} domain, published by autocatalog.`,
        markdown: '',
        services: (servicesByDomain.get(domain) ?? []).map((id) => ({ id, version: '1.0.0' })),
        [MARKER]: { managed: true },
      },
      { override: true },
    );
    domainsWritten += 1;
    pointers.domains[domain] = { id: domain, version: '1.0.0' };
  }

  const rewritten = new Set(written.map((file) => path.join(catalogDir, file)));

  // Back where `stamp` puts it on a page without a <Footer />, so re-stamping changes nothing.
  for (const [file, block] of stamps) {
    if (!rewritten.has(file)) continue;
    const page = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, `${page.trimEnd()}\n\n${block}\n`);
  }

  for (const file of previous.unproven.filter((file) => !rewritten.has(file))) {
    skipped.push(
      `${path.relative(catalogDir, file).split(path.sep).join('/')} may be from an earlier export, but nothing shows autocatalog wrote it; left in place`,
    );
  }

  return {
    domains: domainsWritten,
    services: servicesWritten,
    events: exported.size,
    versions: events.filter((event) => exported.has(event.frontmatter.id)).length,
    teams: teamsWritten,
    commands: commandsWritten,
    dataStores: dataStoresWritten,
    skipped,
    written: pointers,
  };
}

/** EventCatalog's own configuration, handed to every generator. Unused here. */
interface EventCatalogConfig {
  title?: string;
  organizationName?: string;
}

export interface AutocatalogGeneratorOptions {
  /** Repositories to scan the way `ac scan` does, relative to the EventCatalog project. */
  repositories?: string[];
  /** Run the adapters installed in each repository, such as Zod, which evaluate its code. */
  allowCodeExecution?: boolean;
  /** Published `events/` roots, scanned and committed beforehand. */
  roots?: string[];
  narrative?: boolean;
}

/**
 * The same export as an EventCatalog generator, so an existing EventCatalog
 * project adds one line to eventcatalog.config.js:
 *
 *   generators: [['autocatalog-cli/eventcatalog', { repositories: ['../payments-service'] }]]
 *
 * EventCatalog logs a generator's error and builds anyway, so a failure also
 * sets the exit code: CI fails instead of publishing a catalog missing events.
 */
export default async function autocatalogGenerator(
  _config: EventCatalogConfig,
  options: AutocatalogGeneratorOptions,
): Promise<void> {
  try {
    await generate(options);
  } catch (error) {
    process.exitCode = 1;

    throw error;
  }
}

async function generate(options: AutocatalogGeneratorOptions): Promise<void> {
  const catalogDir = process.env.PROJECT_DIR || process.cwd();
  const repositories = (options.repositories ?? []).map((repo) => path.resolve(catalogDir, repo));
  const roots = (options.roots ?? []).map((root) => path.resolve(catalogDir, root));

  if (repositories.length === 0 && roots.length === 0) {
    throw new Error('autocatalog: name the repositories to scan, or the published events roots');
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-generator-'));

  try {
    const { runScan } = await import('./commands/scan');
    const scanned: EventCatalogSource[] = [];

    for (const [i, repository] of repositories.entries()) {
      const out = path.join(work, String(i), 'events');

      const code = await runScan({
        root: repository,
        out,
        quiet: true,
        allowCodeExecution: options.allowCodeExecution,
      }).catch((error: Error) => {
        if (
          error instanceof AdapterExecutionError &&
          error.code === 'code_execution_consent_required'
        ) {
          throw new Error(
            `autocatalog: ${repository} installs adapters that run its code (${error.packages.join(', ')}); set allowCodeExecution: true only for a repository you trust`,
            { cause: error },
          );
        }

        throw error;
      });

      if (code !== 0) throw new Error(`autocatalog: could not scan ${repository}`);

      scanned.push({
        name: repository,
        events: (await loadCatalogSnapshot(out)).events,
        graph: await readResourceGraph(repository),
      });
    }

    const result = await exportToEventCatalog({
      catalogs: [...scanned, ...(await loadEventCatalogSources(roots))],
      catalogDir,
      narrative: options.narrative,
    });

    console.log(
      `autocatalog: ${result.events} event(s) in ${result.versions} version(s), ${result.commands} command(s) and queries, ${result.services} service(s) and ${result.dataStores} data store(s) across ${result.domains} domain(s)`,
    );

    for (const reason of result.skipped) console.warn(`autocatalog: ${reason}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
