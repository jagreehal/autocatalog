import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import utils from '@eventcatalog/sdk';
import autocatalogGenerator from '../src/eventcatalog';

const here = path.dirname(fileURLToPath(import.meta.url));

const jsonSchemaRepo = path.resolve(here, '../../../../fixtures/json-schema-repo');

const zodRepo = path.resolve(here, '../../../../fixtures/demo-repo');

// EventCatalog runs each generator from its project, with PROJECT_DIR set.

let catalog: string;

beforeEach(async () => {
  catalog = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-generator-'));
  vi.stubEnv('PROJECT_DIR', catalog);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await fs.rm(catalog, { recursive: true, force: true });
});

describe('the EventCatalog generator', () => {
  it('scans a repository the way ac scan does, and writes its events', async () => {
    await autocatalogGenerator({}, { repositories: [jsonSchemaRepo] });

    const ids = ((await utils(catalog).getEvents()) ?? []).map((event) => event.id).sort();

    expect(ids).toEqual(['refund.issued', 'shipment.dispatched']);
  });

  it('fails the EventCatalog run when a repository cannot be scanned', async () => {
    await expect(
      autocatalogGenerator({}, { repositories: [path.join(catalog, 'missing')] }),
    ).rejects.toThrow(/missing/);

    // EventCatalog logs a generator's error and carries on; the exit code is
    // what fails the build.
    expect(process.exitCode).toBe(1);
  });

  it('runs the Zod adapter a repository installs, once code execution is allowed', async () => {
    await autocatalogGenerator({}, { repositories: [zodRepo], allowCodeExecution: true });

    const ids = ((await utils(catalog).getEvents()) ?? []).map((event) => event.id);

    expect(ids).toContain('payment.completed');
  });

  it('says which option allows code execution, in the words of the config file', async () => {
    await expect(autocatalogGenerator({}, { repositories: [zodRepo] })).rejects.toThrow(
      /autocatalog-adapter-zod.*allowCodeExecution: true/,
    );
  });

  it('asks for a repository or a published events root', async () => {
    await expect(autocatalogGenerator({}, {})).rejects.toThrow(/repositories.*roots/);
  });
});
