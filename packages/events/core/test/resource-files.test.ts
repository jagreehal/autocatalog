import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCommandResources } from '../src/command-resources';
import {
  readOptionalResourceJson,
  readResourceJson,
  readResourceSource,
  ResourceReadError,
} from '../src/resource-files';
import { readResourceGraph } from '../src/resource-store';
import { scanArchitecture } from '../src/scan-architecture';

const SECRET = 'AWS_SECRET=hunter2-do-not-publish';

let work: string;

let root: string;

let outside: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-files-'));
  root = path.join(work, 'repo');
  outside = path.join(work, 'outside');
  await fs.mkdir(path.join(root, '.autocatalog'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.env'), SECRET);
  await fs.writeFile(path.join(outside, 'schema.json'), JSON.stringify({ secret: SECRET }));
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

const link = (target: string, at: string) => fs.symlink(target, path.join(root, at));

async function rejection(promise: Promise<unknown>): Promise<ResourceReadError> {
  const error = await promise.then(
    () => undefined,
    (reason: Error) => reason,
  );

  expect(error).toBeInstanceOf(ResourceReadError);
  expect(String(error)).not.toContain('hunter2');

  // SAFETY: the instanceof assertion above fails the test for anything else.
  return error as ResourceReadError;
}

describe('readResourceSource', () => {
  it('reads a regular file inside the repository', async () => {
    await fs.writeFile(path.join(root, 'a.json'), '{"a":1}');

    expect(await readResourceJson(path.join(root, 'a.json'), { root })).toEqual({ a: 1 });
  });

  it('refuses a symlink, even one that points inside the repository', async () => {
    await fs.writeFile(path.join(root, 'real.json'), '{}');
    await link(path.join(root, 'real.json'), 'alias.json');
    await link(path.join(outside, 'secret.env'), 'secret.json');

    for (const file of ['alias.json', 'secret.json']) {
      const error = await rejection(readResourceSource(path.join(root, file), { root }));

      expect(error.reason).toBe('outside');
      expect(error.message).toBe(
        `${file}: not a regular file inside the repository, so it is not read`,
      );
    }
  });

  it('refuses a file reached through a symlinked directory', async () => {
    await link(outside, 'linked');

    const error = await rejection(
      readResourceSource(path.join(root, 'linked/schema.json'), { root }),
    );

    expect(error.reason).toBe('outside');
  });

  it('refuses a file over the size limit without reading it', async () => {
    await fs.writeFile(path.join(root, 'big.json'), 'x'.repeat(11));

    const error = await rejection(
      readResourceSource(path.join(root, 'big.json'), { root, maxFileBytes: 10 }),
    );

    expect(error).toMatchObject({ reason: 'too-large', message: 'big.json: larger than 10 bytes' });
  });

  it('names a file that is not JSON without quoting it', async () => {
    await fs.writeFile(path.join(root, 'bad.json'), SECRET);

    const error = await rejection(readResourceJson(path.join(root, 'bad.json'), { root }));

    expect(error).toMatchObject({ reason: 'not-json', message: 'bad.json: not valid JSON' });
  });

  it('treats only a missing file as optional', async () => {
    expect(await readOptionalResourceJson(path.join(root, 'none.json'), { root })).toBeUndefined();

    await link(path.join(outside, 'secret.env'), 'present.json');
    await rejection(readOptionalResourceJson(path.join(root, 'present.json'), { root }));
  });
});

describe('every resource reader goes through it', () => {
  it('does not read a resource graph that is a symlink', async () => {
    await link(path.join(outside, 'secret.env'), '.autocatalog/resources.json');

    await rejection(readResourceGraph(root));
  });

  it('does not read a config, model export or import record that is a symlink', async () => {
    for (const file of ['config.json', 'models.json', 'imports/backstage.json']) {
      await fs.rm(path.join(root, '.autocatalog'), { recursive: true, force: true });
      await fs.mkdir(path.join(root, '.autocatalog/imports'), { recursive: true });
      await link(path.join(outside, 'secret.env'), `.autocatalog/${file}`);

      const scan = scanArchitecture({ root, datastore: 'main', database: 'app' });

      const outcome = await scan.then(
        (result) => result.errors.join('\n'),
        (error: Error) => error.message,
      );

      expect(outcome, file).toContain(`.autocatalog/${file}: not a regular file inside`);
      expect(outcome, file).not.toContain('hunter2');
    }
  });

  it('does not copy a command schema that is a symlink out of the repository', async () => {
    const folder = path.join(root, 'commands/generate-statement');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        kind: 'command',
        id: 'generate-statement',
        version: '1.0.0',
        name: 'Generate statement',
        summary: 'Builds a customer statement.',
        schema: 'schema.json',
      }),
    );
    await fs.symlink(path.join(outside, 'schema.json'), path.join(folder, 'schema.json'));

    const result = await scanCommandResources({ root });

    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(result.errors).toEqual([
      expect.stringContaining(
        'commands/generate-statement/schema.json: not a regular file inside the repository',
      ),
    ]);
  });
});

describe('a resource file that reads but is not what it should be', () => {
  it('names the graph file and the first contract violation', async () => {
    await fs.writeFile(
      path.join(root, '.autocatalog/resources.json'),
      JSON.stringify({ spec: 'autocatalog/graph-v1', resources: [{}], relationships: [] }),
    );

    const error = await rejection(readResourceGraph(root));

    expect(error).toMatchObject({
      reason: 'invalid',
      message:
        ".autocatalog/resources.json: does not match the resource graph contract (/resources/0: must have required property 'ref')",
    });
  });

  it('names an import record that does not parse, and where', async () => {
    await fs.mkdir(path.join(root, '.autocatalog/imports'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.autocatalog/imports/backstage.json'),
      JSON.stringify({
        graph: { spec: 'autocatalog/graph-v1', resources: [], relationships: [] },
        claims: [{}],
      }),
    );

    const result = await scanArchitecture({ root, publish: false });

    expect(result.errors).toEqual([
      '.autocatalog/imports/backstage.json: not an import record (claims.0.resource: Invalid input: expected object, received undefined)',
    ]);
  });
});
