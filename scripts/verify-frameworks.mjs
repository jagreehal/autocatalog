#!/usr/bin/env node
// Checks that each example in examples/frameworks/ emits the same catalog.
//
//   node scripts/verify-frameworks.mjs            every language
//   node scripts/verify-frameworks.mjs rust go    some of them
//
// For each language: run its contract test, fail if that changed the committed
// contracts, scan them and compare the result with expected.json, then rename a
// field and check that drift reports it as breaking.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(import.meta.dirname, '..');

const EXAMPLES = path.join(ROOT, 'examples/frameworks');

const EVENT_SCHEMA = 'contracts/events/payment.completed.json';

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;

const LANGUAGES = {
  rust: () => ['cargo', 'test', '--test', 'contracts'],
  go: () => ['go', 'test', './...'],
  // No local JDK: run the build in a container instead.
  java: (dir) =>
    has('java')
      ? ['./gradlew', 'test']
      : [
          'docker',
          'run',
          '--rm',
          '-v',
          `${dir}:/w`,
          '-w',
          '/w',
          'eclipse-temurin:21',
          './gradlew',
          'test',
        ],
  dotnet: () => ['dotnet', 'test'],
};

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });

  if (result.error) throw result.error;

  return result;
}

function must(cmd, args, cwd) {
  const result = run(cmd, args, cwd);

  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }

  return result;
}

const ac = (args) => run('pnpm', ['-s', 'ac:events', ...args], ROOT);

function readTree(dir) {
  const files = {};

  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const full = path.join(entry.parentPath, entry.name);
      files[path.relative(dir, full)] = readFileSync(full, 'utf8');
    }
  }

  return files;
}

function scan(repo, out) {
  const result = ac(['scan', repo, '--out', out]);

  if (result.status !== 0) throw new Error(`scan failed\n${result.stdout}${result.stderr}`);
}

function summarize(contracts, events) {
  const folder = path.join(events, 'payments/PaymentCompleted');
  const meta = JSON.parse(readFileSync(path.join(folder, 'autocatalog.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(path.join(folder, 'schema.json'), 'utf8'));
  const required = new Set(schema.required ?? []);
  const fields = {};

  for (const [name, prop] of Object.entries(schema.properties ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    fields[name] = { type: prop.type, required: required.has(name) };
  }

  const openapi = JSON.parse(readFileSync(path.join(contracts, 'openapi.json'), 'utf8'));

  const operations = Object.entries(openapi.paths ?? {}).flatMap(([route, ops]) =>
    Object.keys(ops).map((method) => `${method.toUpperCase()} ${route}`),
  );

  return {
    event: {
      id: meta.id,
      version: meta.version,
      domain: meta.domain,
      producers: meta.producers,
      consumers: meta.consumers,
      fields,
    },
    api: { title: openapi.info?.title, operations },
  };
}

function verify(lang) {
  const dir = path.join(EXAMPLES, lang);
  const contracts = path.join(dir, 'contracts');
  const before = readTree(contracts);
  const [cmd, ...args] = LANGUAGES[lang](dir);
  must(cmd, args, dir);

  if (!isDeepStrictEqual(readTree(contracts), before)) {
    throw new Error(
      `the contract test changed ${path.relative(ROOT, contracts)}: commit the regenerated files`,
    );
  }

  const tmp = mkdtempSync(path.join(tmpdir(), `ac-${lang}-`));

  try {
    cpSync(contracts, path.join(tmp, 'base/contracts'), { recursive: true });
    cpSync(contracts, path.join(tmp, 'current/contracts'), { recursive: true });
    scan(path.join(tmp, 'base'), path.join(tmp, 'base-events'));

    const expected = JSON.parse(readFileSync(path.join(EXAMPLES, 'expected.json'), 'utf8'));
    const actual = summarize(contracts, path.join(tmp, 'base-events'));

    if (!isDeepStrictEqual(actual, expected)) {
      throw new Error(`catalog differs from expected.json:\n${JSON.stringify(actual, null, 2)}`);
    }

    const renamed = path.join(tmp, 'current', EVENT_SCHEMA);
    writeFileSync(renamed, readFileSync(renamed, 'utf8').replaceAll('"amount"', '"amountMinor"'));
    scan(path.join(tmp, 'current'), path.join(tmp, 'current-events'));

    const drift = ac([
      'drift',
      '--base',
      path.join(tmp, 'base-events'),
      '--current',
      path.join(tmp, 'current-events'),
    ]);

    if (
      drift.status !== 1 ||
      !drift.stdout.includes('`amount` (number) looks renamed to `amountMinor`')
    ) {
      throw new Error(
        `drift missed the renamed field (exit ${drift.status})\n${drift.stdout}${drift.stderr}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const requested = process.argv.slice(2);

const unknown = requested.filter((lang) => !(lang in LANGUAGES));

if (unknown.length > 0) {
  console.error(
    `unknown language: ${unknown.join(', ')} (known: ${Object.keys(LANGUAGES).join(', ')})`,
  );
  process.exit(2);
}

let failed = false;

for (const lang of requested.length > 0 ? requested : Object.keys(LANGUAGES)) {
  try {
    verify(lang);
    console.log(`✓ ${lang}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${lang}: ${error.message}`);
  }
}

process.exit(failed ? 1 : 0);
