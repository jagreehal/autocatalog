import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFromAsyncApi } from '../src/commands/from-asyncapi';
import { runFromEventCatalog } from '../src/commands/from-eventcatalog';

// The failure half of the on-ramp. A migration is the first thing anyone runs,
// against files they did not write, and every assertion here is about what the
// user is told when that goes wrong: never a stack trace, never a silent drop,
// always the next thing to try.

let dir: string;

let out: string;

let said: string[];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-src-'));
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-out-'));
  said = [];

  for (const stream of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, stream).mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await fs.rm(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** Everything printed, as one searchable blob. */
const output = (): string => said.join('\n');

async function write(file: string, body: string): Promise<string> {
  const target = path.join(dir, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);

  return target;
}

/** Did the importer write any event folder at all? */
async function wroteNothing(): Promise<boolean> {
  return (await fs.readdir(out)).length === 0;
}

describe('ac from-asyncapi: bad input is explained, never thrown', () => {
  it('names the file that does not exist', async () => {
    const missing = path.join(dir, 'nope.yml');
    await expect(runFromAsyncApi({ file: missing, out })).resolves.toBe(1);
    expect(output()).toContain('no such file');
    expect(output()).toContain(missing);
    expect(output()).not.toContain('ENOENT');
  });

  it('says a directory is a directory', async () => {
    await expect(runFromAsyncApi({ file: dir, out })).resolves.toBe(1);
    expect(output()).toContain('is a directory');
  });

  it('reports unparseable YAML as YAML, with the parser’s reason', async () => {
    const file = await write('broken.yml', 'asyncapi: 2.0.0\nchannels:\n  - [unclosed\n');
    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('is not valid YAML');
    expect(output()).toContain(file);
  });

  it('reports unparseable JSON as JSON', async () => {
    const file = await write('broken.json', '{ "asyncapi": "2.0.0", }{');
    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('is not valid JSON');
  });

  it('asks the obvious question when handed a document that is not AsyncAPI', async () => {
    // Being pointed at an OpenAPI spec is the single likeliest mistake.
    const file = await write('openapi.yml', 'openapi: 3.0.0\npaths: {}\n');
    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('is this an AsyncAPI document?');
  });

  it('rejects a document that is not an object at all', async () => {
    const file = await write('list.yml', '- one\n- two\n');
    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('does not contain an AsyncAPI document');
  });

  it('names the versions it does support', async () => {
    const file = await write('old.yml', 'asyncapi: 1.2.0\nchannels: {}\n');
    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('2.x and 3.x are supported');
  });

  it('explains an empty document instead of exiting 1 in silence', async () => {
    const file = await write(
      'empty.yml',
      'asyncapi: 2.6.0\ninfo:\n  title: Nothing\nchannels: {}\n',
    );

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('nothing to import');
    expect(output()).toContain('declares no channels with messages');
  });
});

describe('ac from-asyncapi: a broken part never costs the whole import', () => {
  const withOneBadRef = `
asyncapi: 2.6.0
info:
  title: Orders Service
  version: 3.0.0
channels:
  orders/placed:
    subscribe:
      message:
        name: OrderPlaced
        payload:
          type: object
          properties:
            id: { type: string }
  orders/broken:
    subscribe:
      message:
        $ref: '#/components/messages/DoesNotExist'
`;

  it('imports the good message and says why the other was skipped', async () => {
    const file = await write('partial.yml', withOneBadRef);

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(0);
    expect(await fs.readdir(path.join(out, 'orders'))).toContain('OrderPlaced');

    const text = output();
    expect(text).toContain('skipped');
    expect(text).toContain('orders/broken');
    expect(text).toContain('unresolvable $ref');
    // The count is the part someone scanning a long log actually sees.
    expect(text).toContain('1 skipped');
    expect(text).toContain('the catalog is incomplete');
  });

  it('does not hang or crash on a circular $ref', async () => {
    const file = await write(
      'circular.yml',
      `
asyncapi: 2.6.0
info: { title: Loop, version: 1.0.0 }
channels:
  loop:
    subscribe:
      message:
        $ref: '#/components/messages/A'
components:
  messages:
    A:
      $ref: '#/components/messages/A'
`,
    );

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('circular $ref');
  });

  it('reports a v3 operation whose channel is missing, rather than dropping it', async () => {
    // The silent-drop bug: the user gets a catalog that looks complete.
    const file = await write(
      'v3-dangling.yml',
      `
asyncapi: 3.0.0
info: { title: Orders Service, version: 1.0.0 }
channels:
  placed:
    address: orders/placed
    messages:
      OrderPlaced:
        name: OrderPlaced
        payload: { type: object }
operations:
  sendPlaced:
    action: send
    channel: { $ref: '#/channels/placed' }
  sendGhost:
    action: send
    channel: { $ref: '#/channels/removedLastWeek' }
`,
    );

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(0);
    const text = output();
    expect(text).toContain('sendGhost');
    expect(text).toContain('not found');
    expect(text).toContain('1 skipped');
  });

  it('keeps a v3 channel’s good messages when one of them has a broken $ref', async () => {
    const file = await write(
      'v3-broken-message.yml',
      `
asyncapi: 3.0.0
info: { title: Orders Service, version: 1.0.0 }
channels:
  placed:
    address: orders/placed
    messages:
      OrderPlaced:
        name: OrderPlaced
        payload: { type: object }
      OrderBroken:
        $ref: '#/components/messages/goneAway'
operations:
  sendPlaced:
    action: send
    channel: { $ref: '#/channels/placed' }
`,
    );

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(0);
    expect(await fs.readdir(out)).not.toHaveLength(0);
    const text = output();
    expect(text).toContain('OrderBroken');
    expect(text).toContain('1 skipped');
  });

  it('skips a message with no usable name instead of writing a nameless folder', async () => {
    const file = await write(
      'nameless.yml',
      `
asyncapi: 2.6.0
info: { title: Odd, version: 1.0.0 }
channels:
  '///':
    subscribe:
      message:
        payload: { type: object }
`,
    );

    await expect(runFromAsyncApi({ file, out })).resolves.toBe(1);
    expect(output()).toContain('no usable name');
    expect(await wroteNothing()).toBe(true);
  });
});

describe('ac from-eventcatalog: bad input is explained, never thrown', () => {
  it('says the path does not exist, rather than that the catalog is empty', async () => {
    // The old behaviour told a user with a typo that they had no events.
    const missing = path.join(dir, 'not-here');
    await expect(runFromEventCatalog({ source: missing, out })).resolves.toBe(1);
    expect(output()).toContain('no such directory');
    expect(output()).toContain(missing);
    expect(output()).not.toContain('No EventCatalog events found');
  });

  it('says a file is not a project root', async () => {
    const file = await write('catalog.md', '# not a project\n');
    await expect(runFromEventCatalog({ source: file, out })).resolves.toBe(1);
    expect(output()).toContain('is not a directory');
  });

  it('tells an empty project what it was looking for', async () => {
    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(1);
    expect(output()).toContain('nothing to import');
    expect(output()).toContain('events/<Name>/index.md(x)');
  });
});

describe('ac from-eventcatalog: a broken document never costs the whole import', () => {
  async function goodEvent(name: string, id: string): Promise<void> {
    await write(
      `events/${name}/index.md`,
      `---\nid: ${id}\nversion: 1.0.0\nname: ${name}\n---\n\nNarrative.\n`,
    );
  }

  it('skips an event whose schema.json is not valid JSON, and keeps the rest', async () => {
    await goodEvent('OrderPlaced', 'order.placed');
    await goodEvent('OrderShipped', 'order.shipped');
    await write('events/OrderShipped/schema.json', '{ "type": "object", }}');

    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(0);

    expect(await fs.readdir(path.join(out, 'order'))).toEqual(['OrderPlaced']);
    const text = output();
    expect(text).toContain('is not valid JSON');
    expect(text).toContain('order.shipped');
    expect(text).toContain('1 skipped');
  });

  it('never reads a file a symlink in the catalog points outside it at', async () => {
    // A catalog from another repository must not copy this machine's files into ours.
    const secrets = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-secret-'));

    try {
      await fs.writeFile(path.join(secrets, 'secret.json'), '{"token":"TOPSECRET"}');
      await fs.writeFile(
        path.join(secrets, 'index.md'),
        '---\nid: leak.page\nversion: 1.0.0\n---\n\nTOPSECRET\n',
      );

      await goodEvent('OrderPlaced', 'order.placed');
      await fs.symlink(
        path.join(secrets, 'secret.json'),
        path.join(dir, 'events/OrderPlaced/schema.json'),
      );
      await goodEvent('OrderShipped', 'order.shipped');
      await fs.mkdir(path.join(dir, 'events/OrderShipped/examples'));
      await fs.symlink(
        path.join(secrets, 'secret.json'),
        path.join(dir, 'events/OrderShipped/examples/leak.json'),
      );
      await fs.mkdir(path.join(dir, 'events/LeakPage'));
      await fs.symlink(path.join(secrets, 'index.md'), path.join(dir, 'events/LeakPage/index.md'));
      // A team page whose name would land on every event the team owns.
      await fs.writeFile(path.join(secrets, 'team.md'), '---\nid: leak\nname: TOPSECRET\n---\n');
      await write(
        'events/Owned/index.md',
        '---\nid: owned\nversion: 1.0.0\nowners:\n  - leak\n---\n\nNarrative.\n',
      );
      await fs.mkdir(path.join(dir, 'teams'));
      await fs.symlink(path.join(secrets, 'team.md'), path.join(dir, 'teams/leak.md'));

      await runFromEventCatalog({ source: dir, out });

      const written = await fs.readdir(out, { recursive: true });

      for (const file of written) {
        const full = path.join(out, file);

        if ((await fs.stat(full)).isFile())
          expect(await fs.readFile(full, 'utf8'), file).not.toContain('TOPSECRET');
      }

      expect(output()).toContain('outside the catalog');
    } finally {
      await fs.rm(secrets, { recursive: true, force: true });
    }
  });

  it('skips a schema.json that parses but is not a schema object', async () => {
    await goodEvent('OrderPlaced', 'order.placed');
    await write('events/OrderPlaced/schema.json', '["not", "a", "schema"]');

    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(1);
    expect(output()).toContain('is not a JSON Schema object');
  });

  it('skips a document with unparseable frontmatter, naming the file', async () => {
    await goodEvent('OrderPlaced', 'order.placed');
    const bad = await write('events/Broken/index.md', '---\nid: [unclosed\n---\n\nBody.\n');

    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(0);
    expect(output()).toContain(bad);
    expect(await fs.readdir(path.join(out, 'order'))).toEqual(['OrderPlaced']);
  });

  it('ignores a document with no id or version without calling it an error', async () => {
    await goodEvent('OrderPlaced', 'order.placed');
    // EventCatalog projects are full of index.md files that are not events.
    await write('events/README/index.md', '---\ntitle: About these events\n---\n\nProse.\n');

    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(0);
    expect(output()).not.toContain('skipped');
  });

  it('reports a placeholder schema as a caveat, not as a skip', async () => {
    await goodEvent('OrderPlaced', 'order.placed');

    await expect(runFromEventCatalog({ source: dir, out })).resolves.toBe(0);
    const text = output();
    expect(text).toContain('no schema declared');
    expect(text).not.toContain('1 skipped');
  });

  it('ends on the next command, so the migration does not stop at a count', async () => {
    await goodEvent('OrderPlaced', 'order.placed');

    await runFromEventCatalog({ source: dir, out });
    expect(output()).toContain('Next: ac validate');
  });

  it('says to commit what it wrote, because nothing regenerates it', async () => {
    await goodEvent('OrderPlaced', 'order.placed');

    await runFromEventCatalog({ source: dir, out });
    expect(output()).toContain(`Commit ${out}`);
    expect(output()).toContain('nothing regenerates it');
  });
});

describe('--strict, for a migration running in CI', () => {
  it('still exits 0 by default when something was skipped, so a person can keep going', async () => {
    const file = await write(
      'partial.yml',
      `
asyncapi: 2.6.0
info: { title: Orders, version: 1.0.0 }
channels:
  orders/placed:
    subscribe:
      message: { name: OrderPlaced, payload: { type: object } }
  orders/broken:
    subscribe:
      message: { $ref: '#/components/messages/Missing' }
`,
    );

    expect(await runFromAsyncApi({ file, out, quiet: true })).toBe(0);
  });

  it('fails the pipeline when anything was skipped', async () => {
    const file = await write(
      'partial.yml',
      `
asyncapi: 2.6.0
info: { title: Orders, version: 1.0.0 }
channels:
  orders/placed:
    subscribe:
      message: { name: OrderPlaced, payload: { type: object } }
  orders/broken:
    subscribe:
      message: { $ref: '#/components/messages/Missing' }
`,
    );

    // The catalog is still written — the exit code is the signal, not a rollback.
    expect(await runFromAsyncApi({ file, out, quiet: true, strict: true })).toBe(1);
    expect(await fs.readdir(path.join(out, 'orders'))).toContain('OrderPlaced');
  });

  it('passes under --strict when nothing was skipped', async () => {
    const file = await write(
      'clean.yml',
      `
asyncapi: 2.6.0
info: { title: Orders, version: 1.0.0 }
channels:
  orders/placed:
    subscribe:
      message: { name: OrderPlaced, payload: { type: object } }
`,
    );

    expect(await runFromAsyncApi({ file, out, quiet: true, strict: true })).toBe(0);
  });

  it('fails an EventCatalog migration that skipped a document', async () => {
    await write('events/OrderPlaced/index.md', '---\nid: order.placed\nversion: 1.0.0\n---\n\nx\n');
    await write(
      'events/OrderShipped/index.md',
      '---\nid: order.shipped\nversion: 1.0.0\n---\n\nx\n',
    );
    await write('events/OrderShipped/schema.json', '{ not json }');

    expect(await runFromEventCatalog({ source: dir, out, quiet: true })).toBe(0);
    expect(await runFromEventCatalog({ source: dir, out, quiet: true, strict: true })).toBe(1);
  });
});
