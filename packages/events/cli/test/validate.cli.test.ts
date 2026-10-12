import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runValidate } from '../src/commands/validate';

const here = path.dirname(fileURLToPath(import.meta.url));

const goodRoot = path.resolve(here, '../../core/test/fixtures/basic-catalog');

const dupeRoot = path.resolve(here, '../../core/test/fixtures/duplicate-catalog');

describe('runValidate', () => {
  it('returns exit code 0 for a valid catalog', async () => {
    const exit = await runValidate({ cwd: goodRoot, quiet: true });
    expect(exit).toBe(0);
  });

  it('returns exit code 0 for cross-domain duplicate ids/versions', async () => {
    const exit = await runValidate({ cwd: dupeRoot, quiet: true });
    expect(exit).toBe(0);
  });

  it('returns exit code 1 for same-domain duplicates', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/bad-duplicate-cli');
    const eventsRoot = path.join(tmpRoot, 'events');
    const a = path.join(eventsRoot, 'payments/FooA');
    const b = path.join(eventsRoot, 'payments/FooB');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });

    const manifest = JSON.stringify({
      id: 'foo',
      version: '1.0.0',
      name: 'Foo',
      summary: 'duplicate',
    });

    const schema =
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }';

    await fs.writeFile(path.join(a, 'autocatalog.json'), manifest);
    await fs.writeFile(path.join(a, 'schema.json'), schema);
    await fs.writeFile(path.join(b, 'autocatalog.json'), manifest);
    await fs.writeFile(path.join(b, 'schema.json'), schema);

    const exit = await runValidate({ cwd: tmpRoot, quiet: true });
    expect(exit).toBe(1);

    await fs.rm(tmpRoot, { recursive: true });
  });

  it('returns exit code 1 with --strict-warnings when only warnings exist', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/non-semver-cli');
    const evt = path.join(tmpRoot, 'events/payments/Legacy');
    await fs.mkdir(evt, { recursive: true });
    await fs.writeFile(
      path.join(evt, 'autocatalog.json'),
      JSON.stringify({ id: 'legacy', version: 'latest', name: 'Legacy', summary: 'warning only' }),
    );
    await fs.writeFile(
      path.join(evt, 'schema.json'),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" }',
    );

    const normalExit = await runValidate({ cwd: tmpRoot, quiet: true });
    expect(normalExit).toBe(0);

    const strictExit = await runValidate({ cwd: tmpRoot, quiet: true, strictWarnings: true });
    expect(strictExit).toBe(1);

    await fs.rm(tmpRoot, { recursive: true });
  });

  it('enforces contracts/event-manifest.json when the project has one', async () => {
    const fs = await import('node:fs/promises');
    const tmpRoot = path.join(here, 'fixtures/policy-cli');
    await fs.cp(path.join(goodRoot, 'events'), path.join(tmpRoot, 'events'), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, 'contracts'), { recursive: true });
    const contract = path.join(tmpRoot, 'contracts/event-manifest.json');

    await fs.writeFile(contract, JSON.stringify({ required: ['classification'] }));
    expect(await runValidate({ cwd: tmpRoot, quiet: true })).toBe(1);

    await fs.writeFile(contract, JSON.stringify({ required: ['id'] }));
    expect(await runValidate({ cwd: tmpRoot, quiet: true })).toBe(0);

    await fs.rm(tmpRoot, { recursive: true });
  });
});

describe('runValidate: what this repository consumes', () => {
  let work: string;

  let site: string;

  const graph = {
    spec: 'autocatalog/graph-v1',
    resources: [
      {
        ref: {
          kind: 'event',
          namespace: 'payments-service/payments',
          id: 'payment.completed',
          version: '1.0.0',
        },
        title: 'Payment completed',
        tags: [],
        provenance: { default: 'declared', fields: {} },
        needsReview: false,
        attributes: { domain: 'payments', status: 'active', schema: 'schema.json', examples: 0 },
      },
    ],
    relationships: [],
  };

  const schema = { type: 'object', properties: { amount: { type: 'number' } } };

  beforeEach(async () => {
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-validate-consumes-'));
    site = path.join(work, 'site');
    // A built company site: the graph, and each event's schema beside it.
    await fs.mkdir(path.join(site, 'events/payments-service/payments/payment.completed'), {
      recursive: true,
    });
    await fs.writeFile(path.join(site, 'catalog.json'), JSON.stringify(graph));
    await fs.writeFile(
      path.join(site, 'events/payments-service/payments/payment.completed/schema.json'),
      JSON.stringify(schema),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(work, { recursive: true, force: true });
  });

  const declare = (fields: string[]) =>
    fs.writeFile(
      path.join(work, 'autocatalog.consumes.json'),
      JSON.stringify({
        consumes: [{ service: 'LedgerService', event: 'payments/payment.completed', fields }],
      }),
    );

  const validate = async (catalog?: string) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await runValidate({ cwd: work, catalog });
    const said = [...log.mock.calls, ...error.mock.calls].map((call) => String(call[0]));

    return { exit, said: said.join('\n') };
  };

  it('passes a repository that only consumes, with no events of its own', async () => {
    await declare(['amount']);

    expect((await validate()).exit).toBe(0);
  });

  it('refuses a consumes file that is not one, naming it', async () => {
    await fs.writeFile(
      path.join(work, 'autocatalog.consumes.json'),
      '{"consumes":[{"event":"x"}]}',
    );

    const { exit, said } = await validate();

    expect(exit).toBe(1);
    expect(said).toContain('autocatalog.consumes.json');
  });

  it('checks each field it reads against the schema the producer publishes', async () => {
    await declare(['amount']);
    expect((await validate(path.join(site, 'catalog.json'))).exit).toBe(0);

    await declare(['amout']);

    const { exit, said } = await validate(path.join(site, 'catalog.json'));

    expect(exit).toBe(1);
    expect(said).toContain(
      'LedgerService reads `amout` of payments/payment.completed, which payments-service does not publish',
    );
  });

  it('reads no schema outside the site, whatever the graph names', async () => {
    // A graph from elsewhere names its repository as a path out of the site.
    await fs.mkdir(path.join(work, 'outside/payments/payment.completed'), { recursive: true });
    await fs.writeFile(
      path.join(work, 'outside/payments/payment.completed/schema.json'),
      JSON.stringify({ type: 'object', properties: { secret: { type: 'string' } } }),
    );
    await fs.writeFile(
      path.join(site, 'catalog.json'),
      JSON.stringify({
        ...graph,
        resources: graph.resources.map((resource) => ({
          ...resource,
          ref: { ...resource.ref, namespace: '../../outside/payments' },
        })),
      }),
    );
    await declare(['secret']);

    const { exit, said } = await validate(path.join(site, 'catalog.json'));

    expect(exit).toBe(1);
    expect(said).toContain('could not be read');
  });

  it('reads the graph and the schemas from the company site', async () => {
    await declare(['amout']);

    const server = http.createServer(async (request, response) => {
      const file = path.join(site, decodeURIComponent(request.url ?? '/'));
      const body = await fs.readFile(file, 'utf8').catch(() => undefined);

      response.statusCode = body === undefined ? 404 : 200;
      response.end(body ?? '');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    // SAFETY: a server listening on a TCP port reports an AddressInfo.
    const { port } = server.address() as AddressInfo;

    try {
      const { exit, said } = await validate(`http://127.0.0.1:${port}/catalog.json`);

      expect(exit).toBe(1);
      expect(said).toContain('reads `amout`');
    } finally {
      server.close();
    }
  });
});
