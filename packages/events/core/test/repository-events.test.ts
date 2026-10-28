import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  builtInDiscoveryAdapters,
  findCatalogRoots,
  loadRepositoryEvents,
  isSingleRepository,
  publishesCatalogContent,
  scanCatalog,
} from '../src';

let repo: string;

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-repository-'));
});

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

it('enrols a repository that publishes only contracts/', async () => {
  expect(publishesCatalogContent(repo)).toBe(false);
  await fs.mkdir(path.join(repo, 'contracts'));
  expect(publishesCatalogContent(repo)).toBe(true);
});

it('enrols a repository that has only a Prisma schema', async () => {
  await fs.mkdir(path.join(repo, 'prisma'));
  expect(publishesCatalogContent(repo)).toBe(false);
  await fs.writeFile(path.join(repo, 'prisma/schema.prisma'), 'model A {\n  id Int @id\n}');
  expect(publishesCatalogContent(repo)).toBe(true);
});

it('enrols a package that publishes only approved message contracts', async () => {
  await fs.mkdir(path.join(repo, 'src/__contracts__'), { recursive: true });
  await fs.writeFile(path.join(repo, 'package.json'), '{}');
  await fs.writeFile(path.join(repo, 'src/__contracts__/notes.txt'), '{}');
  expect(publishesCatalogContent(repo)).toBe(false);
  await fs.writeFile(path.join(repo, 'src/__contracts__/OrderPlaced.approved.txt'), '{}');
  expect(publishesCatalogContent(repo)).toBe(true);
});

it('reads a package with only approved message contracts as one repository, not its src/', async () => {
  await fs.mkdir(path.join(repo, 'src/__contracts__'), { recursive: true });
  await fs.writeFile(path.join(repo, 'src/__contracts__/OrderPlaced.approved.txt'), '{}');
  // Without a marker it could as well be a folder holding a checkout called src.
  expect(isSingleRepository(repo)).toBe(false);
  await fs.writeFile(path.join(repo, 'package.json'), '{}');
  expect(isSingleRepository(repo)).toBe(true);
  // A folder of checkouts with a package.json of its own is still a folder of checkouts.
  await fs.mkdir(path.join(repo, 'src/.git'));
  expect(isSingleRepository(repo)).toBe(false);
});

const writeGraph = async (dir: string, resources: object[]) => {
  await fs.mkdir(path.join(dir, '.autocatalog'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.autocatalog/resources.json'),
    JSON.stringify({ spec: 'autocatalog/graph-v1', resources, relationships: [] }),
  );
};

const statements = {
  ref: { kind: 'collection', namespace: 'main/finance', id: 'statements' },
  title: 'statements',
  tags: [],
  provenance: { default: 'inferred', fields: {} },
  needsReview: true,
  attributes: {},
};

it('enrols a repository by its resource graph only when the graph holds a resource', async () => {
  await writeGraph(repo, []);
  expect(publishesCatalogContent(repo)).toBe(false);
  await writeGraph(repo, [statements]);
  expect(publishesCatalogContent(repo)).toBe(true);
});

it('reads a resource graph as one repository only like message contracts', async () => {
  await writeGraph(repo, [statements]);
  // Without a marker it could as well be an aggregation root someone scanned.
  expect(isSingleRepository(repo)).toBe(false);
  await fs.writeFile(path.join(repo, 'package.json'), '{}');
  expect(isSingleRepository(repo)).toBe(true);
  await writeGraph(repo, []);
  expect(isSingleRepository(repo)).toBe(false);
});

it('keeps an aggregation root holding a resource graph a folder of checkouts', async () => {
  await fs.mkdir(path.join(repo, '.git'));
  await writeGraph(repo, [statements]);
  await fs.mkdir(path.join(repo, 'billing/.git'), { recursive: true });
  await fs.mkdir(path.join(repo, 'billing/contracts'));
  expect(isSingleRepository(repo)).toBe(false);
  expect(publishesCatalogContent(path.join(repo, 'billing'))).toBe(true);
});

it('finds the events in committed contracts when there is no events/ catalog', async () => {
  await fs.mkdir(path.join(repo, 'contracts/events'), { recursive: true });
  await fs.writeFile(
    path.join(repo, 'contracts/events/order.placed.json'),
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'OrderPlaced',
      type: 'object',
      properties: { orderId: { type: 'string' } },
    }),
  );

  const events = await loadRepositoryEvents(repo);

  expect(events.map((event) => event.frontmatter.id)).toEqual(['order.placed']);
});

it('never reads a contract that is a symlink, which could name any file on this machine', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

  try {
    await fs.writeFile(
      path.join(outside, 'secret.json'),
      JSON.stringify({
        title: 'Secret',
        type: 'object',
        properties: { token: { type: 'string' } },
      }),
    );
    await fs.mkdir(path.join(repo, 'contracts/events'), { recursive: true });
    await fs.symlink(
      path.join(outside, 'secret.json'),
      path.join(repo, 'contracts/events/leak.json'),
    );

    expect(await loadRepositoryEvents(repo)).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

it('scans only contracts/, so a stray schema elsewhere is never published', async () => {
  await fs.mkdir(path.join(repo, 'contracts'));
  await fs.mkdir(path.join(repo, 'test'));
  await fs.writeFile(
    path.join(repo, 'test/stray.json'),
    JSON.stringify({ title: 'Stray', type: 'object', properties: { x: { type: 'string' } } }),
  );

  expect(await loadRepositoryEvents(repo)).toEqual([]);
});

it('names where each event came from relative to the repository, not to contracts/', async () => {
  await fs.mkdir(path.join(repo, 'contracts/events'), { recursive: true });
  await fs.writeFile(
    path.join(repo, 'contracts/events/order.placed.json'),
    JSON.stringify({
      title: 'OrderPlaced',
      type: 'object',
      properties: { id: { type: 'string' } },
    }),
  );

  const [event] = await loadRepositoryEvents(repo);

  expect(event?.frontmatter.source?.file).toBe('contracts/events/order.placed.json');
});

it('ignores a contracts/ that is a symlink, which could point anywhere', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

  try {
    await fs.writeFile(
      path.join(outside, 'secret.json'),
      JSON.stringify({
        title: 'Secret',
        type: 'object',
        properties: { token: { type: 'string' } },
      }),
    );
    await fs.symlink(outside, path.join(repo, 'contracts'));

    expect(await loadRepositoryEvents(repo)).toEqual([]);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

it("infers the owner from the repository's CODEOWNERS, matched on the repository path", async () => {
  await fs.mkdir(path.join(repo, 'contracts/events'), { recursive: true });
  await fs.writeFile(path.join(repo, 'CODEOWNERS'), '/contracts/events/ @acme/payments\n');
  await fs.writeFile(
    path.join(repo, 'contracts/events/order.placed.json'),
    JSON.stringify({
      title: 'OrderPlaced',
      type: 'object',
      properties: { id: { type: 'string' } },
    }),
  );

  const [event] = await loadRepositoryEvents(repo);

  expect(event?.frontmatter.owner?.team).toBe('acme/payments');
  expect(event?.frontmatter.provenance.fields.owner).toBe('inferred');
});

describe('a monorepo', () => {
  const write = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.writeFile(path.join(repo, file), body);
  };

  const contract = JSON.stringify({ type: 'object', properties: { id: { type: 'string' } } });

  beforeEach(async () => {
    await write('platform/package.json', '{}');
    await write('platform/CODEOWNERS', '* @acme/platform\n/services/orders/ @acme/orders\n');
    await write('platform/docs/workspace.md', '# Workspace\n');
    await write('platform/services/orders/package.json', '{}');
    await write('platform/services/orders/contracts/orders/order.placed.json', contract);
    await write('platform/services/orders/test/fixtures/contracts/x.json', contract);
    await write('payments-service/contracts/payments/payment.captured.json', contract);
  });

  it('publishes each package beside the checkouts, named for its folder', () => {
    expect(findCatalogRoots(repo).map(({ name, path }) => [name, path])).toEqual([
      ['payments-service', 'payments-service'],
      ['platform', 'platform'],
      ['orders', 'platform/services/orders'],
    ]);
  });

  it('finds the same packages when the monorepo is the root', () => {
    expect(findCatalogRoots(path.join(repo, 'platform')).map(({ name }) => name)).toEqual([
      'platform',
      'orders',
    ]);
  });

  it('keeps a checkout’s name when a package nested deeper shares it', async () => {
    await write('orders/contracts/orders/order.shipped.json', contract);

    expect(
      findCatalogRoots(repo).map(({ name, path, duplicateOf }) => [name, path, duplicateOf]),
    ).toEqual([
      ['orders', 'orders', undefined],
      ['payments-service', 'payments-service', undefined],
      ['platform', 'platform', undefined],
      ['orders', 'platform/services/orders', 'orders'],
    ]);
  });

  it('reads a docs/ or events/ folder of packages as packages, not catalog content', async () => {
    await write('platform/packages/docs/site/package.json', '{}');
    await write('platform/packages/docs/site/README.md', '# Site\n');
    await write('platform/apps/docs/package.json', '{}');

    expect(findCatalogRoots(path.join(repo, 'platform')).map(({ name }) => name)).toEqual([
      'platform',
      'orders',
    ]);
  });

  it('leaves sample code to be built from its own root', async () => {
    await write('platform/examples/shop/docs/index.md', '# Shop\n');

    expect(findCatalogRoots(path.join(repo, 'platform')).map(({ name }) => name)).toEqual([
      'platform',
      'orders',
    ]);
  });

  it("owns a package's events by the monorepo's CODEOWNERS, never one above the root", async () => {
    const orders = path.join(repo, 'platform/services/orders');

    const [event] = await loadRepositoryEvents(orders, { ownersWithin: repo });

    expect(event?.frontmatter.owner?.team).toBe('acme/orders');

    await write('CODEOWNERS', '* @someone-else\n');

    const [outside] = await loadRepositoryEvents(path.join(repo, 'payments-service'), {
      ownersWithin: path.join(repo, 'payments-service'),
    });

    expect(outside?.frontmatter.owner).toBeUndefined();
  });
});

// Each test commits several times; spawning git takes seconds on Windows.
describe("a contracts-only repository's git history", { timeout: 30_000 }, () => {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });

  const contract = (version: string | undefined, fields: string[]) =>
    JSON.stringify({
      title: 'OrderPlaced',
      type: 'object',
      properties: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
      'x-autocatalog': { id: 'order.placed', domain: 'orders', ...(version && { version }) },
    });

  const commit = async (version: string | undefined, fields: string[]) => {
    await fs.mkdir(path.join(repo, 'contracts'), { recursive: true });
    await fs.writeFile(path.join(repo, 'contracts/order-placed.json'), contract(version, fields));
    git('add', '-A');
    git('commit', '-q', '-m', `contract ${version}`);
  };

  beforeEach(() => git('init', '-q'));

  it('publishes each earlier declared version as history, read from git', async () => {
    await commit('1.0.0', ['orderId']);
    await commit('1.0.0', ['orderId', 'note']);
    await commit('2.0.0', ['orderId', 'note', 'currency']);

    const events = await loadRepositoryEvents(repo, { history: true });

    expect(events.map((e) => [e.frontmatter.version, e.folder.isVersioned])).toEqual([
      ['2.0.0', false],
      ['1.0.0', true],
    ]);
    // The last commit at 1.0.0 is what 1.0.0 was.
    expect(Object.keys(events[1]?.schema.properties ?? {})).toEqual(['orderId', 'note']);
    // Read from git, never by touching the work tree.
    expect(await fs.readFile(path.join(repo, 'contracts/order-placed.json'), 'utf8')).toBe(
      contract('2.0.0', ['orderId', 'note', 'currency']),
    );
  });

  it('has no history without a declared version: every commit would claim the same one', async () => {
    await commit(undefined, ['orderId']);
    await commit(undefined, ['orderId', 'currency']);

    const events = await loadRepositoryEvents(repo, { history: true });

    expect(events.map((e) => e.folder.isVersioned)).toEqual([false]);
  });

  it('skips a commit whose contracts no longer compile rather than failing today', async () => {
    await commit('1.0.0', ['orderId']);
    await fs.writeFile(path.join(repo, 'contracts/order-placed.json'), '{ not json');
    git('commit', '-q', '-am', 'broken');
    await commit('2.0.0', ['orderId', 'currency']);

    const events = await loadRepositoryEvents(repo, { history: true });

    expect(events.map((e) => e.frontmatter.version)).toEqual(['2.0.0', '1.0.0']);
  });

  it('leaves history out unless asked for', async () => {
    await commit('1.0.0', ['orderId']);
    await commit('2.0.0', ['orderId', 'currency']);

    expect(await loadRepositoryEvents(repo)).toHaveLength(1);
  });
});

it('reads no history, quietly, when the repository is not a git checkout', async () => {
  await fs.mkdir(path.join(repo, 'contracts'));
  await fs.writeFile(
    path.join(repo, 'contracts/order-placed.json'),
    JSON.stringify({
      title: 'OrderPlaced',
      type: 'object',
      properties: { id: { type: 'string' } },
      'x-autocatalog': { id: 'order.placed', version: '2.0.0' },
    }),
  );

  expect(await loadRepositoryEvents(repo, { history: true })).toHaveLength(1);
});

describe("runtime evidence from the repository's .autotel/snapshot.json", () => {
  const contract = JSON.stringify({
    title: 'OrderPlaced',
    type: 'object',
    properties: { orderId: { type: 'string' } },
    'x-autocatalog': { id: 'order.placed', domain: 'orders', consumers: ['Billing'] },
  });

  const snapshot = JSON.stringify({
    spec: 'autotel-architecture/v1',
    generatedAt: '2026-02-01T00:00:00Z',
    service: 'orders',
    events: {
      'order.placed': {
        name: 'order.placed',
        observedCount: 2,
        firstSeen: '2026-02-01T00:00:00Z',
        lastSeen: '2026-02-01T00:00:01Z',
        consumers: ['Billing', 'Analytics'],
      },
    },
  });

  beforeEach(async () => {
    await fs.mkdir(path.join(repo, 'contracts'));
    await fs.writeFile(path.join(repo, 'contracts/order-placed.json'), contract);
    await fs.mkdir(path.join(repo, '.autotel'));
  });

  it('is joined onto discovered contracts, without committing a catalog', async () => {
    await fs.writeFile(path.join(repo, '.autotel/snapshot.json'), snapshot);

    const [event] = await loadRepositoryEvents(repo);

    expect(event?.frontmatter.observed?.count).toBe(2);
    expect(event?.frontmatter.consumers).toEqual(['Billing', 'Analytics']);
    expect(event?.frontmatter.provenance.fields.consumers).toBe('observed');
  });

  it('is joined onto a committed catalog too', async () => {
    await scanCatalog({
      root: repo,
      discoverIn: 'contracts',
      outRoot: path.join(repo, 'events'),
      adapters: builtInDiscoveryAdapters,
    });
    await fs.writeFile(path.join(repo, '.autotel/snapshot.json'), snapshot);

    const [event] = await loadRepositoryEvents(repo);

    expect(event?.folder.path.startsWith(path.join(repo, 'events'))).toBe(true);
    expect(event?.frontmatter.observed?.count).toBe(2);
  });

  it('is never read through a symlink, which could name any file on this machine', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

    try {
      await fs.writeFile(path.join(outside, 'snapshot.json'), snapshot);
      await fs.symlink(
        path.join(outside, 'snapshot.json'),
        path.join(repo, '.autotel/snapshot.json'),
      );

      const [event] = await loadRepositoryEvents(repo);

      expect(event?.frontmatter.observed).toBeUndefined();
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('when malformed, is a warning: the events still load, without evidence', async () => {
    await fs.writeFile(path.join(repo, '.autotel/snapshot.json'), '{"spec":"nope"}');
    const warnings: string[] = [];

    const [event] = await loadRepositoryEvents(repo, { onWarning: (w) => warnings.push(w) });

    expect(event?.frontmatter.id).toBe('order.placed');
    expect(event?.frontmatter.observed).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringMatching(/\.autotel\/snapshot\.json.*Not an architecture snapshot/),
    ]);
  });
});

describe('autotel-message-contract approved files anywhere in the repository', () => {
  const approved = JSON.stringify({ paymentId: 'p-1', amount: 10 }, null, 2);

  const write = async (file: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.writeFile(path.join(repo, file), text);
  };

  it('are found beside their tests, with no contracts/ folder', async () => {
    await write('src/payments/__contracts__/PaymentCaptured.approved.txt', approved);

    const events = await loadRepositoryEvents(repo);

    expect(events.map((event) => event.frontmatter.source?.file)).toEqual([
      'src/payments/__contracts__/PaymentCaptured.approved.txt',
    ]);
  });

  it('are not read from node_modules, dist or dot-folders, and nothing else is scanned', async () => {
    await write('node_modules/dep/__contracts__/Dep.approved.txt', approved);
    await write('dist/__contracts__/Built.approved.txt', approved);
    await write('.cache/__contracts__/Cached.approved.txt', approved);
    await write('src/__contracts__/notes.txt', approved);
    await write(
      'test/stray.json',
      JSON.stringify({ title: 'Stray', type: 'object', properties: { x: { type: 'string' } } }),
    );

    expect(await loadRepositoryEvents(repo)).toEqual([]);
  });

  it('are found once when they sit under contracts/', async () => {
    await write('contracts/__contracts__/PaymentCaptured.approved.txt', approved);

    expect(await loadRepositoryEvents(repo)).toHaveLength(1);
  });
});
