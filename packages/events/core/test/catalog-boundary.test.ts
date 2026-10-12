import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CatalogLoadError,
  CatalogPublicationLockedError,
  catalogPublicationLockPath,
  createCatalogProjection,
  driftCatalogs,
  loadCatalog,
  loadCatalogSnapshot,
  publishCatalog,
  type AdapterEvent,
} from '../src/index';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-boundary-'));
  roots.push(root);

  return root;
}

function event(id: string, folderName: string): AdapterEvent {
  return {
    id,
    version: '1.0.0',
    name: folderName,
    summary: `${folderName} contract`,
    domain: 'payments',
    folderName,
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    examples: [{ name: 'default', data: { id: 'one' } }],
    meta: { producers: ['Payments'], consumers: ['Ledger'], tags: ['money'] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Catalog snapshot boundary', () => {
  it('fails strict reads instead of silently omitting an invalid event', async () => {
    const root = await tempRoot();
    const broken = path.join(root, 'payments', 'Broken');
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, 'autocatalog.json'), '{"id": 1}\n');

    await expect(loadCatalog(root)).rejects.toBeInstanceOf(CatalogLoadError);
    const snapshot = await loadCatalogSnapshot(root, { mode: 'collect' });
    expect(snapshot.valid).toBe(false);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.diagnostics[0]).toMatchObject({ code: 'event_load_failed', path: broken });
  });

  it('refuses drift when either side is an incomplete snapshot', async () => {
    const parent = await tempRoot();
    const baseline = path.join(parent, 'baseline');
    const current = path.join(parent, 'current');
    await publishCatalog({
      outRoot: baseline,
      events: [event('payment.completed', 'PaymentCompleted')],
    });
    await publishCatalog({
      outRoot: current,
      events: [event('payment.completed', 'PaymentCompleted')],
    });
    await fs.writeFile(
      path.join(current, 'payments', 'PaymentCompleted', 'autocatalog.json'),
      '{broken',
    );

    await expect(driftCatalogs(baseline, current)).rejects.toBeInstanceOf(CatalogLoadError);
  });

  it('reads the current events alone from a catalog published with history', async () => {
    const root = await tempRoot();
    const current = event('payment.completed', 'PaymentCompleted');

    await publishCatalog({
      outRoot: root,
      events: [{ ...current, version: '2.0.0' }],
      history: [{ event: current, parentFolderName: 'PaymentCompleted' }],
    });

    // health, drift and fields read without history; the history is still checked by a full read.
    expect(
      (await loadCatalog(root, { skipVersioned: true })).map((e) => e.frontmatter.version),
    ).toEqual(['2.0.0']);
    expect((await loadCatalog(root)).map((e) => e.frontmatter.version).sort()).toEqual([
      '1.0.0',
      '2.0.0',
    ]);
  });

  it('rejects manifest-controlled paths that escape an Event folder', async () => {
    const root = await tempRoot();
    const folder = path.join(root, 'payments', 'Escaped');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(root, 'outside.json'), '{"type":"object"}\n');
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      `${JSON.stringify({
        spec: 'autocatalog/v2',
        id: 'escaped',
        version: '1.0.0',
        name: 'Escaped',
        summary: 'Unsafe schema path',
        schema: '../../outside.json',
      })}\n`,
    );

    await expect(loadCatalog(root)).rejects.toThrow(/escapes the Event folder/);
  });
});

describe('complete artifact publication', () => {
  it('atomically replaces stale generated events and writes a deterministic index', async () => {
    const parent = await tempRoot();
    const out = path.join(parent, 'events');
    await publishCatalog({ outRoot: out, events: [event('payment.started', 'PaymentStarted')] });

    const result = await publishCatalog({
      outRoot: out,
      events: [event('payment.completed', 'PaymentCompleted')],
      repository: { id: 'billing', revision: 'abc123' },
    });

    await expect(fs.access(path.join(out, 'payments', 'PaymentStarted'))).rejects.toThrow();
    expect(result.eventsRemoved).toEqual(['payments/PaymentStarted']);

    const artifact = JSON.parse(
      await fs.readFile(path.join(out, 'autocatalog.artifact.json'), 'utf8'),
    );

    expect(artifact).toMatchObject({
      spec: 'autocatalog/artifact-v1',
      repository: { id: 'billing', revision: 'abc123' },
    });
    expect(artifact.events[0].manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.events[0].contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves narrative for a surviving event and refuses to orphan authored content', async () => {
    const parent = await tempRoot();
    const out = path.join(parent, 'events');
    const folder = path.join(out, 'payments', 'PaymentStarted');
    await publishCatalog({ outRoot: out, events: [event('payment.started', 'PaymentStarted')] });
    await fs.writeFile(path.join(folder, 'index.mdx'), 'Human context.\n');

    await publishCatalog({ outRoot: out, events: [event('payment.started', 'PaymentStarted')] });
    expect(await fs.readFile(path.join(folder, 'index.mdx'), 'utf8')).toBe('Human context.\n');

    await expect(
      publishCatalog({ outRoot: out, events: [event('payment.completed', 'PaymentCompleted')] }),
    ).rejects.toThrow(/Refusing to retire/);
    expect(await fs.readFile(path.join(folder, 'index.mdx'), 'utf8')).toBe('Human context.\n');
  });

  it('rejects path traversal before publishing', async () => {
    const parent = await tempRoot();
    const unsafe = event('bad', 'Bad');
    unsafe.domain = '../outside';
    await expect(
      publishCatalog({ outRoot: path.join(parent, 'events'), events: [unsafe] }),
    ).rejects.toThrow(/Unsafe domain/);
  });

  it('detects artifact tampering before returning a Catalog snapshot', async () => {
    const parent = await tempRoot();
    const out = path.join(parent, 'events');
    await publishCatalog({
      outRoot: out,
      events: [event('payment.completed', 'PaymentCompleted')],
    });
    const schemaPath = path.join(out, 'payments', 'PaymentCompleted', 'schema.json');
    const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    schema.description = 'tampered';
    await fs.writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    await expect(loadCatalog(out)).rejects.toMatchObject({
      snapshot: {
        diagnostics: [expect.objectContaining({ code: 'artifact_integrity_mismatch' })],
      },
    });
  });

  it('serializes publishers and recovers an abandoned rename', async () => {
    const parent = await tempRoot();
    const out = path.join(parent, 'events');
    await publishCatalog({ outRoot: out, events: [event('payment.started', 'PaymentStarted')] });
    const lockPath = catalogPublicationLockPath(out);
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({
        token: 'active',
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: new Date().toISOString(),
        outRoot: out,
      })}\n`,
    );
    await expect(
      publishCatalog({ outRoot: out, events: [event('payment.completed', 'PaymentCompleted')] }),
    ).rejects.toBeInstanceOf(CatalogPublicationLockedError);
    await fs.unlink(lockPath);

    const backup = path.join(parent, '.events-backup-crash');
    const stage = path.join(parent, '.events-stage-crash');
    await fs.rename(out, backup);
    await fs.mkdir(stage);
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({
        token: 'abandoned',
        pid: 999_999_999,
        hostname: os.hostname(),
        startedAt: new Date(0).toISOString(),
        outRoot: out,
        backup,
        stage,
      })}\n`,
    );

    expect((await loadCatalog(out))[0]?.frontmatter.id).toBe('payment.started');
    await expect(fs.access(stage)).rejects.toThrow();
    await expect(fs.access(lockPath)).rejects.toThrow();
  });
});

describe('Catalog projection', () => {
  it('derives graph, services, search, and lookup from the same events', async () => {
    const parent = await tempRoot();
    const out = path.join(parent, 'events');
    await publishCatalog({
      outRoot: out,
      events: [event('payment.completed', 'PaymentCompleted')],
    });
    const projection = createCatalogProjection(await loadCatalogSnapshot(out));

    expect(projection.domains).toEqual(['payments']);
    expect(projection.resourceSummary).toMatchObject({
      resources: 3,
      resourcesByKind: { event: 1, service: 2 },
      relationships: 2,
    });
    expect(projection.resourceMap.get('event:payments/payment.completed@1.0.0')).toMatchObject({
      title: 'PaymentCompleted',
      ref: { kind: 'event', namespace: 'payments', id: 'payment.completed' },
    });
    expect(projection.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'produces',
          from: { kind: 'service', id: 'Payments' },
          to: {
            kind: 'event',
            namespace: 'payments',
            id: 'payment.completed',
            version: '1.0.0',
          },
        }),
      ]),
    );
    expect(projection.services.get('Ledger')?.consumes[0]?.id).toBe('payment.completed');
    expect(projection.graph.edges).toContainEqual({
      from: 'event:payments/payment.completed',
      to: 'service:Ledger',
      kind: 'consumes',
    });
    expect(projection.searchRecords[0]?.text).toContain('money');
    expect(projection.eventMap.get('payment.completed')?.frontmatter.name).toBe('PaymentCompleted');
  });
});
