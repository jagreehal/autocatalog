#!/usr/bin/env node
// Delivery verification against a real broker, at levels two and three.
//
//   node scripts/verify-delivery.mjs [out-dir]
//
// Starts a throwaway RabbitMQ in Docker, loads the definitions
// fixtures/delivery-rabbitmq declares, and runs `ac delivery verify`: the
// deployment matches, the GBP example reaches the ledger, the EUR one is
// excluded and a rejected message reaches the dead-letter queue. Then it
// deletes the ledger binding from the broker and checks that the same command
// fails, naming the missing route.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const FIXTURE = path.join(ROOT, 'fixtures/delivery-rabbitmq');

const OUT = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'ac-delivery-')));

const NAME = `ac-delivery-${process.pid}`;

const AUTH = `Basic ${Buffer.from('guest:guest').toString('base64')}`;

function sh(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });

  if (result.error) throw result.error;

  return result;
}

async function api(base, method, pathname, body, retried = false) {
  let response;

  try {
    response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // The broker closes idle keep-alive connections while the CLI runs; every
    // call here is safe to repeat once.
    if (retried) throw error;

    return api(base, method, pathname, body, true);
  }

  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status}`);

  const text = await response.text();

  return text ? JSON.parse(text) : null;
}

function verify(base, out, fixture = FIXTURE) {
  return sh(
    'pnpm',
    [
      '-s',
      'ac:events',
      'delivery',
      'verify',
      fixture,
      '--url',
      base.replace('//', '//guest:guest@'),
      '--disposable',
      '--out',
      out,
    ],
    { cwd: ROOT },
  );
}

function expectChecks(result, label, wanted) {
  const output = result.stdout + result.stderr;
  const missing = wanted.filter((line) => !output.includes(line));

  if (missing.length) throw new Error(`${label}: missing\n  ${missing.join('\n  ')}\n\n${output}`);

  console.log(`✓ ${label}`);
}

const started = sh('docker', [
  'run',
  '-d',
  '--rm',
  '--name',
  NAME,
  '-p',
  '127.0.0.1::15672',
  'rabbitmq:4-management',
]);

if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);

try {
  const port = sh('docker', ['port', NAME, '15672']).stdout.trim().split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  const ready = Date.now() + 90_000;

  for (;;) {
    try {
      await api(base, 'GET', '/api/overview');
      break;
    } catch {
      if (Date.now() > ready) throw new Error('RabbitMQ did not start within 90s');

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const definitions = JSON.parse(
    readFileSync(path.join(FIXTURE, 'infrastructure/rabbitmq/definitions.json'), 'utf8'),
  );

  await api(base, 'POST', '/api/definitions', definitions);

  const passing = verify(base, path.join(OUT, 'deployed'));

  if (passing.status !== 0)
    throw new Error(`verify failed on the declared deployment\n${passing.stdout}${passing.stderr}`);

  expectChecks(passing, 'declared deployment delivers', [
    'PASS        declared route payments → ledger.payments exists',
    'PASS        matching example example-1 reaches LedgerService',
    'PASS        rejected example example-2 is excluded',
    'PASS        failed processing reaches ledger.dead-letter',
    'PASS        consumer recovers: a message LedgerService failed once is redelivered and processed',
  ]);

  // Retries: the ledger's queue becomes a quorum queue that gives up after three
  // failed deliveries, in the repository and on the broker alike.
  const quorum = path.join(OUT, 'quorum-fixture');

  cpSync(FIXTURE, quorum, { recursive: true });

  const limited = structuredClone(definitions);
  const ledger = limited.queues.find((queue) => queue.name === 'ledger.payments');

  ledger.arguments = { ...ledger.arguments, 'x-queue-type': 'quorum', 'x-delivery-limit': 3 };
  writeFileSync(
    path.join(quorum, 'infrastructure/rabbitmq/definitions.json'),
    `${JSON.stringify(limited, null, 2)}\n`,
  );

  await api(base, 'DELETE', '/api/queues/%2F/ledger.payments');
  await api(base, 'POST', '/api/definitions', limited);

  const retries = verify(base, path.join(OUT, 'quorum'), quorum);

  if (retries.status !== 0)
    throw new Error(`verify failed on the quorum queue\n${retries.stdout}${retries.stderr}`);

  expectChecks(retries, 'attempt limit dead-letters', [
    'PASS        a message that keeps failing reaches ledger.dead-letter after 4 deliveries (delivery limit 3)',
  ]);

  // The deployed limit drifts from the declared one: 1 on the broker, 3 in the repository.
  const loose = structuredClone(limited);

  loose.queues.find((queue) => queue.name === 'ledger.payments').arguments['x-delivery-limit'] = 1;
  await api(base, 'DELETE', '/api/queues/%2F/ledger.payments');
  await api(base, 'POST', '/api/definitions', loose);

  const drifted = verify(base, path.join(OUT, 'limit-drift'), quorum);

  if (drifted.status !== 1)
    throw new Error(
      `verify should fail on a drifted delivery limit (exit ${drifted.status})\n${drifted.stdout}`,
    );

  expectChecks(drifted, 'drifted delivery limit is reported', [
    'FAIL        queue ledger.payments has delivery limit 1 deployed, 3 declared',
    'where a delivery limit of 3 gives up after 4',
  ]);

  // Deployment drift: someone removes the ledger's binding on the broker.
  const [binding] = await api(base, 'GET', '/api/bindings/%2F/e/payments/q/ledger.payments');

  await api(
    base,
    'DELETE',
    `/api/bindings/%2F/e/payments/q/ledger.payments/${encodeURIComponent(binding.properties_key)}`,
  );

  const failing = verify(base, path.join(OUT, 'binding-removed'), quorum);

  if (failing.status !== 1)
    throw new Error(
      `verify should fail without the binding (exit ${failing.status})\n${failing.stdout}`,
    );

  expectChecks(failing, 'removed binding is reported', [
    'FAIL        declared route payments → ledger.payments is missing from the deployment',
    'FAIL        matching example example-1 did not reach LedgerService',
  ]);

  console.log(`artifacts: ${OUT}`);
} finally {
  sh('docker', ['rm', '-f', NAME]);
}
