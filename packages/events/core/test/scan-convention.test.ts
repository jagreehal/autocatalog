import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtInDiscoveryAdapters } from '../src/built-in-adapters';
import { driftCatalogs } from '../src/drift';
import { jsonSchemaAjv } from '../src/json-schema-dialect';
import { scanCatalog } from '../src/scan-catalog';
import {
  conventionDiscoveryAdapter,
  conventionFiles,
  CONVENTIONS_PATH,
} from '../src/scan-convention';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-convention-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const write = async (file: string, content: Parameters<typeof JSON.stringify>[0]) => {
  const target = path.join(root, file);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(content));
};

/** One event as `zod-to-json-schema` writes it when given a name. */
const named = (id: string, detail: Record<string, { type: string }>) => ({
  $ref: `#/definitions/${id}`,
  definitions: {
    [id]: {
      type: 'object',
      description: `Schema for the ${id} event`,
      properties: {
        type: { type: 'string', const: id },
        detail: { type: 'object', properties: detail, required: Object.keys(detail) },
      },
      required: ['type', 'detail'],
    },
  },
  $schema: 'http://json-schema.org/draft-07/schema#',
});

const source = {
  kind: 'event',
  files: ['sdk/event-schemas.json'],
  match: ['v{version}.{id}', 'v{version}/{id}'],
  domain: 'payments',
};

const discover = (conventions?: string) =>
  conventionDiscoveryAdapter.discover({ root, ...(conventions && { conventions }) });

describe('events from a conventions file', () => {
  it('does nothing without a conventions file', async () => {
    await expect(discover()).resolves.toMatchObject({ candidates: [], errors: [] });
  });

  it('reads a joined file of schemas, one event per key', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', {
      'v1.payment.completed': named('v1.payment.completed', { payment_id: { type: 'string' } }),
      'v2/payment-failed': named('v2/payment-failed', { reason: { type: 'string' } }),
    });

    const { candidates, errors } = await discover();

    expect(errors).toEqual([]);
    expect(candidates.map(({ event }) => [event.id, event.version, event.domain])).toEqual([
      ['payment.completed', '1.0.0', 'payments'],
      ['payment-failed', '2.0.0', 'payments'],
    ]);
    expect(candidates[0]?.event).toMatchObject({
      summary: 'Schema for the v1.payment.completed event',
      needsReview: false,
      source: { file: 'sdk/event-schemas.json', symbol: 'v1.payment.completed' },
    });
  });

  it('lifts an event out of its named definition, keeping references good', async () => {
    const id = 'v1/a';
    const schema = named(id, { first: { type: 'string' } });
    const event = schema.definitions[id]!;

    Object.assign(event.properties.detail.properties, {
      second: { $ref: `#/definitions/${id}/properties/detail/properties/first` },
    });

    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', { [id]: schema });

    const { candidates } = await discover();

    expect(candidates[0]?.event.schema).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        detail: { properties: { second: { $ref: '#/properties/detail/properties/first' } } },
      },
    });
    expect(candidates[0]?.event.schema).not.toHaveProperty('definitions');
  });

  it('leaves a schema that is not wrapped as it is', async () => {
    const plain = { type: 'object', properties: { id: { type: 'string' } } };

    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', { 'v1.a.b': plain });

    const { candidates } = await discover();

    expect(candidates[0]?.event.schema).toEqual(plain);
  });

  it('publishes events whose ids differ only in punctuation', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', {
      'v1.payment.failed': named('v1.payment.failed', {}),
      'v1/payment-failed': named('v1/payment-failed', {}),
    });

    const { errors, events } = await scanCatalog({
      root,
      outRoot: path.join(root, 'out'),
      adapters: builtInDiscoveryAdapters,
    });

    expect(errors).toEqual([]);
    expect(events.map(({ id }) => id).sort()).toEqual(['payment-failed', 'payment.failed']);
  });

  it('publishes the newest version of an event and says what it left out', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', {
      'v1.payment.done': named('v1.payment.done', {}),
      'v10.payment.done': named('v10.payment.done', {}),
      'v9.payment.done': named('v9.payment.done', {}),
    });

    const { events, skipped } = await scanCatalog({
      root,
      outRoot: path.join(root, 'out'),
      adapters: builtInDiscoveryAdapters,
    });

    expect(events.map(({ version }) => version)).toEqual(['10.0.0']);
    expect(skipped.join()).toContain('"v9.payment.done" is older than 10.0.0');
    expect(skipped.join()).toContain('"v1.payment.done" is older than 10.0.0');
  });

  it('marks a version it had to assume for review', async () => {
    await write(CONVENTIONS_PATH, { sources: [{ ...source, match: ['{id}'] }] });
    await write('sdk/event-schemas.json', { 'a.b': named('a.b', {}) });

    const { candidates } = await discover();

    expect(candidates[0]?.event).toMatchObject({
      version: '0.1.0',
      needsReview: true,
      provenance: { fields: { version: 'inferred' } },
    });
  });

  it('declares what the file cannot say once for all its events', async () => {
    await write(CONVENTIONS_PATH, {
      sources: [{ ...source, meta: { owner: { team: 'payments' }, producers: ['payments-api'] } }],
    });
    await write('sdk/event-schemas.json', { 'v1.a.b': named('v1.a.b', {}) });

    const { candidates } = await discover();

    expect(candidates[0]?.event.meta).toMatchObject({
      owner: { team: 'payments' },
      producers: ['payments-api'],
    });
  });

  it('says which keys matched no pattern rather than dropping them', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', { legacy: named('legacy', {}) });

    const { candidates, skipped } = await discover();

    expect(candidates).toEqual([]);
    expect(skipped?.join()).toContain('sdk/event-schemas.json: "legacy"');
  });

  it('says when a listed file is not in this repository', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });

    const { errors, skipped } = await discover();

    expect(errors).toEqual([]);
    expect(skipped?.join()).toContain('sdk/event-schemas.json');
  });

  it('reads no file outside the repository', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-outside-'));
    const secret = path.join(outside, 'secret.json');

    await fs.writeFile(secret, '{"v1.a.b": {}}');
    await write(CONVENTIONS_PATH, {
      sources: [{ ...source, files: [path.relative(root, secret)] }],
    });

    const { candidates, errors } = await discover();

    await fs.rm(outside, { recursive: true, force: true });

    expect(candidates).toEqual([]);
    expect(errors.join()).toContain('not a regular file inside the repository');
  });

  it.each([
    ['an unknown key', { ...source, nope: true }],
    ['a pattern with no id', { ...source, match: ['v{version}'] }],
    ['a pattern with two ids', { ...source, match: ['{id}.{id}'] }],
    ['no files', { ...source, files: [] }],
  ])('refuses %s', async (_case, broken) => {
    await write(CONVENTIONS_PATH, { sources: [broken] });

    const { errors } = await discover();

    expect(errors.join()).toContain(CONVENTIONS_PATH);
  });

  it.each([
    ['an id', { ...source, match: ['{id}'] }, '..'],
    ['a domain', { ...source, domain: '../../outside' }, 'v1.a.b'],
  ])('writes nothing outside the catalog for %s of dots', async (_case, mapping, key) => {
    await write(CONVENTIONS_PATH, { sources: [mapping] });
    await write('sdk/event-schemas.json', { [key]: named(key, {}) });

    const outRoot = path.join(root, 'nested/deep/out');

    await scanCatalog({ root, outRoot, adapters: builtInDiscoveryAdapters });

    const written = await fs.readdir(root, { recursive: true });

    expect(written.filter((file) => String(file).endsWith('schema.json'))).toEqual(
      written.filter(
        (file) =>
          String(file).startsWith('nested/deep/out/') && String(file).endsWith('schema.json'),
      ),
    );
  });

  it('treats pattern text as text, not a regular expression', async () => {
    await write(CONVENTIONS_PATH, { sources: [{ ...source, match: ['(a+)+.{id}'] }] });
    await write('sdk/event-schemas.json', {
      'aaa.x': named('aaa.x', {}),
      '(a+)+.y': named('(a+)+.y', {}),
    });

    const { candidates } = await discover();

    expect(candidates.map(({ event }) => event.id)).toEqual(['y']);
  });

  it('reads a shared file named by the caller over the repository’s own', async () => {
    const shared = path.join(root, 'shared.json');

    await fs.writeFile(shared, JSON.stringify({ sources: [source] }));
    await write('sdk/event-schemas.json', { 'v1.a.b': named('v1.a.b', {}) });

    const { candidates } = await discover(shared);

    expect(candidates).toHaveLength(1);
  });

  it('writes manifests the published event contract takes', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', { 'v1.a.b': named('v1.a.b', {}) });

    const outRoot = path.join(root, 'out');

    await scanCatalog({ root, outRoot, adapters: builtInDiscoveryAdapters });

    const contract = await fs.readFile(
      new URL('../contracts/event-manifest.schema.json', import.meta.url),
      'utf8',
    );

    const validate = jsonSchemaAjv('2020-12').compile(JSON.parse(contract));

    const manifest = await fs.readFile(path.join(outRoot, 'payments/a.b/autocatalog.json'), 'utf8');

    expect(validate(JSON.parse(manifest))).toBe(true);
  });

  it('never takes the conventions file itself for an event', async () => {
    await write(CONVENTIONS_PATH, {
      $schema: 'https://unpkg.com/autocatalog-docs-core/contracts/x.schema.json',
      sources: [source],
    });
    await write('sdk/event-schemas.json', { 'v1.a.b': named('v1.a.b', {}) });

    const { events } = await scanCatalog({
      root,
      outRoot: path.join(root, 'out'),
      adapters: builtInDiscoveryAdapters,
    });

    expect(events.map(({ id }) => id)).toEqual(['a.b']);
  });

  it('runs with the built-in adapters, so scan and drift both see it', () => {
    expect(builtInDiscoveryAdapters).toContain(conventionDiscoveryAdapter);
  });

  it('lists the files its sources read, and none outside the repository', async () => {
    await write(CONVENTIONS_PATH, {
      sources: [{ ...source, files: ['sdk/event-schemas.json', '../outside.json', '/etc/passwd'] }],
    });

    await expect(conventionFiles(root)).resolves.toEqual(['sdk/event-schemas.json']);
  });

  it('lists no files for a conventions file it cannot read', async () => {
    await expect(conventionFiles(root)).resolves.toEqual([]);

    await write(CONVENTIONS_PATH, { sources: [{ nope: true }] });

    await expect(conventionFiles(root)).resolves.toEqual([]);
  });

  it('publishes an event whose recursive schema has no valid placeholder', async () => {
    const tree = {
      type: 'object',
      properties: { children: { type: 'array', items: { $ref: '#' }, minItems: 1 } },
      required: ['children'],
    };

    await write(CONVENTIONS_PATH, { sources: [source] });
    await write('sdk/event-schemas.json', { 'v1.tree': tree });

    const { errors, events } = await scanCatalog({
      root,
      outRoot: path.join(root, 'out'),
      adapters: builtInDiscoveryAdapters,
    });

    expect(errors).toEqual([]);
    expect(events[0]?.examples).toEqual([]);
  });

  it('publishes a catalog whose drift sees a field removed', async () => {
    await write(CONVENTIONS_PATH, { sources: [source] });

    const scan = async (out: string, detail: Record<string, { type: string }>) => {
      await write('sdk/event-schemas.json', { 'v1.a.b': named('v1.a.b', detail) });

      const outRoot = path.join(root, out);
      const result = await scanCatalog({ root, outRoot, adapters: builtInDiscoveryAdapters });

      expect(result.errors).toEqual([]);

      return outRoot;
    };

    const before = await scan('before', { keep: { type: 'string' }, drop: { type: 'string' } });
    const after = await scan('after', { keep: { type: 'string' } });

    const { findings } = await driftCatalogs(before, after);

    expect(findings.filter(({ severity }) => severity === 'breaking')).toEqual([
      expect.objectContaining({ eventId: 'a.b', message: expect.stringContaining('detail.drop') }),
    ]);
  });
});
