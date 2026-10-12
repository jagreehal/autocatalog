import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import {
  architectureResource,
  architectureService,
  assertPathSegment,
  CLASSIFICATION_VALUES,
  commandManifest,
  emptyResourceGraph,
  eventFrontmatter,
  exampleCaseOf,
  isRealFileInside,
  isExamplePayload,
  jsonValueSchema,
  parseFrontmatter,
  pascalCase,
  publishCatalog,
  readContractFile,
  resourceKey,
  parseResourceGraph,
  saveResourceImport,
  type CatalogResource,
  type AdapterEvent,
  type AdapterEventMeta,
} from 'autocatalog-core';
import { z } from 'zod';
import { CLASSIFICATION_BADGE_PREFIX, EVENTCATALOG_NAMESPACE, webAddress } from '../eventcatalog';

export interface RunFromEventCatalogOptions {
  source: string; // EventCatalog project root
  out: string; // events output directory
  /** The project commands/ and .autocatalog/ go into; by default, the folder holding `out`. */
  cwd?: string;
  quiet?: boolean;
  /** Exit non-zero if anything was skipped. For a migration running in CI. */
  strict?: boolean;
}

type Badge = NonNullable<AdapterEventMeta['badges']>[number];

type Transport = NonNullable<AdapterEventMeta['transport']>[number];

type AdapterEventGuarantee = NonNullable<AdapterEventMeta['delivery']>['guarantee'];

/**
 * An event's examples: every JSON file under its examples/ folder, with the
 * case its folder names. Other formats are EventCatalog prose, not payloads.
 */
async function readExamples(
  root: string,
  folder: string,
  warnings: string[],
): Promise<AdapterEvent['examples']> {
  const dir = path.join(folder, 'examples');
  const files = await fs.readdir(dir, { recursive: true }).catch(() => []);

  const examples: AdapterEvent['examples'] = [];

  for (const file of files.filter(isExamplePayload).sort()) {
    const relative = file.split(path.sep).join('/');

    if (!isRealFileInside(root, path.join(dir, file))) {
      warnings.push(`${path.join(dir, file)}: a link to outside the catalog, not read`);
      continue;
    }

    try {
      const data = jsonValueSchema.parse(
        JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')),
      );

      const exampleCase = exampleCaseOf(relative);

      examples.push({
        name: path.basename(file, '.json'),
        data,
        ...(exampleCase && { case: exampleCase }),
      });
    } catch (error) {
      warnings.push(
        `${path.join(dir, file)}: not a JSON example (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return examples;
}

/** Keep the items of a list that match `item`; anything that is not a list is empty. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((entry) => {
        const parsed = item.safeParse(entry);

        return parsed.success ? [parsed.data] : [];
      }),
    );

/** A field EventCatalog documents as a string; any other value counts as absent. */
const text = z.string().optional().catch(undefined);

const badge = z
  .object({ content: z.string(), backgroundColor: text, textColor: text })
  .transform(({ content, backgroundColor, textColor }) => {
    const out: Badge = { content };

    if (backgroundColor !== undefined) out.backgroundColor = backgroundColor;

    if (textColor !== undefined) out.textColor = textColor;

    return out;
  });

const deliveryMode = z.enum(['push', 'pull', 'push-pull']).optional().catch(undefined);

// The channels a message travels on, from an event or a service's sends/receives.
const channelRefs = listOf(z.object({ id: z.string(), delivery_mode: deliveryMode }));

// A service's sends/receives entry: a bare id, or `{ id, version, fields, to | from }`.
const sendReceiveRef = z.union([
  z.string().transform((id) => ({ id, fields: undefined, channels: [] })),
  z
    .object({
      id: z.string(),
      fields: z.array(z.string()).optional().catch(undefined),
      to: channelRefs,
      from: channelRefs,
    })
    .transform(({ id, fields, to, from }) => ({ id, fields, channels: [...to, ...from] })),
]);

/**
 * Delivery as ac to-eventcatalog kept it, else the guarantee the event's
 * channels make. A kept value that is not a delivery promise is said, not used.
 */
function delivery(
  where: string,
  fm: { 'x-autocatalog'?: { delivery?: unknown } | undefined },
  guarantee: AdapterEventGuarantee | undefined,
  warnings: string[],
): Pick<AdapterEventMeta, 'delivery'> {
  const kept = fm['x-autocatalog']?.delivery;

  if (kept !== undefined) {
    const parsed = eventFrontmatter.shape.delivery.safeParse(kept);

    if (parsed.success) return { delivery: parsed.data };

    warnings.push(`${where}: x-autocatalog.delivery ignored: ${z.prettifyError(parsed.error)}`);
  }

  return guarantee ? { delivery: { guarantee } } : {};
}

/**
 * The EventCatalog frontmatter this importer reads. Lenient by design: a
 * malformed field is dropped rather than failing the document, because a
 * migration should carry over everything it can.
 */
const ecFrontmatter = z.object({
  id: text,
  name: text,
  // Anything truthy is a version; YAML hands back `1.0` as a number.
  version: z
    .unknown()
    .optional()
    .transform((v) => (v ? String(v) : undefined)),
  summary: text,
  domain: text,
  schemaPath: text,
  deprecated: z.unknown().optional().transform(Boolean),
  // A team or user id, or `{ id, collection }` as EventCatalog's references write it.
  owners: listOf(z.union([z.string(), z.object({ id: z.string() }).transform(({ id }) => id)])),
  tags: listOf(z.string()),
  badges: listOf(badge),
  sends: listOf(sendReceiveRef),
  receives: listOf(sendReceiveRef),
  channels: channelRefs,
  // A service's datastores, and a domain's services, as `{ id, version? }` pointers.
  writesTo: listOf(z.object({ id: z.string() })),
  readsFrom: listOf(z.object({ id: z.string() })),
  services: listOf(z.object({ id: z.string() })),
  technology: text,
  container_type: text,
  // Only a web address is a link a reader can follow; a git remote is not.
  repository: z
    .object({
      url: webAddress.optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  address: text,
  protocols: listOf(z.string()),
  deliveryGuarantee: z
    .enum(['at-most-once', 'at-least-once', 'exactly-once'])
    .optional()
    .catch(undefined),
  // What ac to-eventcatalog keeps that EventCatalog has no field for. Passed on
  // as written: the catalog's own validation names the event if it is wrong.
  'x-autocatalog': z
    .object({
      delivery: z.unknown().optional(),
      // Set on every page ac to-eventcatalog writes.
      managed: z.boolean().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

type EcFrontmatter = z.infer<typeof ecFrontmatter>;

interface EcEvent {
  folder: string; // absolute path to the EventCatalog event folder
  id: string;
  version: string;
  fm: EcFrontmatter;
  body: string;
  isVersioned: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);

    return true;
  } catch {
    return false;
  }
}

async function readIndexMd(
  root: string,
  dir: string,
  skipped: string[],
): Promise<{ fm: EcFrontmatter; body: string } | null> {
  for (const name of ['index.mdx', 'index.md']) {
    const p = path.join(dir, name);

    if (await fileExists(p)) {
      // A catalog from elsewhere must not copy this machine's files into ours.
      if (!isRealFileInside(root, p)) {
        skipped.push(`${p}: a link to outside the catalog, not read`);

        return null;
      }

      try {
        const parsed = parseFrontmatter(await fs.readFile(p, 'utf8'));

        return { fm: ecFrontmatter.parse(parsed.data), body: parsed.content };
      } catch (error) {
        // Unparseable frontmatter in one document is a fact about that
        // document, not a reason to abandon the migration.
        skipped.push(`${p}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);

        return null;
      }
    }
  }

  return null;
}

// dist/ is EventCatalog's build output and federated/ holds copies pulled from
// other catalogs; walking either would import every event twice.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'federated']);

async function walkDirs(root: string, out: string[]): Promise<void> {
  let entries;

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    out.push(full);
    await walkDirs(full, out);
  }
}

// The line ac to-eventcatalog opens an event page with: see provenanceLine.
const EXPORTED_PROVENANCE =
  /^Defined in .* Published by \[autocatalog\]\(https:\/\/github\.com\/jagreehal\/autocatalog\)\.(\n+|$)/;

/** The domain a resource is filed under: domains/<Domain>/... */
function folderDomain(folder: string): string | undefined {
  const parts = folder.split(path.sep);
  const at = parts.lastIndexOf('domains');

  return at >= 0 ? parts[at + 1]?.toLowerCase() : undefined;
}

/** A message's domain: declared, else its folder's, else its id's prefix. */
function domainOf(folder: string, fm: EcFrontmatter, id: string): string {
  return (fm.domain ?? folderDomain(folder) ?? id.split('.')[0] ?? id).toLowerCase();
}

// Datastores holding documents rather than rows, by the technology EventCatalog names.
const DOCUMENT_STORES = /mongo|dynamo|firestore|cosmos|couch|document/i;

type Owner = NonNullable<CatalogResource['owner']>;

/** An import record, as saveResourceImport writes it; its graph is checked by parseResourceGraph. */
const importRecordGraph = z.object({ graph: jsonValueSchema });

/** A team or person page: who they are, and how to reach them. */
const ownerPage = z.object({
  id: z.string().min(1),
  name: text,
  // Only a web address is a link a reader can follow.
  slackDirectMessageUrl: webAddress.optional().catch(undefined),
  msTeamsDirectMessageUrl: webAddress.optional().catch(undefined),
  email: z.email().optional().catch(undefined),
});

/** EventCatalog's teams and users, by id, as owners. */
async function readOwners(
  root: string,
  skipped: string[],
): Promise<Map<string, { owner: Owner; collection: string }>> {
  const owners = new Map<string, { owner: Owner; collection: string }>();

  for (const collection of ['teams', 'users']) {
    const files = await fs.readdir(path.join(root, collection)).catch(() => []);

    for (const file of files.filter((name) => /\.mdx?$/.test(name)).sort()) {
      const p = path.join(root, collection, file);

      if (!isRealFileInside(root, p)) {
        skipped.push(`${p}: a link to outside the catalog, not read`);
        continue;
      }

      const page = ownerPage.safeParse(
        await fs
          .readFile(p, 'utf8')
          .then((body) => parseFrontmatter(body).data)
          .catch(() => undefined),
      );

      if (!page.success) {
        skipped.push(`${p}: not a ${collection === 'teams' ? 'team' : 'user'} page`);
        continue;
      }

      const { id, name, slackDirectMessageUrl, msTeamsDirectMessageUrl, email } = page.data;

      const contact =
        slackDirectMessageUrl ?? msTeamsDirectMessageUrl ?? (email && `mailto:${email}`);

      if (!owners.has(id))
        owners.set(id, {
          owner: { team: id, ...(name && { name }), ...(contact && { contact }) },
          collection,
        });
    }
  }

  return owners;
}

/** What a resource declared in EventCatalog says about itself. */
function declared(
  fm: EcFrontmatter,
  ownerOf: (fm: EcFrontmatter) => Owner | undefined,
): Pick<CatalogResource, 'tags' | 'provenance' | 'needsReview'> &
  Partial<Pick<CatalogResource, 'title' | 'summary' | 'owner'>> {
  const owner = ownerOf(fm);

  return {
    ...(fm.name && { title: fm.name }),
    ...(fm.summary?.trim() && { summary: fm.summary.trim() }),
    ...(owner && { owner }),
    tags: fm.tags,
    provenance: { default: 'declared', fields: {} },
    needsReview: false,
  };
}

type Contract =
  { schema: AdapterEvent['schema']; note: string; placeholder: boolean } | { skip: string };

/**
 * The file a message declares in schemaPath, else a co-located schema.json,
 * translated from Avro, protobuf or YAML when that is what it is. A declared
 * contract that cannot be read is a skip with a reason; the placeholder is
 * only for a message that declares no contract at all.
 */
async function contractOf(
  root: string,
  folder: string,
  fm: EcFrontmatter,
  name: string,
): Promise<Contract> {
  const declared = fm.schemaPath;
  const schemaFile = path.resolve(folder, declared ?? 'schema.json');

  if (!schemaFile.startsWith(root + path.sep))
    return { skip: `schemaPath ${declared} points outside the catalog` };

  if (!declared && !(await fileExists(schemaFile)))
    return {
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        description: 'Placeholder — the EventCatalog source declared no schema.',
      },
      note: ' (placeholder schema)',
      placeholder: true,
    };

  // A catalog from elsewhere must not copy this machine's files into ours.
  if ((await fileExists(schemaFile)) && !isRealFileInside(root, schemaFile))
    return { skip: 'its schema is a link to outside the catalog' };

  const contract = await readContractFile(schemaFile, name);

  if (!contract.ok) return { skip: contract.reason };

  return {
    schema: contract.schema,
    note: contract.format === 'json-schema' ? '' : ` (translated from ${contract.format})`,
    placeholder: false,
  };
}

/**
 * Import an EventCatalog markdown catalog. Frontmatter becomes a manifest
 * with provenance "declared"; the markdown body is preserved as narrative.
 * Producers/consumers are reconstructed by inverting each service's
 * sends/receives lists.
 */
export async function runFromEventCatalog(opts: RunFromEventCatalogOptions): Promise<number> {
  const root = path.resolve(opts.source);
  const outRoot = path.resolve(opts.out);

  // Checked before walking, because walkDirs swallows the error and the user
  // would be told their catalog is empty when they simply mistyped the path.
  try {
    if (!(await fs.stat(root)).isDirectory()) {
      console.error(kleur.red(`✗ ${root} is not a directory — pass the EventCatalog project root`));

      return 1;
    }
  } catch {
    console.error(kleur.red(`✗ no such directory: ${root}`));

    return 1;
  }

  const dirs: string[] = [root];
  await walkDirs(root, dirs);

  // Every reason a document did not make it, reported at the end rather than
  // thrown: a migration that dies on file 300 of 400 helps nobody.
  const skipped: string[] = [];

  let commandUnreadable = false;

  let graphUnreadable = false;
  const events: EcEvent[] = [];
  const leftBehind = new Map<string, number>();

  const commands: Array<{
    folder: string;
    id: string;
    version: string;
    fm: EcFrontmatter;
    query: boolean;
  }> = [];

  const producersByEvent = new Map<string, Set<string>>();
  const consumersByEvent = new Map<string, Set<string>>();
  // What each consumer says it reads, as EventCatalog's `receives[].fields`.
  const consumerFieldsByEvent = new Map<string, Record<string, string[]>>();

  // Channels by id, and the channels each event is said to travel on.
  const channels = new Map<
    string,
    { address?: string; protocols: string[]; guarantee?: AdapterEventGuarantee }
  >();

  const channelsByEvent = new Map<string, Map<string, Transport['deliveryMode']>>();

  // Services and the datastores they use, for the resource graph.
  const services: Array<{ folder: string; id: string; fm: EcFrontmatter }> = [];
  const systems: Array<{ folder: string; id: string; fm: EcFrontmatter }> = [];
  const containers = new Map<string, EcFrontmatter>();
  const domainByService = new Map<string, string>();

  const onChannels = (eventId: string, refs: Array<z.infer<typeof channelRefs>[number]>) => {
    const byChannel = channelsByEvent.get(eventId) ?? new Map();

    for (const ref of refs) byChannel.set(ref.id, ref.delivery_mode ?? byChannel.get(ref.id));
    channelsByEvent.set(eventId, byChannel);
  };

  for (const dir of dirs) {
    const parts = dir.split(path.sep);
    const parent = parts[parts.length - 2];

    // A resource's type is the collection folder that owns it: events/<Name>/,
    // or events/<Name>/versioned/<v>/ for its history. Services, domains,
    // commands, queries and flows keep their own history the same way, and
    // none of it is event history.
    const isVersioned = parent === 'versioned';
    const collection = isVersioned ? parts[parts.length - 4] : parent;
    const inEvents = collection === 'events';
    const inServices = !isVersioned && parent === 'services';
    const inChannels = !isVersioned && parent === 'channels';
    const inCommands = parent === 'commands' || parent === 'queries';

    const before = skipped.length;

    const doc = await readIndexMd(root, dir, skipped);

    // Which command an unreadable page held is unknown, so none is dropped.
    if (!doc && inCommands && skipped.length > before) commandUnreadable = true;

    if (!doc && (inServices || parent === 'containers') && skipped.length > before)
      graphUnreadable = true;

    if (!doc) continue;

    const { id, version } = doc.fm;

    if (parent === 'containers' && id !== undefined) {
      containers.set(id, doc.fm);
      continue;
    }

    // A domain that lists its services files them, wherever their folders are.
    if (parent === 'domains' || parent === 'subdomains') {
      for (const ref of doc.fm.services)
        domainByService.set(ref.id, path.basename(dir).toLowerCase());
      continue;
    }

    if (inServices && id !== undefined) {
      const serviceName = doc.fm.name ?? id;
      services.push({ folder: dir, id, fm: doc.fm });

      for (const ref of doc.fm.sends) {
        producersByEvent.set(ref.id, (producersByEvent.get(ref.id) ?? new Set()).add(serviceName));
        onChannels(ref.id, ref.channels);
      }

      for (const ref of doc.fm.receives) {
        consumersByEvent.set(ref.id, (consumersByEvent.get(ref.id) ?? new Set()).add(serviceName));
        onChannels(ref.id, ref.channels);

        if (ref.fields) {
          consumerFieldsByEvent.set(ref.id, {
            ...consumerFieldsByEvent.get(ref.id),
            [serviceName]: ref.fields,
          });
        }
      }

      continue;
    }

    if (inChannels && id !== undefined) {
      channels.set(id, {
        address: doc.fm.address,
        protocols: doc.fm.protocols,
        guarantee: doc.fm.deliveryGuarantee,
      });
      continue;
    }

    if (inCommands && id !== undefined && version !== undefined) {
      onChannels(id, doc.fm.channels);
      commands.push({ folder: dir, id, version, fm: doc.fm, query: parent === 'queries' });
      continue;
    }

    if (inEvents && id !== undefined && version !== undefined) {
      if (!isVersioned) onChannels(id, doc.fm.channels);
      events.push({ folder: dir, id, version, fm: doc.fm, body: doc.body, isVersioned });
      continue;
    }

    // A system groups the services it lists, and those filed inside it.
    if (parent === 'systems' && id !== undefined) {
      systems.push({ folder: dir, id, fm: doc.fm });
      continue;
    }

    // Entities, flows and the rest have no autocatalog counterpart.
    // Their history goes with them, so only the current documents are counted.
    if (!isVersioned && parent !== undefined && id !== undefined)
      leftBehind.set(parent, (leftBehind.get(parent) ?? 0) + 1);
  }

  // Teams and people are single files, not folders. Each comes across as the
  // name and contact of what it owns.
  const owners = await readOwners(root, skipped);
  const owning = new Set<string>();

  const ownerOf = (fm: EcFrontmatter): Owner | undefined => {
    const [id] = fm.owners;

    if (id === undefined) return undefined;
    owning.add(id);

    return owners.get(id)?.owner ?? { team: id };
  };

  // A channel the catalog names but never defines is still where the event
  // goes, so its id stands in for the address rather than losing it.
  const transportOf = (eventId: string): Transport[] | undefined => {
    const byChannel = [...(channelsByEvent.get(eventId) ?? [])];

    if (byChannel.length === 0) return undefined;

    return byChannel.map(([channelId, mode]) => ({
      address: channels.get(channelId)?.address ?? channelId,
      protocols: channels.get(channelId)?.protocols ?? [],
      ...(mode && { deliveryMode: mode }),
    }));
  };

  // The guarantee an event's channels make, when they all make the same one.
  const guaranteeOf = (eventId: string): AdapterEventGuarantee | undefined => {
    const guarantees = new Set(
      [...(channelsByEvent.get(eventId)?.keys() ?? [])].map((id) => channels.get(id)?.guarantee),
    );

    const [guarantee] = guarantees.size === 1 ? guarantees : [];

    return guarantee;
  };

  let written = 0;
  const warnings: string[] = [];
  // Reasons an event was dropped, kept apart from `warnings`, which are things
  // that were imported with a caveat.
  const currentEvents: AdapterEvent[] = [];
  const history: Array<{ event: AdapterEvent; parentFolderName: string }> = [];

  const narratives: Array<{
    domain: string;
    folderName: string;
    version?: string;
    body: string;
  }> = [];

  for (const evt of events) {
    const { id, version } = evt;
    const name = evt.fm.name ?? pascalCase(id);
    const summary = evt.fm.summary?.trim() ? evt.fm.summary : `Imported from EventCatalog.`;

    const domain = domainOf(evt.folder, evt.fm, id);

    // The classification badge `ac to-eventcatalog` writes becomes the field again.
    const classification = CLASSIFICATION_VALUES.find((value) =>
      evt.fm.badges.some((b) => b.content === CLASSIFICATION_BADGE_PREFIX + value),
    );

    const badges = evt.fm.badges.filter(
      (b) => b.content !== `${CLASSIFICATION_BADGE_PREFIX}${classification}`,
    );

    const folderName = pascalCase(id);
    const contract = await contractOf(root, evt.folder, evt.fm, name);

    if ('skip' in contract) {
      skipped.push(`${domain}/${id}@${version}: ${contract.skip}`);
      continue;
    }

    const { schema, note: schemaNote } = contract;

    if (contract.placeholder)
      warnings.push(`${domain}/${id}@${version}: no schema declared — wrote a placeholder`);

    const event: AdapterEvent = {
      id,
      version,
      name,
      summary,
      domain,
      folderName,
      schema,
      examples: await readExamples(root, evt.folder, warnings),
      meta: {
        status: evt.fm.deprecated ? 'deprecated' : 'active',
        producers: [...(producersByEvent.get(id) ?? [])].sort(),
        consumers: [...(consumersByEvent.get(id) ?? [])].sort(),
        consumerFields: consumerFieldsByEvent.get(id),
        transport: transportOf(id),
        tags: evt.fm.tags,
        badges,
        classification,
        owner: ownerOf(evt.fm),
        ...delivery(`${domain}/${id}@${version}`, evt.fm, guaranteeOf(id), warnings),
      },
      provenance: { default: 'declared', fields: {} },
    };

    if (evt.isVersioned) history.push({ event, parentFolderName: folderName });
    else currentEvents.push(event);

    // A page the export wrote carries its provenance line and schema viewer
    // around the narrative; they are the export's, and it adds them again.
    const body = evt.fm['x-autocatalog']?.managed
      ? evt.body
          .trim()
          .replace(EXPORTED_PROVENANCE, '')
          .replace(/(^|\n+)<SchemaViewer file="schema\.json" \/>$/, '')
      : evt.body;

    if (body.trim()) {
      const narrative: (typeof narratives)[number] = {
        domain,
        folderName,
        body: `${body.replace(/^\n+/, '').trimEnd()}\n`,
      };

      if (evt.isVersioned) narrative.version = version;
      narratives.push(narrative);
    }

    written++;

    if (!opts.quiet) {
      console.log(`${kleur.green('✓')} ${domain}/${id}@${version}${schemaNote}`);
    }
  }

  if (written > 0) {
    try {
      await publishCatalog({
        outRoot,
        events: currentEvents,
        history,
        historyOwnership: 'replace',
        narratives,
      });
    } catch (error) {
      console.error(
        kleur.red(
          `✗ could not write the catalog: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );

      return 1;
    }
  }

  // Commands and queries, where ac scan reads them: commands/<domain>/<Name>/.
  const project = opts.cwd ?? path.dirname(opts.out);
  const projectRoot = path.resolve(project);
  // commands/eventcatalog/ is this import's alone: replaced whole, so a command
  // the catalog no longer has goes with it, and commands beside it are kept.
  // The new set is staged under .autocatalog/, which no scan reads, and only
  // replaces the old one once the import has succeeded.
  const commandsDir = path.join(project, 'commands', 'eventcatalog');
  await fs.mkdir(path.join(projectRoot, '.autocatalog'), { recursive: true });
  const staging = await fs.mkdtemp(path.join(projectRoot, '.autocatalog', 'staging-'));
  let commandsWritten = 0;

  let commandsKept = 0;

  for (const cmd of commands) {
    const { id, version, fm } = cmd;
    const domain = domainOf(cmd.folder, fm, id);
    const where = `${domain}/${id}@${version}`;
    const name = fm.name ?? id;
    const folderName = pascalCase(id);

    try {
      assertPathSegment(where, 'domain', domain);
      assertPathSegment(where, 'id', folderName);
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    // A command that fails to import this time keeps the version it had: a
    // skip is said, and is never a deletion.
    const skip = async (reason: string) => {
      const previous = path.resolve(commandsDir, domain, folderName);

      const kept = await fs
        .cp(previous, path.join(staging, domain, folderName), { recursive: true })
        .then(
          () => true,
          () => false,
        );

      skipped.push(`${where}: ${reason}${kept ? '; kept the version imported before' : ''}`);

      if (kept) commandsKept++;
    };

    const contract = await contractOf(root, cmd.folder, fm, name);

    if ('skip' in contract) {
      await skip(contract.skip);
      continue;
    }

    if (contract.placeholder) warnings.push(`${where}: no schema declared — wrote a placeholder`);

    const receivers = [...(consumersByEvent.get(id) ?? [])].sort();

    if (receivers.length > 1)
      warnings.push(
        `${where}: ${receivers.join(', ')} receive it; a command has one handler, so none is set`,
      );

    const [handler] = receivers.length === 1 ? receivers : [];

    const manifest = commandManifest.safeParse({
      kind: 'command',
      id,
      version,
      name,
      summary: fm.summary?.trim() ? fm.summary : 'Imported from EventCatalog.',
      domain,
      ...(ownerOf(fm) && { owner: ownerOf(fm) }),
      senders: [...(producersByEvent.get(id) ?? [])].sort(),
      ...(handler && { handler }),
      // A query answers; what a command leads to, EventCatalog does not say.
      ...(cmd.query && { outcome: { type: 'result' } }),
      transport: (transportOf(id) ?? []).map(({ address, protocols }) => ({ address, protocols })),
      tags: cmd.query ? [...fm.tags, 'query'] : fm.tags,
    });

    if (!manifest.success) {
      await skip(z.prettifyError(manifest.error));
      continue;
    }

    const target = path.join(staging, domain, folderName);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(
      path.join(target, 'autocatalog.json'),
      `${JSON.stringify(manifest.data, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(target, 'schema.json'),
      `${JSON.stringify(contract.schema, null, 2)}\n`,
    );
    commandsWritten++;

    if (!opts.quiet)
      console.log(
        `${kleur.green('✓')} ${where} (${cmd.query ? 'query' : 'command'})${contract.note}`,
      );
  }

  // A command page that could not be read may be any command imported before,
  // so each of those this import did not write again is kept.
  if (commandUnreadable)
    for (const folder of await fs
      .readdir(path.resolve(commandsDir), { recursive: true })
      .catch(() => []))
      if (path.basename(folder) === 'autocatalog.json') {
        const command = path.dirname(folder);

        if (!(await fileExists(path.join(staging, command)))) {
          await fs.cp(path.resolve(commandsDir, command), path.join(staging, command), {
            recursive: true,
          });
          commandsKept++;
          warnings.push(`${command}: a command page could not be read; kept as imported before`);
        }
      }

  // Services, the datastores they read and write, and who owns each: an
  // import ac scan applies, so drift sees one team reaching into another's data.
  const graph = emptyResourceGraph();

  const containerRef = (id: string) => ({
    kind: DOCUMENT_STORES.test(containers.get(id)?.technology ?? '')
      ? ('collection' as const)
      : ('table' as const),
    namespace: EVENTCATALOG_NAMESPACE,
    id,
  });

  for (const [id, fm] of containers)
    graph.resources.push({
      ...architectureResource(containerRef(id), {
        ...(fm.technology && { technology: fm.technology }),
        ...(fm.container_type && { containerType: fm.container_type }),
      }),
      ...declared(fm, ownerOf),
    });

  // Events name a service by its name, so two services sharing one are one
  // service here: the first keeps its details, and both keep their access.
  const serviceIds = new Map<string, string>();
  const edges = new Set<string>();

  const grouping = new Set<string>();

  for (const service of services) {
    const name = service.fm.name ?? service.id;
    const domain = folderDomain(service.folder) ?? domainByService.get(service.id);
    const first = serviceIds.get(name);

    const system = systems.find(
      ({ folder, fm }) =>
        service.folder.startsWith(folder + path.sep) ||
        fm.services.some((ref) => ref.id === service.id),
    );

    if (system) grouping.add(system.id);

    if (first === undefined) {
      serviceIds.set(name, service.id);
      graph.resources.push({
        ...architectureService(name),
        ...declared(service.fm, ownerOf),
        title: name,
        attributes: {
          domains: domain ? [domain] : [],
          ...(service.fm.repository?.url && { repository: service.fm.repository.url }),
          ...(system && {
            system: { id: system.id, ...(system.fm.name && { name: system.fm.name }) },
          }),
        },
      });
    } else
      warnings.push(
        `${[first, service.id].sort().join(' and ')} are both named ${name}; autocatalog has them as one service`,
      );

    for (const [type, refs] of [
      ['writes', service.fm.writesTo],
      ['reads', service.fm.readsFrom],
    ] as const)
      for (const ref of refs) {
        // A datastore the catalog names but never describes is still one it uses.
        if (!containers.has(ref.id)) {
          containers.set(ref.id, ecFrontmatter.parse({}));
          graph.resources.push(architectureResource(containerRef(ref.id)));
        }

        if (edges.has(`${name} ${type} ${ref.id}`)) continue;
        edges.add(`${name} ${type} ${ref.id}`);

        graph.relationships.push({
          type,
          from: { kind: 'service', id: name },
          to: containerRef(ref.id),
          provenance: 'declared',
          needsReview: false,
        });
      }
  }

  const importFile = path.join(projectRoot, '.autocatalog', 'imports', 'eventcatalog.json');

  // A service or datastore page that could not be read may be any of those
  // imported before, so each this import did not write again is kept, with
  // what the kept services read and wrote.
  if (graphUnreadable) {
    const previous = await fs
      .readFile(importFile, 'utf8')
      .then((body) => parseResourceGraph(importRecordGraph.parse(JSON.parse(body)).graph))
      .catch(() => undefined);

    const present = new Set(graph.resources.map((r) => resourceKey(r.ref)));

    const kept = (previous?.resources ?? []).filter((r) => !present.has(resourceKey(r.ref)));

    const keptKeys = new Set(kept.map((r) => resourceKey(r.ref)));

    graph.resources.push(...kept);
    graph.relationships.push(
      ...(previous?.relationships ?? []).filter((edge) => keptKeys.has(resourceKey(edge.from))),
    );

    for (const r of kept)
      warnings.push(`${r.ref.kind} ${r.ref.id}: a page could not be read; kept as imported before`);
  }

  if (written === 0 && commandsWritten === 0 && graph.resources.length === 0) {
    console.error(kleur.red('✗ nothing to import'));

    for (const reason of skipped) console.error(kleur.yellow(`  ! ${reason}`));
    console.error(
      skipped.length > 0
        ? '  Every document found was skipped for the reasons above.'
        : `  No EventCatalog events found under ${root} — expected events/<Name>/index.md(x) folders with id and version frontmatter.`,
    );
    await fs.rm(staging, { recursive: true, force: true });

    return 1;
  }

  await fs.rm(path.resolve(commandsDir), { recursive: true, force: true });

  if (commandsWritten + commandsKept > 0) {
    await fs.mkdir(path.dirname(path.resolve(commandsDir)), { recursive: true });
    await fs.rename(staging, path.resolve(commandsDir));
  } else await fs.rm(staging, { recursive: true, force: true });

  // With nothing left, the last import goes, or scans would keep what it had.
  if (graph.resources.length === 0) await fs.rm(importFile, { force: true });
  else {
    // In one order whatever order the catalog listed things in, so importing
    // an unchanged catalog again changes nothing to commit.
    const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

    const edgeKey = (edge: (typeof graph.relationships)[number]) =>
      `${resourceKey(edge.from)} ${edge.type} ${resourceKey(edge.to)}`;

    graph.resources.sort((a, b) => byKey(resourceKey(a.ref), resourceKey(b.ref)));
    graph.relationships.sort((a, b) => byKey(edgeKey(a), edgeKey(b)));

    try {
      await saveResourceImport(projectRoot, 'eventcatalog', { graph, claims: [] });
    } catch (error) {
      skipped.push(
        `services and datastores: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // A skip is always said out loud, quiet or not: a document that silently
  // failed to migrate is the loss a migration must never hide.
  for (const reason of skipped) console.warn(kleur.yellow(`  ! skipped ${reason}`));

  for (const { id } of systems)
    if (!grouping.has(id)) leftBehind.set('systems', (leftBehind.get('systems') ?? 0) + 1);

  // A team or person that owns nothing has nowhere to go.
  for (const [id, { collection }] of owners)
    if (!owning.has(id)) leftBehind.set(collection, (leftBehind.get(collection) ?? 0) + 1);

  if (!opts.quiet) {
    for (const w of warnings) console.warn(kleur.yellow(`  ! ${w}`));

    if (leftBehind.size > 0)
      console.warn(
        kleur.yellow(
          `  ! Not imported: ${[...leftBehind]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([collection, count]) => `${collection} (${count})`)
            .join(', ')}`,
        ),
      );
    console.log(kleur.bold(`\n${written} event(s) imported to ${opts.out}`));

    if (commandsWritten > 0)
      console.log(kleur.bold(`${commandsWritten} command(s) and queries to ${commandsDir}`));

    if (skipped.length > 0) {
      console.log(kleur.yellow(`${skipped.length} skipped — the catalog is incomplete.`));
    }

    // An import that ends in a count leaves the user wondering whether it
    // worked. Ending on the next command answers that.
    const committed = [
      ...(written > 0 ? [opts.out] : []),
      ...(commandsWritten > 0 ? [commandsDir] : []),
      ...(graph.resources.length > 0 ? [path.join(project, '.autocatalog', 'imports')] : []),
    ];

    const last = committed.pop();

    console.log(
      kleur.dim(
        `  Commit ${[committed.join(', '), last].filter(Boolean).join(' and ')}: the catalog is defined there now, and nothing regenerates it.`,
      ),
    );
    console.log(
      kleur.dim(
        // Commands, services and datastores join the graph when it is scanned.
        commandsWritten > 0 || graph.resources.length > 0
          ? '  Next: ac validate and ac resources scan, then ac site . --dev to browse it.'
          : '  Next: ac validate, then ac site . --dev to browse it.',
      ),
    );
  }

  // A partial import is the right default for a person working through a
  // migration, and the wrong one for a pipeline that will publish the result.
  return opts.strict && skipped.length > 0 ? 1 : 0;
}
