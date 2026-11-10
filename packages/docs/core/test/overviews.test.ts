import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readOverviews } from '../src/overviews';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-overviews-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function file(repository: string, rel: string, text: string) {
  const full = path.join(root, repository, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text);
}

const repos = (...names: string[]) =>
  names.map((repository) => ({ repository, dir: path.join(root, repository) }));

const targets = {
  domain: ['fulfilment', 'returns', 'customer'],
  service: ['Payment Worker'],
  system: ['warehouse'],
};

it('reads one overview per kind, matching a file name to the catalog name it spells', async () => {
  await file(
    'ops',
    'overviews/domains/fulfilment.md',
    '---\nname: Fulfilment\n---\n\nShips orders.\n',
  );
  await file(
    'ops',
    'overviews/services/payment-worker.md',
    '---\nsummary: Pays.\n---\n\nTakes payments.\n',
  );
  await file('ops', 'overviews/systems/warehouse.md', 'Holds stock.\n');

  const { overviews, failures, warnings } = readOverviews(repos('ops'), targets);

  expect(failures).toEqual([]);
  expect(warnings).toEqual([]);
  expect(overviews.map(({ kind, target, body }) => [kind, target, body])).toEqual([
    ['domain', 'fulfilment', 'Ships orders.'],
    ['service', 'Payment Worker', 'Takes payments.'],
    ['system', 'warehouse', 'Holds stock.'],
  ]);
});

it('reads nothing outside overviews/, so a source folder named services/ is left alone', async () => {
  await file('ops', 'services/README.md', '# Our services\n');
  await file('ops', 'domains/fulfilment.md', 'Not an overview.\n');

  const result = readOverviews(repos('ops'), targets);

  expect(result).toEqual({ overviews: [], failures: [], warnings: [] });
});

it('fails a second overview for the same resource, naming both files', async () => {
  await file('a', 'overviews/domains/fulfilment.md', 'One.\n');
  await file('b', 'overviews/domains/fulfilment.md', 'Two.\n');

  const { overviews, failures } = readOverviews(repos('a', 'b'), targets);

  expect(overviews.map(({ repository }) => repository)).toEqual(['a']);
  expect(failures).toEqual([
    "b/overviews/domains/fulfilment.md: domain 'fulfilment' already has an overview in a/overviews/domains/fulfilment.md",
  ]);
});

it('keeps an overview for what this checkout lacks when deferring, and warns and leaves it out otherwise', async () => {
  await file('ops', 'overviews/services/ledger.md', 'Elsewhere.\n');

  const deferred = readOverviews(repos('ops'), targets, { deferMissing: true });

  expect(deferred.failures).toEqual([]);
  expect(deferred.overviews.map(({ target }) => target)).toEqual(['ledger']);

  const composed = readOverviews(repos('ops'), targets);

  expect(composed.overviews).toEqual([]);
  expect(composed.warnings).toEqual([
    "ops/overviews/services/ledger.md: no service 'ledger' in the catalog, so it is left out",
  ]);
});

it("resolves a subdomain's parent, and defers or warns about one the catalog lacks", async () => {
  await file('ops', 'overviews/domains/returns.md', '---\nparent: fulfilment\n---\n');
  await file('ops', 'overviews/domains/customer.md', '---\nparent: identity\n---\n');

  const composed = readOverviews(repos('ops'), targets);

  expect(composed.failures).toEqual([]);
  expect(composed.overviews.map(({ target, parent }) => [target, parent])).toEqual([
    ['customer', undefined],
    ['returns', 'fulfilment'],
  ]);
  expect(composed.warnings).toEqual([
    "ops/overviews/domains/customer.md: no domain 'identity' to be its parent, so it is shown at the top",
  ]);

  const deferred = readOverviews(repos('ops'), targets, { deferMissing: true });

  expect(deferred.failures).toEqual([]);
  expect(deferred.overviews.find(({ target }) => target === 'customer')?.parent).toBe('identity');
});

it('fails a parent the catalog has as a service, a cycle, and a parent on anything but a domain', async () => {
  await file('ops', 'overviews/domains/fulfilment.md', '---\nparent: returns\n---\n');
  await file('ops', 'overviews/domains/returns.md', '---\nparent: fulfilment\n---\n');
  await file('ops', 'overviews/domains/customer.md', '---\nparent: payment-worker\n---\n');
  await file('ops', 'overviews/systems/warehouse.md', '---\nparent: fulfilment\n---\n');

  const { overviews, failures } = readOverviews(repos('ops'), targets, { deferMissing: true });

  expect(overviews.map(({ target }) => target)).toEqual(['customer']);
  expect(failures).toEqual([
    'ops/overviews/systems/warehouse.md: only a domain takes a parent',
    "ops/overviews/domains/customer.md: parent 'payment-worker' is not a domain",
    "ops/overviews/domains/fulfilment.md: domain 'fulfilment' is its own ancestor through parent",
    "ops/overviews/domains/returns.md: domain 'returns' is its own ancestor through parent",
  ]);
});

it('fails a cycle between domains this checkout describes, though their events are elsewhere', async () => {
  await file('ops', 'overviews/domains/loyalty.md', '---\nparent: rewards\n---\n');
  await file('ops', 'overviews/domains/rewards.md', '---\nparent: loyalty\n---\n');
  await file('ops', 'overviews/domains/vouchers.md', '---\nparent: loyalty\n---\n');

  const { overviews, failures } = readOverviews(repos('ops'), targets, { deferMissing: true });

  expect(overviews.map(({ target, parent }) => [target, parent])).toEqual([
    ['vouchers', 'loyalty'],
  ]);
  expect(failures).toEqual([
    "ops/overviews/domains/loyalty.md: domain 'loyalty' is its own ancestor through parent",
    "ops/overviews/domains/rewards.md: domain 'rewards' is its own ancestor through parent",
  ]);
});
