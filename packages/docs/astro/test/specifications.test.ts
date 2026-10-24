import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import { servicesForSpecification } from '../src/specifications';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-specs-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const event = (consumer: string) =>
  JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ParcelShipped',
    type: 'object',
    'x-autocatalog': {
      id: 'parcel.shipped',
      version: '1.0.0',
      domain: 'shipping',
      producers: ['shipping-service'],
      consumers: [consumer],
    },
    properties: { parcelId: { type: 'string' } },
  });

it('publishes WSDL, XML Schema and GraphQL by their extension, and AsyncAPI by what it declares', async () => {
  await write('shipping/package.json', '{}');
  await write('shipping/contracts/carrier.wsdl', '<definitions name="Carrier"/>');
  await write('shipping/contracts/types/parcel.xsd', '<xs:schema/>');
  await write('shipping/contracts/schema.graphql', 'type Parcel { id: ID! }');
  await write(
    'shipping/contracts/asyncapi.yaml',
    'asyncapi: 3.0.0\ninfo:\n  title: Shipping events\n  description: What shipping announces.\n',
  );
  // A YAML file that declares nothing is not a specification.
  await write('shipping/contracts/notes.yaml', 'todo: write this up\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(
    catalog.specifications.map(({ name, file, format, title, summary }) => ({
      name,
      file,
      format,
      title,
      summary,
    })),
  ).toEqual([
    {
      name: 'asyncapi',
      file: 'contracts/asyncapi.yaml',
      format: 'AsyncAPI',
      title: 'Shipping events',
      summary: 'What shipping announces.',
    },
    {
      name: 'carrier',
      file: 'contracts/carrier.wsdl',
      format: 'WSDL',
      title: 'carrier.wsdl',
      summary: undefined,
    },
    {
      name: 'schema',
      file: 'contracts/schema.graphql',
      format: 'GraphQL',
      title: 'schema.graphql',
      summary: undefined,
    },
    {
      name: 'types-parcel',
      file: 'contracts/types/parcel.xsd',
      format: 'XML Schema',
      title: 'parcel.xsd',
      summary: undefined,
    },
  ]);
});

it('publishes a JSON or YAML file its sidecar declares, attached to the service it names', async () => {
  await write('shipping/package.json', '{}');
  await write('shipping/contracts/parcel-shipped.json', event('billing'));
  await write('shipping/contracts/carrier-sla.yaml', 'carriers:\n  - name: Parcelforce\n');
  await write(
    'shipping/contracts/carrier-sla.autocatalog.json',
    JSON.stringify({
      specification: {
        name: 'Carrier SLAs',
        summary: 'Promised delivery times.',
        service: 'billing',
      },
    }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.specifications).toMatchObject([
    { name: 'carrier-sla', format: 'YAML', title: 'Carrier SLAs', services: ['billing'] },
  ]);
  expect(servicesForSpecification(catalog.specifications[0]!, catalog.events)).toEqual(['billing']);
  // The event's schema is still an event, not a specification.
  expect(catalog.events.map(({ event }) => event.frontmatter.id)).toEqual(['parcel.shipped']);
});

it('names a sidecar service no event mentions, rather than linking to a page that does not exist', async () => {
  await write('shipping/package.json', '{}');
  await write('shipping/contracts/carrier.wsdl', '<definitions/>');
  await write(
    'shipping/contracts/carrier.autocatalog.json',
    JSON.stringify({ specification: { service: 'carrier-gateway' } }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(servicesForSpecification(catalog.specifications[0]!, catalog.events)).toEqual([]);
  expect(catalog.warnings).toContain(
    'shipping: contracts/carrier.wsdl names service carrier-gateway, which no event produces or consumes',
  );
});

it('leaves out a symlinked specification and a file that is not text', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-outside-'));

  try {
    await fs.writeFile(path.join(outside, 'secret.xml'), '<secret/>');
    await write('shipping/package.json', '{}');
    await write('shipping/contracts/binary.xml', 'a\0b');
    await fs.symlink(
      path.join(outside, 'secret.xml'),
      path.join(root, 'shipping/contracts/link.xml'),
    );

    const catalog = await buildDocsCatalog(root, { includeDates: false });

    expect(catalog.specifications).toEqual([]);
    expect(catalog.warnings).toContain(
      'shipping: contracts/binary.xml: not a text file, so it is not published',
    );
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
});

it('finds AsyncAPI written as compact JSON', async () => {
  await write('shipping/package.json', '{}');
  await write(
    'shipping/contracts/events.json',
    JSON.stringify({ asyncapi: '3.0.0', info: { title: 'Shipping events', version: '1.0.0' } }),
  );

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.specifications).toMatchObject([
    { name: 'events', format: 'AsyncAPI', title: 'Shipping events' },
  ]);
});

it('gives every specification its own address, even when names collide after the fallback', async () => {
  await write('shipping/package.json', '{}');
  await write('shipping/contracts/a.wsdl', '<definitions/>');
  await write('shipping/contracts/a.xsd', '<xs:schema/>');
  await write('shipping/contracts/a-wsdl.xml', '<a/>');

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const names = catalog.specifications.map(({ name }) => name);

  expect(names).toHaveLength(3);
  expect(new Set(names).size).toBe(3);
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'leaves out an unreadable file or folder, and still publishes the rest',
  async () => {
    await write('shipping/package.json', '{}');
    await write('shipping/contracts/carrier.wsdl', '<definitions/>');
    await write('shipping/contracts/locked.wsdl', '<definitions/>');
    await write('shipping/contracts/private/parcel.xsd', '<xs:schema/>');
    await fs.chmod(path.join(root, 'shipping/contracts/locked.wsdl'), 0o000);
    await fs.chmod(path.join(root, 'shipping/contracts/private'), 0o000);

    try {
      const catalog = await buildDocsCatalog(root, { includeDates: false });

      expect(catalog.specifications.map(({ file }) => file)).toEqual(['contracts/carrier.wsdl']);
      expect(catalog.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^shipping: contracts\/locked\.wsdl: not read, so it is not published — /,
          ),
          expect.stringMatching(
            /^shipping: contracts\/private: not searched for specifications — /,
          ),
        ]),
      );
    } finally {
      await fs.chmod(path.join(root, 'shipping/contracts/locked.wsdl'), 0o644);
      await fs.chmod(path.join(root, 'shipping/contracts/private'), 0o755);
    }
  },
);
