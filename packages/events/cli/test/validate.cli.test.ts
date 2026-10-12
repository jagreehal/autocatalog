import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
