#!/usr/bin/env node
// Composes examples/federation/ into one company site, as teams that only use
// autocatalog would, and checks each step.
//
//   node scripts/verify-federation.mjs [work-dir]
//
// Each team folder becomes a git repository, enrolled over file://. The
// payments repository gets three commits, so its event has versions 1.0.0,
// 1.1.0 and 2.0.0-beta.1. Then: lock, move one pin with --only, check the
// federation, build the site from the pins, gate a producer change and a
// broker change on consumers in other repositories, and build a
// business-unit site that joins the company's catalog.json.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');

const EXAMPLE = path.join(ROOT, 'examples/federation');

const BIN = path.join(ROOT, 'packages/events/cli/dist/bin.js');

const WORK = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'ac-federation-')));

const TEAMS = ['infra', 'ledger', 'orders', 'payments', 'shipping'];

const LATER = ['legacy-payments', 'notifications'];

const EVENT = 'contracts/events/payment.completed.json';

const remote = (team) => path.join(WORK, 'remotes', team);

const url = (team) => `file://${remote(team)}`;

const company = path.join(WORK, 'remotes/company-site');

let step = '';

function check(ok, message, output = '') {
  if (!ok) throw new Error(`${step}: ${message}${output ? `\n${output}` : ''}`);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });

  if (result.error) throw result.error;

  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const git = (dir, ...args) =>
  run('git', ['-C', dir, '-c', 'user.email=ci@example.com', '-c', 'user.name=ci', ...args], dir);

function commit(dir, message) {
  git(dir, 'add', '-A');

  const result = git(dir, 'commit', '-qm', message);

  check(result.status === 0, `git commit in ${dir} failed`, result.out);

  return git(dir, 'rev-parse', 'HEAD').out.trim();
}

const ac = (cwd, ...args) => run('node', [BIN, ...args], cwd);

/** `ac` without blocking, so two commands can run at once. */
function acAsync(cwd, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [BIN, ...args], { cwd });
    let out = '';

    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, out }));
  });
}

function must(cwd, ...args) {
  const result = ac(cwd, ...args);

  check(result.status === 0, `ac ${args.join(' ')} exited ${result.status}`, result.out);

  return result.out;
}

const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

const lock = () => json(path.join(company, 'autocatalog.lock.json')).repositories;

const pin = (team) => lock().find((entry) => entry.name === team)?.commit;

function setVersion(dir, version) {
  const file = path.join(dir, EVENT);
  const schema = json(file);
  schema['x-autocatalog'].version = version;
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
}

const repositories = (...teams) => ['--repo', ...teams.map(url)];

function status(...teams) {
  const result = ac(company, 'federation', 'status', ...repositories(...teams), '--format', 'json');

  return { code: result.status, report: JSON.parse(result.out) };
}

/** A resource in a catalog.json, by kind and id, and the edges that touch it. */
const edges = (graph, type, from, to) =>
  graph.relationships.filter(
    (r) => r.type === type && `${r.from.kind}:${r.from.id}` === from && r.to.id === to,
  );

/** A pull request in `team`: one file changed, gated on the company site's consumers. */
function drift(team, file, change) {
  const clone = mkdtempSync(path.join(WORK, `${team}-pr-`));

  git(WORK, 'clone', '-q', remote(team), clone);
  writeFileSync(path.join(clone, file), change(readFileSync(path.join(clone, file), 'utf8')));

  return ac(
    clone,
    'drift',
    '--base-ref',
    'HEAD',
    '--root',
    '.',
    '--consumers',
    path.join(company, 'dist/catalog.json'),
    '--repository',
    team,
  );
}

const steps = {
  'teams become repositories'() {
    for (const team of [...TEAMS, ...LATER]) {
      cpSync(path.join(EXAMPLE, team), remote(team), { recursive: true });
      git(remote(team), 'init', '-q', '-b', 'main');
    }

    // The payments event's history: two releases, then a prerelease.
    const payments = remote('payments');
    const current = readFileSync(path.join(payments, EVENT), 'utf8');

    setVersion(payments, '1.0.0');
    commit(payments, 'payment.completed 1.0.0');
    setVersion(payments, '1.1.0');
    commit(payments, 'payment.completed 1.1.0');
    writeFileSync(path.join(payments, EVENT), current);

    for (const team of [...TEAMS, ...LATER]) commit(remote(team), 'init');

    cpSync(path.join(EXAMPLE, 'company-site'), company, { recursive: true });
    git(company, 'init', '-q', '-b', 'main');
  },

  'lock pins each repository'() {
    must(company, 'federation', 'lock', ...repositories(...TEAMS));

    for (const team of TEAMS)
      check(pin(team) === git(remote(team), 'rev-parse', 'HEAD').out.trim(), `${team} not pinned`);

    commit(company, 'pin the federation');
  },

  '--only moves one pin'() {
    const payments = pin('payments');

    // Both teams merge; only orders is moved.
    writeFileSync(
      path.join(remote('payments'), 'contracts/events/payment.refunded.json'),
      JSON.stringify({
        type: 'object',
        properties: { paymentId: { type: 'string' } },
        'x-autocatalog': { id: 'payment.refunded', domain: 'payments', version: '1.0.0' },
      }),
    );
    commit(remote('payments'), 'payment.refunded');
    writeFileSync(
      path.join(remote('orders'), 'contracts/events/order.cancelled.json'),
      JSON.stringify({
        type: 'object',
        properties: { orderId: { type: 'string' } },
        'x-autocatalog': { id: 'order.cancelled', domain: 'orders', version: '1.0.0' },
      }),
    );

    const orders = commit(remote('orders'), 'order.cancelled');

    must(company, 'federation', 'lock', ...repositories(...TEAMS), '--only', 'orders');
    check(pin('orders') === orders, 'orders did not move');
    check(pin('payments') === payments, 'payments moved without --only');
    commit(company, 'move orders');
  },

  'status reports pins, resources and references'() {
    const { code, report } = status(...TEAMS);

    check(code === 0, `exited ${code} with nothing left out`, JSON.stringify(report, null, 2));

    const source = (name) => report.sources.find((s) => s.repository === name);

    for (const team of TEAMS) check(source(team)?.commit === pin(team), `${team} has no pin`);

    check(source('payments').events === 1, 'payments counts the unpinned payment.refunded');
    check(source('payments').commands === 1, 'payments has no command');
    check(source('orders').events === 3, 'orders is not at its moved pin');
    // ^1 and latest pick 1.1.0, never 2.0.0-beta.1; refund-payment resolves.
    check(
      source('orders').unresolved.length === 0,
      'orders has unresolved references',
      JSON.stringify(report, null, 2),
    );

    const unresolved = report.unresolved.join('\n');

    check(/invoice\.issued, which no repository publishes/.test(unresolved), 'no unresolved');
    check(/status\.changed, which is ambiguous/.test(unresolved), 'no ambiguous id', unresolved);
    check(source('ledger').unresolved.length === 2, 'ledger: other references', unresolved);
  },

  'site builds the pinned commits and resolves references'() {
    // legacy-payments is enrolled but not locked yet: named, and left out.
    const out = must(
      company,
      'site',
      ...repositories(...TEAMS, 'legacy-payments'),
      '--out',
      'dist',
    );

    check(
      /Left out legacy-payments: enrolled but not in autocatalog\.lock\.json/.test(out),
      'legacy-payments not named as unlocked',
      out,
    );

    const graph = json(path.join(company, 'dist/catalog.json'));
    const ids = new Set(graph.resources.map((r) => `${r.ref.kind}:${r.ref.id}`));

    check(ids.has('event:order.cancelled'), 'orders not built at its moved pin');
    check(!ids.has('event:payment.refunded'), 'payments built past its pin');
    check(!ids.has('service:BillingService'), 'legacy-payments was built before it was locked');

    // ^1 and latest pick 1.1.0 from history, never the 2.0.0-beta.1 ahead of it.
    for (const service of ['OrderService', 'LedgerService']) {
      const received = edges(graph, 'consumes', 'event:payment.completed', service).filter(
        (r) => r.source?.file === 'autocatalog.consumes.json' && r.attributes?.declaredBy,
      );

      check(
        received.length === 1 && received[0].from.version === '1.1.0',
        `${service} does not receive payment.completed 1.1.0`,
        JSON.stringify(received, null, 2),
      );
    }

    check(
      edges(graph, 'sends', 'service:OrderService', 'refund-payment').length === 1,
      'OrderService does not send refund-payment',
    );
    check(
      edges(graph, 'consumes', 'event:status.changed', 'LedgerService').some((r) =>
        r.from.namespace.startsWith('shipping/'),
      ),
      'LedgerService does not receive shipping/status.changed',
    );
  },

  'a producer change names a consumer in another repository'() {
    const result = drift('payments', EVENT, (text) => text.replaceAll('"amount"', '"amountMinor"'));

    check(result.status === 1, `exited ${result.status}`, result.out);
    check(/breaks .*LedgerService/.test(result.out), 'LedgerService not named', result.out);
  },

  'a broker change in infra names the consumer in ledger'() {
    const result = drift('infra', 'rabbitmq/definitions.json', (text) =>
      text.replace('"currency": "GBP"', '"currency": "EUR"'),
    );

    check(result.status === 1, `exited ${result.status}`, result.out);
    check(/breaks .*LedgerService/.test(result.out), 'LedgerService not named', result.out);
  },

  async 'a business-unit site joins the company catalog, built twice at once'() {
    // Two builds at the same time must not share Astro's output or caches.
    const build = (unit) =>
      acAsync(
        WORK,
        'site',
        ...repositories('payments', 'ledger'),
        '--cache',
        path.join(unit, '.autocatalog/repos'),
        '--out',
        path.join(unit, 'dist'),
        '--index',
        path.join(company, 'dist/catalog.json'),
      );

    const units = ['payments-unit', 'payments-unit-again'].map((name) => path.join(WORK, name));

    for (const result of await Promise.all(units.map(build)))
      check(result.status === 0, `a concurrent build exited ${result.status}`, result.out);

    const [graph, again] = units.map((unit) => json(path.join(unit, 'dist/catalog.json')));

    check(isDeepStrictEqual(graph, again), 'the two builds differ');

    // shipping is not in the unit: its event comes from the company's index.
    check(
      edges(graph, 'consumes', 'event:status.changed', 'LedgerService').length === 1,
      'LedgerService does not receive shipping/status.changed from the index',
    );
  },

  'status fails on a duplicate owner and a broken repository'() {
    must(company, 'federation', 'lock', ...repositories(...TEAMS, ...LATER), '--only', ...LATER);
    commit(company, 'enrol legacy-payments and notifications');

    const { code, report } = status(...TEAMS, ...LATER);
    const text = JSON.stringify(report, null, 2);

    check(code === 1, `exited ${code}`, text);
    check(
      report.duplicates.some((d) =>
        /payments\/payment\.completed .*legacy-payments and payments/.test(d),
      ),
      'no duplicate owner',
      text,
    );
    check(
      report.failures.some(
        (f) =>
          f.name === 'notifications' && f.reason.startsWith('contracts/events/email.sent.json'),
      ),
      'notifications not named with its file',
      text,
    );
  },

  'the site leaves out the broken repository, and the rest still build'() {
    const result = ac(company, 'site', ...repositories(...TEAMS, ...LATER), '--out', 'dist');

    check(result.status === 0, `exited ${result.status}`, result.out);
    check(
      /notifications: .*contracts\/events\/email\.sent\.json/.test(result.out),
      'notifications not named',
      result.out,
    );

    const graph = json(path.join(company, 'dist/catalog.json'));
    const ids = new Set(graph.resources.map((r) => `${r.ref.kind}:${r.ref.id}`));

    check(!ids.has('event:email.sent'), 'notifications was built');

    // A document without an owner leaves out legacy-payments' documents, not the site.
    check(
      /legacy-payments: its docs\/ did not compile.*docs\/overview\.md/.test(result.out),
      'legacy-payments docs not named',
      result.out,
    );
    check(
      !existsSync(path.join(company, 'dist/legacy-payments/overview/index.html')),
      'legacy-payments/overview was published',
    );
    check(
      existsSync(path.join(company, 'dist/payments/overview/index.html')),
      'payments/overview is missing',
    );

    for (const id of ['order.placed', 'order.cancelled', 'status.changed', 'payment.completed'])
      check(ids.has(`event:${id}`), `${id} is missing`);

    // Two owners of payment.completed must not hide its consumers from the gate.
    const result2 = drift('payments', EVENT, (text) =>
      text.replaceAll('"amount"', '"amountMinor"'),
    );

    check(/breaks .*LedgerService/.test(result2.out), 'LedgerService not named', result2.out);
  },
};

let failed = false;

try {
  for (const [name, run] of Object.entries(steps)) {
    step = name;
    await run();
    console.log(`✓ ${name}`);
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error.message}`);
}

if (!process.argv[2]) rmSync(WORK, { recursive: true, force: true });

process.exit(failed ? 1 : 0);
