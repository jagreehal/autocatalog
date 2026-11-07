#!/usr/bin/env node
// Publishes examples/rest-apis/ as one company site and checks what the catalog
// knows about a REST API today.
//
//   node scripts/verify-rest-apis.mjs [work-dir]
//
// Each team folder becomes a git repository, enrolled over file://. customers
// imports its traces, then: lock, build the site, and open a pull request that
// removes a response field.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const EXAMPLE = path.join(ROOT, 'examples/rest-apis');

const BIN = path.join(ROOT, 'packages/events/cli/dist/bin.js');

const KONG = path.join(ROOT, 'packages/events/plugin-kong/dist/bin.js');

const KUBERNETES = path.join(ROOT, 'packages/events/plugin-kubernetes/dist/bin.js');

const WORK = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'ac-rest-apis-')));

const TEAMS = ['billing', 'checkout', 'cluster', 'customers', 'gateway'];

const SPEC = 'contracts/customers-api.yaml';

const remote = (team) => path.join(WORK, 'remotes', team);

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
}

const ac = (cwd, ...args) => run('node', [BIN, ...args], cwd);

function must(cwd, ...args) {
  const result = ac(cwd, ...args);

  check(result.status === 0, `ac ${args.join(' ')} exited ${result.status}`, result.out);

  return result.out;
}

const repositories = ['--repo', ...TEAMS.map((team) => `file://${remote(team)}`)];

const steps = {
  'the committed gateway file is what the Kong configuration says'() {
    const result = run(
      'node',
      [KONG, 'kong.yml', '--check', '--service', 'customers=customers-service'],
      path.join(EXAMPLE, 'gateway'),
    );

    check(result.status === 0, 'autocatalog.gateway.json is stale', result.out);
  },

  'the committed network file is what the manifests say'() {
    const result = run('node', [KUBERNETES, 'k8s.yaml', '--check'], path.join(EXAMPLE, 'cluster'));

    check(result.status === 0, 'autocatalog.network.json is stale', result.out);
  },

  'teams become repositories'() {
    for (const team of TEAMS) {
      cpSync(path.join(EXAMPLE, team), remote(team), { recursive: true });
      git(remote(team), 'init', '-q', '-b', 'main');
    }

    // The evidence is what gets committed; events/ would replace contracts/.
    must(remote('customers'), 'scan', '.', '--traces', 'traces/otlp.json', '--quiet');
    rmSync(path.join(remote('customers'), 'events'), { recursive: true });

    for (const team of TEAMS) commit(remote(team), 'init');

    cpSync(path.join(EXAMPLE, 'company-site'), company, { recursive: true });
    git(company, 'init', '-q', '-b', 'main');
  },

  'the site publishes the API, who calls each operation, what the gateway exposes, and what the network blocks'() {
    must(company, 'federation', 'lock', ...repositories);

    const { services } = JSON.parse(
      readFileSync(path.join(company, 'autocatalog.lock.json'), 'utf8'),
    );

    check(
      JSON.stringify(services) ===
        JSON.stringify({
          'billing-service': 'billing',
          'checkout-service': 'checkout',
          'customers-service': 'customers',
        }),
      `the lock pins ${JSON.stringify(services)}`,
    );
    const built = must(company, 'site', ...repositories);

    check(
      built.includes(
        "billing-service was seen calling customers-service, and customers-service's network policy does not let billing-service reach it",
      ),
      'the site does not say the network policy blocks billing-service',
      built,
    );

    const page = path.join(company, 'dist/apis/customers/customers-api/index.html');

    check(existsSync(page), 'no API page');
    check(readFileSync(page, 'utf8').includes('/customers/{id}'), 'the page lists no operation');

    const graph = JSON.parse(readFileSync(path.join(company, 'dist/catalog.json'), 'utf8'));

    const exposed = graph.relationships
      .filter((edge) => edge.type === 'exposedBy' && edge.to.id === 'customers-service')
      .map((edge) => `${edge.from.id}:${edge.provenance}`)
      .sort();

    check(
      exposed.join() === 'GET /customers/{id}:declared,POST /customers:declared',
      `endpoints were ${exposed.join()}`,
    );

    const exposedByKong = graph.relationships
      .filter((edge) => edge.type === 'exposedBy' && edge.to.kind === 'gateway')
      .map((edge) => `${edge.from.id} at ${edge.attributes?.path}`);

    check(
      exposedByKong.join() === 'GET /customers/{id} at /customers/{id}',
      `kong exposed ${exposedByKong.join()}`,
    );

    const callers = graph.relationships
      .filter((edge) => edge.type === 'calls' && edge.to.id === 'GET /customers/{id}')
      .map((edge) => `${edge.from.id}:${edge.provenance}`)
      .sort();

    check(
      callers.join() === 'billing-service:observed,checkout-service:declared',
      `callers were ${callers.join()}`,
    );
  },

  'drift names the caller a removed field reaches, and only that one'() {
    const clone = mkdtempSync(path.join(WORK, 'customers-pr-'));

    git(WORK, 'clone', '-q', remote('customers'), clone);

    const file = path.join(clone, SPEC);
    const spec = readFileSync(file, 'utf8');
    const changed = spec.replace('required: [id, email, tier]', 'required: [id, email]');

    check(changed !== spec, 'the spec no longer has the required list');
    writeFileSync(file, changed.replace('        tier:\n          type: string\n', ''));

    const result = ac(
      clone,
      'drift',
      '--base-ref',
      'HEAD',
      '--root',
      '.',
      '--consumers',
      path.join(company, 'dist/catalog.json'),
      '--repository',
      'customers',
    );

    check(result.status !== 0, 'the removal passed', result.out);
    check(result.out.includes('/customers/{id}'), 'the operation is not named', result.out);

    // billing-service was only seen in traces, so it may read anything.
    // checkout-service says it reads `email`, so `tier` going does not reach it.
    check(
      result.out.includes('breaks billing-service'),
      'the observed caller is not named',
      result.out,
    );
    check(
      !result.out.includes('checkout-service'),
      'a caller that does not read it is named',
      result.out,
    );
  },
};

for (const [name, fn] of Object.entries(steps)) {
  step = name;
  fn();
  console.log(`ok  ${name}`);
}

// A folder it made for itself is removed: each run builds a whole site.
if (!process.argv[2]) rmSync(WORK, { recursive: true, force: true });
