import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue } from 'autocatalog-core';
import { describeContractChanges, syncFrontmatterContract } from '../src/sync';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-sync-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const CANONICAL = 'https://handbook.acme.test/contracts/docs-frontmatter.json';

/** A contract that does not record where it came from. */
const unpublished = (extra: JsonObject = {}) =>
  ({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['title', 'owner'],
    properties: { title: { type: 'string' }, owner: { type: 'string' } },
    additionalProperties: true,
    ...extra,
  }) satisfies JsonObject;

const contract = (extra: JsonObject = {}) => unpublished({ $id: CANONICAL, ...extra });

async function writeLocal(schema: JsonObject): Promise<string> {
  const file = path.join(root, 'contracts/docs-frontmatter.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(schema, null, 2));

  return file;
}

/** Upstream, served without a network. */
const serving =
  (schema: JsonValue) =>
  async (url: string): Promise<JsonValue> => {
    if (url !== CANONICAL) throw new Error(`unexpected url ${url}`);

    return schema;
  };

describe('syncFrontmatterContract', () => {
  it('reports a copy that still matches the organisation', async () => {
    await writeLocal(contract());

    const result = await syncFrontmatterContract(root, { fetchJson: serving(contract()) });
    expect(result.status).toBe('in-sync');
    expect(result.source).toBe(CANONICAL);
  });

  it('finds the source in $id, so CI needs no configuration', async () => {
    await writeLocal(contract());

    // $id is the standard keyword for where a schema is published; nothing new
    // had to be invented for a repository to know where its copy came from.
    const result = await syncFrontmatterContract(root, {
      fetchJson: serving(contract({ properties: { title: { type: 'string' } } })),
    });

    expect(result.source).toBe(CANONICAL);
    expect(result.status).toBe('drifted');
  });

  it('names the drift in the order that matters, newly-required first', async () => {
    await writeLocal(contract());

    const upstream = contract({
      required: ['title', 'owner', 'tier'],
      properties: {
        title: { type: 'string' },
        owner: { enum: ['Payments', 'Reliability'] },
        tier: { enum: ['critical', 'standard'] },
      },
      additionalProperties: false,
    });

    const result = await syncFrontmatterContract(root, { fetchJson: serving(upstream) });
    expect(result.status).toBe('drifted');
    expect(result.changes).toContain('+ field tier');
    expect(result.changes).toContain('~ field owner changed');
    expect(result.changes).toContain('! tier is now required');
    expect(result.changes).toContain('! the contract is now closed (additionalProperties: false)');
  });

  it('leaves the local copy alone unless asked to write', async () => {
    const file = await writeLocal(contract());
    const before = await fs.readFile(file, 'utf8');

    await syncFrontmatterContract(root, { fetchJson: serving(contract({ title: 'Renamed' })) });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('takes the upstream contract with --write', async () => {
    const file = await writeLocal(contract());
    const upstream = contract({ required: ['title', 'owner', 'tier'] });

    const result = await syncFrontmatterContract(root, {
      write: true,
      fetchJson: serving(upstream),
    });

    expect(result.status).toBe('written');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(upstream);
  });

  it('syncs against a sibling checkout without any network at all', async () => {
    await writeLocal(unpublished());
    const upstreamFile = path.join(root, 'handbook/contracts/docs-frontmatter.json');
    await fs.mkdir(path.dirname(upstreamFile), { recursive: true });
    await fs.writeFile(upstreamFile, JSON.stringify(unpublished()));

    const result = await syncFrontmatterContract(root, { from: upstreamFile });
    expect(result.status).toBe('in-sync');
  });

  it('says so when there is no local copy to compare', async () => {
    expect((await syncFrontmatterContract(root)).status).toBe('missing-local');
  });

  it('says so when the copy does not record where it came from', async () => {
    await writeLocal(unpublished());
    expect((await syncFrontmatterContract(root)).status).toBe('no-source');
  });

  it('fails loudly when upstream cannot be read, never quietly passes', async () => {
    await writeLocal(contract());

    // A sync that could not reach the source has verified nothing. Reporting
    // in-sync here would make the whole command worthless.
    const result = await syncFrontmatterContract(root, {
      fetchJson: async () => {
        throw new Error('getaddrinfo ENOTFOUND handbook.acme.test');
      },
    });

    expect(result.status).toBe('unreachable');
    expect(result.error).toContain('ENOTFOUND');
  });

  it('rejects a source that is not a schema object', async () => {
    await writeLocal(contract());
    const result = await syncFrontmatterContract(root, { fetchJson: serving(['not', 'a schema']) });
    expect(result.status).toBe('unreachable');
    expect(result.error).toContain('not a JSON Schema object');
  });

  it('does not call a reordered copy drifted, because key order means nothing', async () => {
    await writeLocal(contract());

    const reordered = {
      properties: { owner: { type: 'string' }, title: { type: 'string' } },
      required: ['title', 'owner'],
      type: 'object',
      $id: CANONICAL,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: true,
    };

    const result = await syncFrontmatterContract(root, { fetchJson: serving(reordered) });
    expect(result.status).toBe('in-sync');
  });

  it('does not call a difference in-sync just because the summary is empty', async () => {
    await writeLocal(contract());

    // `title` is not a field, so describeContractChanges says nothing about it.
    const result = await syncFrontmatterContract(root, {
      fetchJson: serving(contract({ title: 'Acme documentation frontmatter' })),
    });

    expect(result.status).toBe('drifted');
    expect(result.changes).toEqual([]);
  });
});

describe('describeContractChanges', () => {
  it('reports a removed field as removed upstream, not as a local addition', async () => {
    const changes = describeContractChanges(
      { properties: { title: {}, legacy: {} } },
      { properties: { title: {} } },
    );

    expect(changes).toEqual(['- field legacy removed upstream']);
  });

  it('reports a relaxed requirement without alarm', () => {
    const changes = describeContractChanges(
      { required: ['title', 'tier'] },
      { required: ['title'] },
    );

    expect(changes).toEqual(['~ tier is no longer required']);
  });
});
