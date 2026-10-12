import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Option, type Command } from 'commander';
import {
  scanArchitecture,
  architectureConfig,
  otlpArchitectureInput,
  datastoreOwnership,
  readResourceGraph,
  readOptionalResourceJson,
  ResourceReadError,
  RESOURCE_GRAPH_FILE,
  writeResourceGraph,
  promoteRelationship,
  relationshipKey,
  driftResources,
  emptyResourceGraph,
  importBackstageYaml,
  syncBackstageOwnership,
  backstageHttpClient,
  syncDatadogOwnership,
  datadogHttpClient,
  importConfluentRegistry,
  confluentHttpClient,
  importGlueRegistry,
  saveResourceImport,
  jsonValueSchema,
  type JsonValue,
  type OwnershipImport,
  type ResourceGraph,
  validateCommands,
  validateResourceDocuments,
  documentObservations,
  resourceSchema,
  resourceKey,
  validateCloudEvent,
  cloudEventsEnvelope,
  type CatalogResource,
  type CloudEventsEnvelope,
} from 'autocatalog-core';

/** Identities a scan applies to what it discovers; explicit ones are remembered in config.json. */
const SCAN_IDENTITIES = ['service', 'datastore', 'database', 'environment'] as const;

const CONFIG_FILE = '.autocatalog/config.json';

/** Where `ac scan --out` puts the resource graph, so a catalog artifact carries it to `ac drift`. */
export const ARTIFACT_RESOURCES_FILE = 'resources.json';

export const COMMIT_RESOURCES_ADVICE =
  'Commit .autocatalog/: ac site publishes it, and later scans keep its promotions and imported evidence.';

export interface ResourceScanFlags {
  traces?: string;
  service?: string;
  datastore?: string;
  database?: string;
  environment?: string;
}

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0];

  return issue?.path.length ? `${issue.path.join('.')}: ${issue.message}` : (issue?.message ?? '');
};

/** A JSON file named on the command line; errors name it as it was typed and never quote it. */
export async function readJsonInput<T>(
  file: string,
  schema: z.ZodType<T>,
  what: string,
): Promise<T> {
  let text: string;

  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

    throw new Error(`${file}: ${missing ? 'not found' : 'could not be read'}`, { cause: error });
  }

  let value: JsonValue;

  try {
    value = jsonValueSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) throw new Error(`${file}: not ${what} (${firstIssue(parsed.error)})`);

  return parsed.data;
}

/** The repository's resource graph, with an error that names the file and how to recover. */
export async function readGraph(root: string): Promise<ResourceGraph | undefined> {
  try {
    return await readResourceGraph(root);
  } catch (error) {
    if (!(error instanceof ResourceReadError)) throw error;

    throw new Error(`${error.message}. Delete it and run ac resources scan to regenerate it.`, {
      cause: error,
    });
  }
}

async function requireGraph(root: string): Promise<ResourceGraph> {
  const graph = await readGraph(root);

  if (!graph) throw new Error(`No resource graph in ${root}; run ac resources scan first`);

  return graph;
}

async function readConfig(root: string): Promise<z.infer<typeof architectureConfig>> {
  const fix = 'Fix it or delete the file.';
  let value: JsonValue | undefined;

  try {
    value = await readOptionalResourceJson(path.join(root, CONFIG_FILE), { root });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. ${fix}`, {
      cause: error,
    });
  }

  const parsed = architectureConfig.safeParse(value ?? {});

  if (!parsed.success) throw new Error(`${CONFIG_FILE}: ${firstIssue(parsed.error)}. ${fix}`);

  return parsed.data;
}

/**
 * Discover resources the way every command does. Configuration and the saved
 * graph are checked before anything runs, and identities given as flags are
 * saved to config.json afterwards: a later rescan without them (`ac scan`, an
 * import) would otherwise file the same resources under different identities.
 */
export async function scanResources(
  root: string,
  options: ResourceScanFlags & { outDir?: string },
) {
  const config = await readConfig(root);
  await readGraph(root);

  const traces = options.traces
    ? await readJsonInput(options.traces, otlpArchitectureInput, 'an OTLP JSON export')
    : undefined;

  const given = SCAN_IDENTITIES.filter((name) => options[name] !== undefined);

  const result = await scanArchitecture({
    root,
    outDir: options.outDir,
    publish: false,
    traces,
    ...Object.fromEntries(given.map((name) => [name, options[name]])),
  });

  if (result.errors.length) throw new Error(result.errors.join('\n'));
  const saved = given.filter((name) => options[name] !== config[name]);

  if (saved.length) {
    const next = { ...config, ...Object.fromEntries(saved.map((name) => [name, options[name]])) };
    await fs.mkdir(path.join(root, '.autocatalog'), { recursive: true });
    await fs.writeFile(path.join(root, CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`);
  }

  return {
    ...result,
    saved: saved.length
      ? `Saved ${saved.map((name) => `--${name}`).join(', ')} to ${CONFIG_FILE}; later scans use them. Commit it.`
      : undefined,
  };
}

/** Write the graph unless it is empty: a repository without resources gets no `.autocatalog/`. */
/**
 * Write the graph, or remove the one a scan wrote before once nothing is left:
 * an empty graph is never written, and a stale one would keep publishing
 * resources the repository no longer has.
 */
export async function publishResources(
  root: string,
  graph: ResourceGraph,
): Promise<'written' | 'removed' | 'none'> {
  if (graph.resources.length) {
    await writeResourceGraph(root, graph);

    return 'written';
  }

  const file = path.join(root, RESOURCE_GRAPH_FILE);

  if (!(await fs.lstat(file).catch(() => undefined))) return 'none';
  await fs.rm(file);

  return 'removed';
}

export const REMOVED_RESOURCES_ADVICE = `removed ${RESOURCE_GRAPH_FILE}: the repository no longer has resources. Commit the deletion.`;

const readable = (key: string) => {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

/** Find by exact key, or by the readable form `ac resources list` prints. */
function byKey<T>(entries: T[], keyOf: (entry: T) => string, wanted: string, what: string): T {
  const exact = entries.find((entry) => keyOf(entry) === wanted);

  if (exact) return exact;
  const matches = entries.filter((entry) => readable(keyOf(entry)) === wanted);

  if (matches.length === 1) return matches[0]!;

  if (matches.length > 1)
    throw new Error(
      `${what} ${wanted} is ambiguous; use its exact key from ac resources list --json`,
    );

  throw new Error(`Unknown ${what}: ${wanted}. Run ac resources list to see the keys.`);
}

/** The CloudEvents mode a contract declares, when it declares one. */
function envelopeMode(resource: CatalogResource): CloudEventsEnvelope['mode'] | undefined {
  const envelope = cloudEventsEnvelope.safeParse(
    'envelope' in resource.attributes ? resource.attributes.envelope : undefined,
  );

  return envelope.success ? envelope.data.mode : undefined;
}

export interface RunResourceScanOptions extends ResourceScanFlags {
  root: string;
  quiet?: boolean;
}

export async function runResourceScan(options: RunResourceScanOptions): Promise<number> {
  try {
    const root = path.resolve(options.root);
    const result = await scanResources(root, options);
    const published = await publishResources(root, result.graph);

    if (!options.quiet) {
      console.log(
        published === 'written'
          ? `Published ${result.graph.resources.length} resources and ${result.graph.relationships.length} relationships to ${RESOURCE_GRAPH_FILE}. ${COMMIT_RESOURCES_ADVICE}`
          : published === 'removed'
            ? `Found no resources; ${REMOVED_RESOURCES_ADVICE}`
            : `Found no resources; ${RESOURCE_GRAPH_FILE} was not written`,
      );

      if (result.saved) console.log(result.saved);

      for (const skipped of result.skipped) console.warn(skipped);

      for (const conflict of result.conflicts)
        console.warn(
          `Ownership conflict for ${conflict.resource.id}: selected ${conflict.selected}; alternatives ${conflict.alternatives.join(', ')}`,
        );
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

export async function runResourcePromote(options: {
  root: string;
  relationship: string;
  quiet?: boolean;
}): Promise<number> {
  try {
    const graph = await requireGraph(options.root);
    const edge = byKey(graph.relationships, relationshipKey, options.relationship, 'relationship');
    await writeResourceGraph(options.root, promoteRelationship(graph, edge));

    if (!options.quiet)
      console.log(`Declared ${readable(relationshipKey(edge))}; runtime evidence retained`);

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

/** Every key in the graph: the readable form for people, the exact one in JSON. */
export async function runResourceList(options: { root: string; json?: boolean }): Promise<number> {
  try {
    const graph = await requireGraph(options.root);

    const resources = graph.resources.map((resource) => ({
      key: resourceKey(resource.ref),
      kind: resource.ref.kind,
      provenance: resource.provenance.default,
    }));

    const relationships = graph.relationships.map((edge) => ({
      key: relationshipKey(edge),
      type: edge.type,
      provenance: edge.provenance,
    }));

    if (options.json) console.log(JSON.stringify({ resources, relationships }, null, 2));
    else {
      console.log('Resources');

      for (const entry of resources) console.log(`  ${readable(entry.key)}  ${entry.provenance}`);
      console.log('Relationships');

      for (const entry of relationships)
        console.log(`  ${readable(entry.key)}  ${entry.provenance}`);
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

export async function runResourceOwnership(options: {
  root: string;
  json?: boolean;
}): Promise<number> {
  try {
    const ownership = datastoreOwnership(await requireGraph(options.root));

    if (options.json) console.log(JSON.stringify(ownership, null, 2));
    else {
      console.log('| Datastore resource | Owner | Writers | Readers |');
      console.log('| --- | --- | --- | --- |');
      const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll(/[\r\n]/g, ' ');

      for (const row of ownership)
        console.log(
          `| ${cell(`${row.ref.namespace}/${row.ref.id}`)} | ${cell(row.owner ?? 'Unassigned')} | ${cell(row.writers.join(', '))} | ${cell(row.readers.join(', '))} |`,
        );
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

export async function runResourceDrift(options: {
  root: string;
  base?: string;
  quiet?: boolean;
  format?: 'text' | 'json';
  failOn?: 'breaking' | 'suspicious' | 'never';
}): Promise<number> {
  try {
    const current = await requireGraph(options.root);
    const baseline = options.base ? await requireGraph(options.base) : emptyResourceGraph();
    const findings = driftResources(baseline, current);

    if (!options.quiet) {
      if (options.format === 'json') console.log(JSON.stringify({ findings }, null, 2));
      else
        for (const finding of findings)
          console.log(
            `${finding.severity.toUpperCase()} ${finding.resource.kind}/${finding.resource.id}: ${finding.message}${finding.affectedServices.length ? `; affects ${finding.affectedServices.join(', ')}` : ''}${finding.advice ? `. ${finding.advice}` : ''}`,
          );
    }

    const failOn = options.failOn ?? 'breaking';

    return failOn !== 'never' &&
      findings.some(
        // A major version bump acknowledges a breaking change, as for events.
        (finding) =>
          (finding.severity === 'breaking' && !finding.acknowledged) ||
          (failOn === 'suspicious' && finding.severity === 'suspicious'),
      )
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

export interface ResourceImportOptions {
  provider: string;
  source?: string;
  root: string;
  id?: string;
  url?: string;
  registry?: string;
  region?: string;
  subjects?: string[];
  quiet?: boolean;
}

export async function runResourceImport(options: ResourceImportOptions): Promise<number> {
  try {
    let imported: OwnershipImport;
    // A registry subject that does not translate is left out and named; the rest import.
    const skippedSubjects: string[] = [];

    if (options.provider === 'backstage') {
      if (options.source)
        imported = importBackstageYaml(await fs.readFile(options.source, 'utf8'), options.source);
      else if (options.url)
        imported = await syncBackstageOwnership(
          backstageHttpClient(options.url, process.env.BACKSTAGE_TOKEN),
          options.url,
        );
      else
        throw new Error(
          'Backstage import requires a YAML path or --url pointing to the catalog API',
        );
    } else if (options.provider === 'datadog') {
      const apiKey = process.env.DD_API_KEY;
      const applicationKey = process.env.DD_APP_KEY;

      if (!apiKey || !applicationKey)
        throw new Error('Datadog import requires DD_API_KEY and DD_APP_KEY');
      const url = options.url ?? 'https://api.datadoghq.com';
      imported = await syncDatadogOwnership(datadogHttpClient(url, apiKey, applicationKey), url);
    } else if (options.provider === 'confluent') {
      if (!options.url || !options.id) throw new Error('Confluent import requires --url and --id');
      imported = {
        graph: await importConfluentRegistry(
          confluentHttpClient(options.url, process.env.CONFLUENT_AUTHORIZATION),
          {
            id: options.id,
            url: options.url,
            subjects: options.subjects,
            onSubjectError: (message) => skippedSubjects.push(message),
          },
        ),
        claims: [],
      };
    } else if (options.provider === 'glue') {
      if (!options.registry || !options.id)
        throw new Error('Glue import requires --registry and --id');

      const {
        GlueClient,
        ListSchemasCommand,
        GetSchemaCommand,
        ListSchemaVersionsCommand,
        GetSchemaVersionCommand,
      } = await import('@aws-sdk/client-glue');

      const client = new GlueClient({ region: options.region });
      const registry = options.registry;

      try {
        imported = {
          graph: await importGlueRegistry(
            {
              listSchemas: async (token) =>
                jsonValueSchema.parse(
                  JSON.parse(
                    JSON.stringify(
                      await client.send(
                        new ListSchemasCommand({
                          RegistryId: { RegistryName: registry },
                          NextToken: token,
                        }),
                      ),
                    ),
                  ),
                ),
              getSchema: async (schemaArn) =>
                jsonValueSchema.parse(
                  JSON.parse(
                    JSON.stringify(
                      await client.send(
                        new GetSchemaCommand({ SchemaId: { SchemaArn: schemaArn } }),
                      ),
                    ),
                  ),
                ),
              listVersions: async (schemaArn, token) =>
                jsonValueSchema.parse(
                  JSON.parse(
                    JSON.stringify(
                      await client.send(
                        new ListSchemaVersionsCommand({
                          SchemaId: { SchemaArn: schemaArn },
                          NextToken: token,
                        }),
                      ),
                    ),
                  ),
                ),
              getVersion: async (schemaArn, version) =>
                jsonValueSchema.parse(
                  JSON.parse(
                    JSON.stringify(
                      await client.send(
                        new GetSchemaVersionCommand({
                          SchemaId: { SchemaArn: schemaArn },
                          SchemaVersionNumber: { VersionNumber: version },
                        }),
                      ),
                    ),
                  ),
                ),
            },
            { id: options.id, registry, subjects: options.subjects },
          ),
          claims: [],
        };
      } finally {
        client.destroy();
      }
    } else throw new Error(`Unknown resource import provider: ${options.provider}`);
    const root = path.resolve(options.root);
    const id = options.id ?? options.provider;
    await saveResourceImport(root, id, imported);
    // The rescan applies the identities saved in config.json, so the import
    // lands on the same resources the earlier scans published.
    const result = await scanResources(root, {});
    await publishResources(root, result.graph);

    if (!options.quiet) {
      for (const skipped of skippedSubjects) console.warn(`Skipped ${skipped}`);

      console.log(
        `Imported ${imported.graph.resources.length} resources from ${options.provider} into .autocatalog/imports/${id}.json and ${RESOURCE_GRAPH_FILE}. ${COMMIT_RESOURCES_ADVICE}`,
      );
    }

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

export async function runResourceValidate(options: {
  root: string;
  observations?: string;
  cloudEvent?: string;
  resource?: string;
  headers?: string;
  quiet?: boolean;
}): Promise<number> {
  try {
    if ((options.headers || options.resource) && !options.cloudEvent)
      throw new Error('--headers and --resource only apply with --cloud-event <file>');

    const graph = await requireGraph(options.root);
    const commandFindings = validateCommands(graph);

    const documents = options.observations
      ? validateResourceDocuments(
          graph,
          await readJsonInput(
            options.observations,
            documentObservations,
            'a JSON array of document observations',
          ),
        )
      : undefined;

    let cloudFindings: ReturnType<typeof validateCloudEvent> = [];

    if (options.cloudEvent) {
      if (!options.resource)
        throw new Error('--cloud-event needs --resource <key> naming its payload contract');

      const resource = byKey(
        graph.resources,
        (entry) => resourceKey(entry.ref),
        options.resource,
        'resource',
      );

      const schema = resourceSchema(resource);

      if (!schema) throw new Error(`${options.resource} has no payload schema to validate against`);

      const headers = options.headers
        ? await readJsonInput(
            options.headers,
            z.record(z.string(), z.string()),
            'a JSON object of string headers',
          )
        : undefined;

      cloudFindings = validateCloudEvent(
        await readJsonInput(options.cloudEvent, jsonValueSchema, 'JSON'),
        schema,
        headers,
        envelopeMode(resource),
      );
    }

    if (!options.quiet)
      console.log(
        JSON.stringify(
          { commands: commandFindings, documents, cloudevents: cloudFindings },
          null,
          2,
        ),
      );

    return commandFindings.length ||
      documents?.findings.some((finding) => finding.severity !== 'info') ||
      cloudFindings.length
      ? 1
      : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
}

/** The identity flags every resource scan takes, saved to config.json when given. */
export function withScanIdentities(command: Command): Command {
  return command
    .option('--traces <file>', 'OTLP JSON trace export')
    .option('--datastore <id>', 'logical datastore identity shared by code and traces (saved)')
    .option('--database <name>', 'database namespace for extracted models (saved)')
    .option('--service <name>', 'service identity for code access edges (saved)')
    .option('--environment <name>', 'environment of the trace observations (saved)');
}

export function registerResourceCommands(program: Command): void {
  const resources = program
    .command('resources')
    .description('Discover datastore, command, service, and registry resources');

  withScanIdentities(
    resources
      .command('scan [root]')
      .description('Scan model contracts and bootstrap a graph from OTLP traces'),
  )
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (root: string | undefined, options: Omit<RunResourceScanOptions, 'root'>) => {
      process.exitCode = await runResourceScan({ ...options, root: root ?? process.cwd() });
    });
  resources
    .command('list [root]')
    .description('List resource and relationship keys, for promote and validate')
    .option('--json', 'emit JSON with exact keys', false)
    .action(async (root: string | undefined, options: { json: boolean }) => {
      process.exitCode = await runResourceList({ ...options, root: root ?? process.cwd() });
    });
  resources
    .command('ownership [root]')
    .description('Show who owns, writes, and reads each datastore resource')
    .option('--json', 'emit JSON', false)
    .action(async (root: string | undefined, options: { json: boolean }) => {
      process.exitCode = await runResourceOwnership({ ...options, root: root ?? process.cwd() });
    });
  resources
    .command('promote [root]')
    .description('Promote an inferred or observed relationship to a declaration')
    .requiredOption('--relationship <key>', 'relationship key from ac resources list')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(async (root: string | undefined, options: { relationship: string; quiet: boolean }) => {
      process.exitCode = await runResourcePromote({ ...options, root: root ?? process.cwd() });
    });
  resources
    .command('drift [root]')
    .description('Gate resource contract changes and command handler rules')
    .option('--base <root>', 'baseline repository containing .autocatalog/resources.json')
    .addOption(
      new Option('--format <format>', 'output format').choices(['text', 'json']).default('text'),
    )
    .addOption(
      new Option('--fail-on <severity>', 'exit nonzero on')
        .choices(['breaking', 'suspicious', 'never'])
        .default('breaking'),
    )
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        root: string | undefined,
        options: Omit<Parameters<typeof runResourceDrift>[0], 'root'>,
      ) => {
        process.exitCode = await runResourceDrift({ ...options, root: root ?? process.cwd() });
      },
    );
  resources
    .command('validate [root]')
    .description('Validate command handlers, document observations, and CloudEvents payloads')
    .option('--observations <file>', 'complete-document observations with resource references')
    .option('--cloud-event <file>', 'structured CloudEvent or binary-mode payload JSON')
    .option('--resource <key>', 'with --cloud-event: resource key of the payload contract')
    .option('--headers <file>', 'with --cloud-event: JSON HTTP headers for a binary CloudEvent')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        root: string | undefined,
        options: Omit<Parameters<typeof runResourceValidate>[0], 'root'>,
      ) => {
        process.exitCode = await runResourceValidate({ ...options, root: root ?? process.cwd() });
      },
    );
  resources
    .command('import <provider> [source]')
    .description('Import Backstage, Datadog, Confluent, or AWS Glue catalogs')
    .option('--root <root>', 'repository to publish into', process.cwd())
    .option('--id <id>', 'stable identity of this catalog or registry')
    .option('--url <url>', 'catalog API or registry endpoint')
    .option('--registry <name>', 'AWS Glue registry name')
    .option('--region <region>', 'AWS region (defaults to the AWS credential/config chain)')
    .option('--subjects <names...>', 'registry subjects or schema names to import')
    .option('-q, --quiet', 'suppress non-error output', false)
    .action(
      async (
        provider: string,
        source: string | undefined,
        options: Omit<ResourceImportOptions, 'provider' | 'source'>,
      ) => {
        process.exitCode = await runResourceImport({ ...options, provider, source });
      },
    );
}
