import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runResourceScan,
  runResourcePromote,
  runResourceDrift,
  runResourceImport,
  runResourceList,
  runResourceOwnership,
  runResourceValidate,
} from '../src/commands/resources';
import {
  datastoreOwnership,
  readResourceGraph,
  relationshipKey,
  resourceKey,
  type JsonValue,
} from 'autocatalog-core';
import { runScan } from '../src/commands/scan';
import { runDrift } from '../src/commands/drift';
import { buildProgram } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));

const brownfield = path.resolve(here, '../../../../fixtures/brownfield-repo');

const jsonSchemaRepo = path.resolve(here, '../../../../fixtures/json-schema-repo');

const flags = { service: 'billing', datastore: 'main', database: 'finance' };

const temporary: string[] = [];

afterEach(async () => {
  process.exitCode = undefined;

  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-resources-'));
  temporary.push(directory);

  return directory;
}

/** A copy of the brownfield fixture: a Mongoose writer, a trace-only reader, a Backstage owner and a command. */
async function brownfieldCopy(name = 'repo'): Promise<string> {
  const root = path.join(await workspace(), name);
  await fs.cp(brownfield, root, { recursive: true });

  return root;
}

async function writeJson(file: string, value: JsonValue): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));

  return file;
}

/** Everything a command printed, by stream, with the exit code it returned. */
async function capture(run: () => Promise<number | void>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line) => void stdout.push(String(line)));

  const warn = vi
    .spyOn(console, 'warn')
    .mockImplementation((line) => void stderr.push(String(line)));

  const error = vi
    .spyOn(console, 'error')
    .mockImplementation((line) => void stderr.push(String(line)));

  try {
    const code = await run();

    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  }
}

/** Parse argv through the real program, with commander's exits turned into results. */
async function cli(argv: string[]) {
  const program = buildProgram();
  const errors: string[] = [];
  const all = (command: Command): Command[] => [command, ...command.commands.flatMap(all)];

  for (const command of all(program))
    command.exitOverride().configureOutput({ writeErr: (text) => void errors.push(text) });

  try {
    await program.parseAsync(['node', 'ac', ...argv]);

    return { code: process.exitCode ?? 0, stderr: errors.join('') };
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;

    return { code: error.exitCode, stderr: errors.join('') };
  }
}

function otlp(service: string, operation: string, traceId: string) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                attributes: [
                  { key: 'db.system.name', value: { stringValue: 'mongodb' } },
                  { key: 'db.collection.name', value: { stringValue: 'statements' } },
                  { key: 'db.namespace', value: { stringValue: 'finance' } },
                  { key: 'db.operation.name', value: { stringValue: operation } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

const keys = async (root: string) =>
  (await readResourceGraph(root))!.resources.map((resource) => resourceKey(resource.ref));

const ownership = async (root: string) => datastoreOwnership((await readResourceGraph(root))!);

describe('ac resources', () => {
  it('scans a schema-free OTLP export and promotes an observed edge', async () => {
    const root = await workspace();
    const traces = await writeJson(path.join(root, 'otlp.json'), otlp('billing', 'insert', 't1'));
    expect(await runResourceScan({ root, traces, datastore: 'acme', quiet: true })).toBe(0);
    const graph = (await readResourceGraph(root))!;
    expect(graph.relationships.map(relationshipKey)).toEqual([
      'service:billing--writes-->collection:acme%2Ffinance/statements',
    ]);
    expect(
      await runResourcePromote({
        root,
        relationship: relationshipKey(graph.relationships[0]!),
        quiet: true,
      }),
    ).toBe(0);
    expect((await readResourceGraph(root))?.relationships[0]?.provenance).toBe('declared');
  });

  it('lets a major version bump acknowledge a breaking command change', async () => {
    const baseline = await brownfieldCopy('baseline');
    expect(await runResourceScan({ root: baseline, ...flags, quiet: true })).toBe(0);

    const drift = async (version: string) => {
      const current = await brownfieldCopy('current');
      const command = path.join(current, 'commands', 'generate-statement');
      await writeJson(path.join(command, 'schema.json'), {
        type: 'object',
        properties: { customerId: { type: 'number' } },
        required: ['customerId'],
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(command, 'autocatalog.json'), 'utf8'),
      );

      await writeJson(path.join(command, 'autocatalog.json'), { ...manifest, version });
      expect(await runResourceScan({ root: current, ...flags, quiet: true })).toBe(0);

      return runResourceDrift({ root: current, base: baseline, quiet: true });
    };

    expect(await drift('1.0.0')).toBe(1);
    expect(await drift('2.0.0')).toBe(0);
  });

  it('gates a writer the baseline never had, as suspicious', async () => {
    const baseline = await brownfieldCopy('baseline');
    const current = await brownfieldCopy('current');
    expect(await runResourceScan({ root: baseline, ...flags, quiet: true })).toBe(0);

    const traces = await writeJson(
      path.join(current, 'writer.json'),
      otlp('ledger-sync', 'updateOne', 'w1'),
    );

    expect(await runResourceScan({ root: current, ...flags, traces, quiet: true })).toBe(0);

    const breaking = await capture(() => runResourceDrift({ root: current, base: baseline }));
    expect(breaking).toEqual({
      code: 0,
      stdout:
        'SUSPICIOUS collection/statements: ledger-sync writes collection:main%2Ffinance/statements without a baseline declaration; affects ledger-sync',
      stderr: '',
    });
    expect(
      await runResourceDrift({ root: current, base: baseline, failOn: 'suspicious', quiet: true }),
    ).toBe(1);
  });

  it('imports ownership from a local Backstage catalog through the CLI boundary', async () => {
    const root = await workspace();
    const source = path.join(root, 'external.yaml');
    await fs.writeFile(
      source,
      'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: billing\nspec:\n  type: service\n  owner: ledger-team\n',
    );
    expect(
      await runResourceImport({
        provider: 'backstage',
        source,
        root,
        id: 'acme-backstage',
        quiet: true,
      }),
    ).toBe(0);
    expect(
      (await readResourceGraph(root))?.resources.find((resource) => resource.ref.id === 'billing')
        ?.owner?.team,
    ).toBe('ledger-team');
  });
});

describe('what ac scan writes', () => {
  it('writes nothing under .autocatalog/ for a repository without resources', async () => {
    const root = path.join(await workspace(), 'repo');
    await fs.cp(jsonSchemaRepo, root, { recursive: true });
    await fs.rm(path.join(root, '.autocatalog'), { recursive: true, force: true });

    const result = await capture(() =>
      runScan({ root, out: path.join(root, 'events'), adapters: [] }),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('resources.json');
    await expect(fs.access(path.join(root, '.autocatalog'))).rejects.toThrow();
    await expect(fs.access(path.join(root, 'events', 'resources.json'))).rejects.toThrow();
  });

  it('removes the resource graph it wrote once the repository has no resources left', async () => {
    const root = path.join(await workspace(), 'repo');
    await fs.mkdir(root);
    await fs.writeFile(
      path.join(root, 'user.ts'),
      "import mongoose from 'mongoose';\nexport const User = mongoose.model('User', new mongoose.Schema({ id: String }), 'users');\n",
    );

    const out = path.join(root, 'events');

    await capture(() => runScan({ root, out, adapters: [] }));
    await fs.access(path.join(root, '.autocatalog/resources.json'));
    await fs.access(path.join(out, 'resources.json'));

    await fs.rm(path.join(root, 'user.ts'));

    const result = await capture(() => runScan({ root, out, adapters: [] }));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'removed .autocatalog/resources.json: the repository no longer has resources. Commit the deletion.',
    );
    await expect(fs.access(path.join(root, '.autocatalog/resources.json'))).rejects.toThrow();
    await expect(fs.access(path.join(out, 'resources.json'))).rejects.toThrow();

    const quiet = await capture(() => runResourceScan({ root }));

    expect(quiet.stdout).toBe('Found no resources; .autocatalog/resources.json was not written');
  });

  it('says it wrote the resource graph, and counts it in the summary', async () => {
    const root = await brownfieldCopy();

    const result = await capture(() =>
      runScan({ root, out: path.join(root, 'events'), adapters: [], ...flags }),
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('  4 resources  1 collection, 1 command, 2 services');
    expect(result.stdout).toContain('  3 relationships');
    expect(result.stdout).toContain(
      '  wrote events/ (0 event folders, events/llms.txt, events/resources.json)',
    );
    expect(result.stdout).toContain(
      '  wrote .autocatalog/resources.json (4 resources, 3 relationships)',
    );
    expect(result.stdout).toContain('  Commit .autocatalog/:');
    expect(result.stderr).not.toContain('nothing was documented');
    expect(
      JSON.parse(await fs.readFile(path.join(root, 'events', 'resources.json'), 'utf8')),
    ).toEqual(await readResourceGraph(root));
  });

  it('includes model resources in the ordinary ac scan workflow', async () => {
    const root = await workspace();
    await fs.writeFile(
      path.join(root, 'schema.prisma'),
      'model Statement {\n  id Int @id\n  amount Float\n  @@map("statements")\n}\n',
    );
    expect(await runScan({ root, out: path.join(root, 'events'), quiet: true, adapters: [] })).toBe(
      0,
    );
    expect(
      (await readResourceGraph(root))?.resources.some(
        (resource) => resource.ref.kind === 'table' && resource.ref.id === 'statements',
      ),
    ).toBe(true);
  });
});

describe('scan options are remembered', () => {
  it('saves explicit identities to config.json, and every later rescan keeps them', async () => {
    const root = await brownfieldCopy();
    const scanned = await capture(() => runResourceScan({ root, ...flags }));
    expect(scanned.code).toBe(0);
    expect(scanned.stdout).toContain(
      'Saved --service, --datastore, --database to .autocatalog/config.json; later scans use them. Commit it.',
    );
    expect(
      JSON.parse(await fs.readFile(path.join(root, '.autocatalog', 'config.json'), 'utf8')),
    ).toEqual(flags);

    const before = { keys: await keys(root), ownership: await ownership(root) };
    expect(before.ownership).toEqual([
      expect.objectContaining({
        ref: { kind: 'collection', namespace: 'main/finance', id: 'statements' },
        writers: ['billing'],
      }),
    ]);

    const source = path.join(root, 'elsewhere.yaml');
    await fs.writeFile(
      source,
      'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: billing\nspec:\n  type: service\n  owner: group:default/ledger\n',
    );
    expect(
      await runResourceImport({ provider: 'backstage', source, root, id: 'catalog', quiet: true }),
    ).toBe(0);
    expect({ keys: await keys(root), ownership: await ownership(root) }).toEqual(before);

    expect(await runScan({ root, out: path.join(root, 'events'), adapters: [], quiet: true })).toBe(
      0,
    );
    expect({ keys: await keys(root), ownership: await ownership(root) }).toEqual(before);
  });

  it('merges flags into an existing config and says nothing when they are unchanged', async () => {
    const root = await brownfieldCopy();
    const config = path.join(root, '.autocatalog', 'config.json');
    await writeJson(config, { service: 'old', ownership: { teamAliases: { a: 'b' } } });
    expect(await runResourceScan({ root, service: 'billing', quiet: true })).toBe(0);
    expect(JSON.parse(await fs.readFile(config, 'utf8'))).toEqual({
      service: 'billing',
      ownership: { teamAliases: { a: 'b' } },
    });

    const again = await capture(() => runResourceScan({ root, service: 'billing' }));
    expect(again.stdout).not.toContain('config.json');
  });
});

describe('resource drift through the artifact workflow', () => {
  async function artifacts(change: (current: string) => Promise<void>) {
    const baseline = await brownfieldCopy('baseline');
    const current = await brownfieldCopy('current');
    await change(current);
    const work = await workspace();
    const base = path.join(work, 'base-events');
    const head = path.join(work, 'current-events');
    expect(await runScan({ root: baseline, out: base, adapters: [], quiet: true, ...flags })).toBe(
      0,
    );
    expect(await runScan({ root: current, out: head, adapters: [], quiet: true, ...flags })).toBe(
      0,
    );

    return { base, current: head };
  }

  const dropAmount = (current: string) =>
    fs.writeFile(
      path.join(current, 'statements.ts'),
      "import mongoose from 'mongoose';\n\nconst statementSchema = new mongoose.Schema(\n  { customerId: { type: String, required: true } },\n  { collection: 'statements' },\n);\n\nexport const Statement = mongoose.model('Statement', statementSchema);\n\nexport async function generateStatement(customerId: string) {\n  return Statement.create({ customerId });\n}\n",
    );

  it('reads the resource graph each artifact carries', async () => {
    const dirs = await artifacts(dropAmount);
    const result = await capture(() => runDrift({ ...dirs, format: 'json' }));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).findings).toEqual([
      expect.objectContaining({
        resource: { kind: 'collection', namespace: 'main/finance', id: 'statements' },
        kind: 'field_removed',
        severity: 'breaking',
      }),
    ]);
    expect(result.stderr).toBe('');
  });

  it('fails a removed required field under forward and full compatibility', async () => {
    const dirs = await artifacts(dropAmount);
    expect(await runDrift({ ...dirs, compatibility: 'forward', quiet: true })).toBe(1);
    expect(await runDrift({ ...dirs, compatibility: 'full', quiet: true })).toBe(1);
    expect(await runDrift({ ...dirs, compatibility: 'backward', quiet: true })).toBe(0);
  });

  it('fails a removed collection under every compatibility strategy', async () => {
    const dirs = await artifacts((current) => fs.rm(path.join(current, 'statements.ts')));
    expect(await runDrift({ ...dirs, compatibility: 'forward', quiet: true })).toBe(1);
    expect(await runDrift({ ...dirs, compatibility: 'backward', quiet: true })).toBe(1);
  });

  it('warns, and compares no resources, when one side has no graph', async () => {
    const dirs = await artifacts(dropAmount);
    await fs.rm(path.join(dirs.base, 'resources.json'));
    const result = await capture(() => runDrift(dirs));
    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      `${path.join(dirs.base, 'resources.json')} is missing, so datastore and command resources were not compared. Regenerate both artifacts with ac scan.`,
    );
  });

  it('compares a datastore when no scan named one', async () => {
    const work = await workspace();

    for (const [name, type] of [
      ['baseline', 'Float'],
      ['current', 'String'],
    ] as const) {
      const root = path.join(work, name);
      await fs.mkdir(root);
      await fs.writeFile(
        path.join(root, 'schema.prisma'),
        `model Statement {\n  id Int @id\n  amount ${type}\n  @@map("statements")\n}\n`,
      );
      expect(
        await runScan({ root, out: path.join(root, 'events'), quiet: true, adapters: [] }),
      ).toBe(0);
    }

    const result = await capture(() =>
      runDrift({
        base: path.join(work, 'baseline', 'events'),
        current: path.join(work, 'current', 'events'),
        format: 'json',
      }),
    );

    expect(result.code).toBe(1);

    const findings: Array<{ kind: string; resource?: { id: string } }> = JSON.parse(
      result.stdout,
    ).findings;

    expect(findings.map((finding) => [finding.kind, finding.resource?.id])).toEqual([
      ['type_changed', 'statements'],
    ]);
  });
});

describe('resource and relationship keys', () => {
  it('lists every key, and accepts them unencoded', async () => {
    const root = await brownfieldCopy();
    expect(
      await runResourceScan({
        root,
        ...flags,
        traces: path.join(root, 'otlp.json'),
        quiet: true,
      }),
    ).toBe(0);

    const listed = await capture(() => runResourceList({ root }));
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('collection:main/finance/statements');
    expect(listed.stdout).toContain(
      'service:reporting--reads-->collection:main/finance/statements',
    );

    const json = await capture(() => runResourceList({ root, json: true }));
    expect(JSON.parse(json.stdout).relationships).toContainEqual({
      key: 'service:reporting--reads-->collection:main%2Ffinance/statements',
      type: 'reads',
      provenance: 'observed',
    });

    expect(
      await runResourcePromote({
        root,
        relationship: 'service:reporting--reads-->collection:main/finance/statements',
        quiet: true,
      }),
    ).toBe(0);
    expect(
      (await readResourceGraph(root))!.relationships.find((edge) => edge.from.id === 'reporting')
        ?.provenance,
    ).toBe('declared');

    const event = await writeJson(path.join(root, 'event.json'), {
      specversion: '1.0',
      id: '1',
      source: '/billing',
      type: 'statement.stored',
      data: { customerId: 'c1', amount: 1 },
    });

    expect(
      await runResourceValidate({
        root,
        cloudEvent: event,
        resource: 'collection:main/finance/statements',
        quiet: true,
      }),
    ).toBe(0);
  });

  it('names the listing when a key matches nothing', async () => {
    const root = await brownfieldCopy();
    expect(await runResourceScan({ root, ...flags, quiet: true })).toBe(0);
    expect(await capture(() => runResourcePromote({ root, relationship: 'nope' }))).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Unknown relationship: nope. Run ac resources list to see the keys.',
    });
  });
});

describe('errors name the file and the fix', () => {
  it('reports an unreadable trace export by its path', async () => {
    const root = await workspace();
    const missing = path.join(root, 'missing.json');
    const broken = path.join(root, 'broken.json');
    await fs.writeFile(broken, '{');
    const wrong = await writeJson(path.join(root, 'wrong.json'), { resourceSpans: 'x' });

    expect(await capture(() => runResourceScan({ root, traces: missing }))).toEqual({
      code: 1,
      stdout: '',
      stderr: `${missing}: not found`,
    });
    expect((await capture(() => runResourceScan({ root, traces: broken }))).stderr).toBe(
      `${broken}: not valid JSON`,
    );
    expect((await capture(() => runResourceScan({ root, traces: wrong }))).stderr).toBe(
      `${wrong}: not an OTLP JSON export (resourceSpans: Invalid input: expected array, received string)`,
    );
    expect(
      (await capture(() => runScan({ root, out: path.join(root, 'events'), traces: wrong })))
        .stderr,
    ).toBe(
      `${wrong}: not an OTLP JSON export (resourceSpans: Invalid input: expected array, received string)`,
    );
  });

  it('reports a bad config.json by name, with the fix', async () => {
    const root = await brownfieldCopy();
    await writeJson(path.join(root, '.autocatalog', 'config.json'), { datastore: 7 });

    const expected = {
      code: 1,
      stdout: '',
      stderr:
        '.autocatalog/config.json: datastore: Invalid input: expected string, received number. Fix it or delete the file.',
    };

    expect(await capture(() => runResourceScan({ root }))).toEqual(expected);
    expect(
      await capture(() => runScan({ root, out: path.join(root, 'events'), adapters: [] })),
    ).toEqual(expected);
  });

  it('reports a corrupt resources.json by name, with the fix', async () => {
    const root = await workspace();
    const graph = path.join(root, '.autocatalog', 'resources.json');
    await fs.mkdir(path.dirname(graph));
    await fs.writeFile(graph, '{');
    expect(await capture(() => runResourceOwnership({ root }))).toEqual({
      code: 1,
      stdout: '',
      stderr:
        '.autocatalog/resources.json: not valid JSON. Delete it and run ac resources scan to regenerate it.',
    });

    await writeJson(graph, { spec: 'autocatalog/graph-v1', resources: 'x' });
    expect((await capture(() => runResourceScan({ root }))).stderr).toBe(
      ".autocatalog/resources.json: does not match the resource graph contract (must have required property 'relationships'). Delete it and run ac resources scan to regenerate it.",
    );
  });

  it('refuses unknown --format and --fail-on values', async () => {
    const format = await cli(['resources', 'drift', '--format', 'yaml']);
    expect(format.code).toBe(1);
    expect(format.stderr).toContain("argument 'yaml' is invalid. Allowed choices are text, json.");

    const failOn = await cli(['resources', 'drift', '--fail-on', 'always']);
    expect(failOn.code).toBe(1);
    expect(failOn.stderr).toContain(
      "argument 'always' is invalid. Allowed choices are breaking, suspicious, never.",
    );
  });

  it('refuses --headers or --resource without --cloud-event', async () => {
    const root = await brownfieldCopy();
    expect(await runResourceScan({ root, ...flags, quiet: true })).toBe(0);
    const message = '--headers and --resource only apply with --cloud-event <file>';
    expect(await capture(() => runResourceValidate({ root, headers: 'h.json' }))).toEqual({
      code: 1,
      stdout: '',
      stderr: message,
    });
    expect((await capture(() => runResourceValidate({ root, resource: 'x' }))).stderr).toBe(
      message,
    );
  });
});

describe('importing a schema registry over HTTP', () => {
  const paid =
    'syntax = "proto3"; package billing; import "google/protobuf/timestamp.proto"; message Paid { string id = 1; google.protobuf.Timestamp at = 2; }';

  const broken = 'syntax = "proto3"; package billing; message Broken { Missing value = 1; }';

  /** A Confluent Schema Registry with one subject that translates and one that does not. */
  async function registry(): Promise<{ url: string; close: () => Promise<void> }> {
    const schemas = new Map([
      ['broken', broken],
      ['paid', paid],
    ]);

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const [, collection, subject, , version] = url.pathname.split('/');

      const body =
        url.pathname === '/subjects'
          ? [...schemas.keys()]
          : collection === 'config'
            ? { compatibilityLevel: 'BACKWARD' }
            : version === undefined
              ? [1]
              : {
                  subject,
                  version: 1,
                  id: 1,
                  schemaType: 'PROTOBUF',
                  schema: schemas.get(decodeURIComponent(subject ?? '')),
                };

      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
    const { port } = server.address() as AddressInfo;

    return {
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve())),
    };
  }

  it('names a subject that does not translate, skips it, and imports the rest', async () => {
    const root = await brownfieldCopy();
    const server = await registry();

    try {
      const result = await capture(() =>
        runResourceImport({ provider: 'confluent', url: server.url, id: 'kafka', root }),
      );

      expect(result.code).toBe(0);
      expect(result.stderr).toBe(
        "Skipped broken@1: no such Type or Enum 'Missing' in Type .billing.Broken",
      );

      const graph = await readResourceGraph(root);

      expect(graph?.resources.some((resource) => resource.ref.id === 'paid')).toBe(true);
      expect(graph?.resources.some((resource) => resource.ref.id === 'broken')).toBe(false);
    } finally {
      await server.close();
    }
  });
});
