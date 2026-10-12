import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import utils from '@eventcatalog/sdk';
import {
  AUTOCATALOG_GRAPH_SPEC,
  scanArchitecture,
  type ResourceGraph,
  type ServiceCatalogResource,
} from 'autocatalog-core';
import { runFromEventCatalog } from '../src/commands/from-eventcatalog';
import { exportToEventCatalog, loadEventCatalogSources } from '../src/eventcatalog';

// Running both tools: an EventCatalog imported into autocatalog, exported back,
// and imported again comes out as it went in.

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-ec-both-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(tmp, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const page = (lines: string[]) => `---\n${lines.join('\n')}\n---\n\nBody.\n`;

async function source() {
  const ec = 'ec/domains/Orders';

  await write(
    'ec/teams/orders.mdx',
    page([
      'id: orders',
      'name: Orders Team',
      'slackDirectMessageUrl: https://acme.slack.com/channels/orders',
    ]),
  );
  await write(
    'ec/users/finance.md',
    page(['id: finance', 'name: Fin Ance', 'email: fin@acme.test']),
  );

  await write(
    `${ec}/events/OrderPlaced/index.md`,
    page(['id: OrderPlaced', 'version: 1.0.0', 'name: Order placed', 'owners:', '  - orders']),
  );
  await write(`${ec}/events/OrderPlaced/schema.json`, '{"type":"object"}');
  await write(
    `${ec}/commands/PlaceOrder/index.md`,
    page(['id: PlaceOrder', 'version: 1.2.0', 'name: Place order', 'summary: Asks for an order.']),
  );
  await write(
    `${ec}/commands/PlaceOrder/schema.json`,
    '{"type":"object","properties":{"sku":{"type":"string"}}}',
  );
  await write(
    `${ec}/queries/GetOrder/index.md`,
    page(['id: GetOrder', 'version: 0.1.0', 'summary: Reads an order.']),
  );
  // A system lists one service and holds the other in its folder.
  await write(
    `${ec}/systems/ordering/index.md`,
    page([
      'id: ordering',
      'name: Ordering System',
      'version: 1.0.0',
      'services:',
      '  - id: OrderService',
    ]),
  );
  await write(
    `${ec}/systems/ordering/services/Web/index.md`,
    page(['id: Web', 'version: 1.0.0', 'sends:', '  - id: PlaceOrder', '  - id: GetOrder']),
  );
  await write(
    `${ec}/services/OrderService/index.md`,
    page([
      'id: OrderService',
      'name: Order Service',
      'version: 1.0.0',
      'summary: Takes orders.',
      'owners:',
      '  - orders',
      'repository:',
      '  url: https://github.com/acme/orders',
      'sends:',
      '  - id: OrderPlaced',
      'receives:',
      '  - id: PlaceOrder',
      '  - id: GetOrder',
      'writesTo:',
      '  - id: orders-db',
      '  - id: archive',
      'readsFrom:',
      '  - id: ledger',
    ]),
  );
  // A service with no events or commands is still filed where its domain says.
  await write(
    'ec/domains/Reporting/services/Reporter/index.md',
    page(['id: Reporter', 'version: 1.0.0', 'readsFrom:', '  - id: ledger']),
  );
  await write(
    'ec/containers/orders-db/index.md',
    page([
      'id: orders-db',
      'name: Orders DB',
      'version: 1.0.0',
      'container_type: database',
      'technology: postgres',
      'owners:',
      '  - orders',
    ]),
  );
  await write(
    'ec/containers/ledger/index.md',
    page([
      'id: ledger',
      'name: Ledger',
      'version: 1.0.0',
      'container_type: dataWarehouse',
      'technology: mongodb',
      'owners:',
      '  - finance',
    ]),
  );
}

/** Import an EventCatalog into a project, and scan it as ac resources scan does. */
async function importInto(catalog: string, project: string) {
  expect(
    await runFromEventCatalog({
      source: path.join(tmp, catalog),
      out: path.join(tmp, project, 'events'),
      quiet: true,
    }),
  ).toBe(0);

  const { errors } = await scanArchitecture({ root: path.join(tmp, project) });

  expect(errors).toEqual([]);
}

/** What an import produced, minus where it came from. */
async function imported(project: string) {
  const root = path.join(tmp, project);
  const commands = path.join(root, 'commands', 'eventcatalog');

  const files = (await fs.readdir(commands, { recursive: true }).catch(() => [])).filter((f) =>
    f.endsWith('.json'),
  );

  return {
    commands: Object.fromEntries(
      await Promise.all(
        files
          .sort()
          .map(async (f) => [f, JSON.parse(await fs.readFile(path.join(commands, f), 'utf8'))]),
      ),
    ),
    graph: JSON.parse(
      await fs.readFile(path.join(root, '.autocatalog', 'imports', 'eventcatalog.json'), 'utf8'),
    ),
  };
}

describe('running EventCatalog and autocatalog side by side', () => {
  it('exports commands, queries, services and datastores back as EventCatalog wrote them', async () => {
    await source();
    await importInto('ec', 'project');

    await exportToEventCatalog({
      catalogs: await loadEventCatalogSources([path.join(tmp, 'project', 'events')]),
      catalogDir: path.join(tmp, 'ec2'),
    });

    const sdk = utils(path.join(tmp, 'ec2'));

    expect(await sdk.getCommand('PlaceOrder')).toMatchObject({
      name: 'Place order',
      version: '1.2.0',
      summary: 'Asks for an order.',
    });
    expect(await sdk.getQuery('GetOrder')).toMatchObject({ version: '0.1.0' });
    expect(await sdk.getDataStore('ledger')).toMatchObject({
      name: 'Ledger',
      container_type: 'dataWarehouse',
      technology: 'mongodb',
      owners: ['finance'],
    });
    expect(await sdk.getService('Order Service')).toMatchObject({
      summary: 'Takes orders.',
      owners: ['orders'],
      repository: { url: 'https://github.com/acme/orders' },
      writesTo: expect.arrayContaining([{ id: 'orders-db', version: '1.0.0' }]),
      readsFrom: [{ id: 'ledger' }],
      receives: expect.arrayContaining([
        expect.objectContaining({ id: 'PlaceOrder' }),
        expect.objectContaining({ id: 'GetOrder' }),
      ]),
    });
    expect((await sdk.getService('Web'))?.sends?.map((s) => s.id).sort()).toEqual([
      'GetOrder',
      'PlaceOrder',
    ]);
    expect(await sdk.getSystem('ordering')).toMatchObject({
      name: 'Ordering System',
      services: [{ id: 'Order Service' }, { id: 'Web' }],
    });
    // In the domain of its services, as EventCatalog files a system.
    await expect(fs.readdir(path.join(tmp, 'ec2/domains/orders/systems'))).resolves.toEqual([
      'ordering',
    ]);
    expect(await sdk.getTeam('orders')).toMatchObject({
      name: 'Orders Team',
      slackDirectMessageUrl: 'https://acme.slack.com/channels/orders',
    });
    expect(await sdk.getTeam('finance')).toMatchObject({
      name: 'Fin Ance',
      email: 'fin@acme.test',
    });
  });

  it('leaves the team, people and system pages EventCatalog already has as they are', async () => {
    await source();
    await importInto('ec', 'project');

    const system = path.join(tmp, 'ec/domains/Orders/systems/ordering');
    const before = await fs.readFile(path.join(system, 'index.md'), 'utf8');
    await exportToEventCatalog({
      catalogs: await loadEventCatalogSources([path.join(tmp, 'project', 'events')]),
      catalogDir: path.join(tmp, 'ec'),
    });

    // finance is a person there, so it gains no team page beside it.
    await expect(fs.readdir(path.join(tmp, 'ec', 'teams'))).resolves.toEqual(['orders.mdx']);
    await expect(fs.readdir(system)).resolves.toEqual(['index.md', 'services']);
    expect(await fs.readFile(path.join(system, 'index.md'), 'utf8')).toBe(before);
  });

  it('imports what it exported as it was imported the first time', async () => {
    await source();
    await importInto('ec', 'project');
    await exportToEventCatalog({
      catalogs: await loadEventCatalogSources([path.join(tmp, 'project', 'events')]),
      catalogDir: path.join(tmp, 'ec2'),
    });
    await importInto('ec2', 'again');

    expect(await imported('again')).toEqual(await imported('project'));

    // Byte for byte, so an unchanged catalog re-imports as no diff to commit.
    const record = (project: string) =>
      fs.readFile(path.join(tmp, project, '.autocatalog', 'imports', 'eventcatalog.json'), 'utf8');

    expect(await record('again')).toBe(await record('project'));
  });
});

describe('a resource graph from another repository', () => {
  type Owner = ServiceCatalogResource['owner'];

  const service = (
    attributes: ServiceCatalogResource['attributes'],
    owner?: Owner,
    id = 'Rogue',
  ): ServiceCatalogResource => ({
    ref: { kind: 'service', id },
    title: id,
    tags: [],
    provenance: { default: 'declared', fields: {} },
    needsReview: false,
    attributes,
    ...(owner && { owner }),
  });

  const graph = (...resources: ServiceCatalogResource[]): ResourceGraph => ({
    spec: AUTOCATALOG_GRAPH_SPEC,
    resources,
    relationships: [],
  });

  it('cannot place a service outside the EventCatalog project', async () => {
    const catalogDir = path.join(tmp, 'ec');

    await expect(
      exportToEventCatalog({
        catalogs: [
          { name: 'rogue', events: [], graph: graph(service({ domains: ['../../escaped'] })) },
        ],
        catalogDir,
      }),
    ).rejects.toThrow(/cannot be a path segment/);
    await expect(fs.readdir(tmp)).resolves.not.toContain('escaped');
  });

  it('cannot place a system outside the EventCatalog project', async () => {
    await expect(
      exportToEventCatalog({
        catalogs: [
          {
            name: 'rogue',
            events: [],
            graph: graph(service({ domains: [], system: { id: '../../escaped' } })),
          },
        ],
        catalogDir: path.join(tmp, 'ec'),
      }),
    ).rejects.toThrow(/cannot be a path segment/);
  });

  it('writes no repository link that is not a web address', async () => {
    const catalogDir = path.join(tmp, 'ec');

    await exportToEventCatalog({
      catalogs: [
        {
          name: 'rogue',
          events: [],
          graph: graph(service({ domains: ['orders'], repository: 'javascript:alert(1)' })),
        },
      ],
      catalogDir,
    });

    expect(await utils(catalogDir).getService('Rogue')).not.toHaveProperty('repository');
  });

  it('names a team page as any of its resources names the owner, with its Teams link', async () => {
    const catalogDir = path.join(tmp, 'ec');

    const two = graph(
      service(
        { domains: ['orders'] },
        {
          team: 'ops',
          name: 'Operations',
          contact: 'https://teams.microsoft.com/l/chat/0/0?users=ops@acme.test',
        },
      ),
      service({ domains: ['orders'] }, { team: 'ops' }, 'Other'),
    );

    await exportToEventCatalog({ catalogs: [{ name: 'two', events: [], graph: two }], catalogDir });

    expect(await utils(catalogDir).getTeam('ops')).toMatchObject({
      name: 'Operations',
      msTeamsDirectMessageUrl: 'https://teams.microsoft.com/l/chat/0/0?users=ops@acme.test',
    });
  });

  it('writes no team contact that is not an address or a web address', async () => {
    const catalogDir = path.join(tmp, 'ec');

    const rogue = graph(
      service({ domains: ['orders'] }, { team: 'ops', contact: 'javascript:alert(1)' }),
    );

    await exportToEventCatalog({
      catalogs: [{ name: 'rogue', events: [], graph: rogue }],
      catalogDir,
    });

    expect(await utils(catalogDir).getTeam('ops')).toEqual(
      expect.not.objectContaining({ slackDirectMessageUrl: expect.anything() }),
    );
  });
});

describe('a service only the resource graph knows', () => {
  it('is exported outside any domain when nothing places it in one', async () => {
    // An event elsewhere, so there is a catalog; nothing about Reporter places it.
    await write('ec/events/Paid/index.md', page(['id: Paid', 'version: 1.0.0']));
    await write(
      'ec/services/Reporter/index.md',
      page(['id: Reporter', 'version: 1.0.0', 'readsFrom:', '  - id: ledger']),
    );
    await write(
      'ec/containers/ledger/index.md',
      page(['id: ledger', 'version: 1.0.0', 'container_type: database']),
    );
    await importInto('ec', 'project');

    const result = await exportToEventCatalog({
      catalogs: await loadEventCatalogSources([path.join(tmp, 'project', 'events')]),
      catalogDir: path.join(tmp, 'ec2'),
    });

    expect(result.services).toBe(1);
    expect(await utils(path.join(tmp, 'ec2')).getService('Reporter')).toMatchObject({
      readsFrom: [{ id: 'ledger', version: '1.0.0' }],
    });
    // And back again, still in no domain.
    await importInto('ec2', 'again');
    expect(await imported('again')).toEqual(await imported('project'));
  });
});
