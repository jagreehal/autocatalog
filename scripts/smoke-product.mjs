// Exercise the shipped CLI across package boundaries, without network access.
// Run after pnpm build; temporary repositories and output are removed on exit.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const workspace = path.resolve(import.meta.dirname, '..');

const cli = path.join(workspace, 'packages/events/cli/dist/bin.js');

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-product-'));

let root = path.join(work, 'repos');

let source = path.join(root, 'newcomer');

async function write(file, content) {
  const target = path.join(source, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function ac(args, expected = 0) {
  try {
    const result = await exec(process.execPath, [cli, ...args], {
      cwd: workspace,
      env: { ...process.env, AUTOCATALOG_DOCS_LINKS: 'error' },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });

    assert.equal(expected, 0, `Expected ac ${args[0]} to fail`);

    return result.stdout;
  } catch (error) {
    if (expected !== 0 && error.code === expected) return error.stdout;
    throw new Error(`ac ${args.join(' ')} failed:\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, {
      cause: error,
    });
  }
}

try {
  await fs.cp(path.join(workspace, 'examples/docs-demo/repos'), root, { recursive: true });
  await write('CODEOWNERS', '/contracts/events/ @Payments\n');
  await write(
    'docs/refunds.md',
    '---\ntitle: Refunds\nowner: Payments\ntier: standard\nabout:\n  - event/payments/refund.requested\n---\n[Runbook](runbook.md#replay)\n',
  );
  await write(
    'docs/runbook.md',
    '---\ntitle: Refund runbook\nowner: Payments\ntier: standard\n---\n## Replay\nReplay a refund.\n',
  );

  const schema = {
    title: 'RefundRequested',
    description: 'A refund was requested.',
    type: 'object',
    properties: { id: { type: 'string' }, amount: { type: 'number' } },
    required: ['id', 'amount'],
    'x-autocatalog': {
      id: 'refund.requested',
      version: '1.0.0+build.7',
      domain: 'payments',
      classification: 'integration',
      producers: ['PaymentService'],
      consumers: ['Ledger', 'Archive', 'Unknown'],
      consumerFields: { Ledger: ['amount'], Archive: ['id'] },
      transport: [{ address: 'refunds', protocols: ['kafka'] }],
    },
  };

  await write('contracts/events/refund.json', JSON.stringify(schema));
  await write('test/stray.json', '{"title":"Stray","type":"object"}');

  const broken = path.join(root, 'broken/events/payments/Broken');
  await fs.mkdir(broken, { recursive: true });
  await fs.writeFile(path.join(broken, 'autocatalog.json'), '{bad json');
  await fs.writeFile(path.join(broken, 'schema.json'), '{}');
  await ac(['validate', '--cwd', path.join(root, 'broken')], 1);

  await ac(['docs', 'check', root]);
  const out = path.join(work, 'site');
  await ac(['site', root, '--out', out, '--base', '/catalog/']);
  const graph = JSON.parse(await fs.readFile(path.join(out, 'catalog.json'), 'utf8'));
  const event = graph.resources.find((resource) => resource.ref.id === 'refund.requested');
  assert.ok(event, 'Contracts-only repositories must appear in the shipped site');
  assert.equal(event.owner.team, 'Payments');
  assert.equal(event.source.file, 'contracts/events/refund.json');
  assert.ok(!graph.resources.some((resource) => resource.ref.id === 'stray'));
  assert.ok(
    graph.relationships.some((edge) => edge.type === 'describes' && edge.to.id === event.ref.id),
  );

  const page = await fs.readFile(
    path.join(out, 'events/newcomer/payments/refund.requested/index.html'),
    'utf8',
  );

  assert.ok(
    page.includes('refunds') && page.includes('kafka'),
    'Transport must survive discovery and rendering',
  );
  const doc = await fs.readFile(path.join(out, 'newcomer/refunds/index.html'), 'utf8');
  assert.ok(
    doc.includes('/catalog/newcomer/runbook#replay'),
    'Source links must become site links',
  );
  await fs.access(
    path.join(out, 'events/payments-service/payments/payment.captured/v/0.9.0/schema.json'),
  );
  await fs.access(path.join(out, 'owners/payments/index.html'));
  const catalogPage = await fs.readFile(path.join(out, 'catalog/index.html'), 'utf8');
  assert.ok(
    catalogPage.includes('broken') && catalogPage.includes('Invalid event metadata'),
    'Quarantine must be visible while valid repositories still publish',
  );
  console.log('PASS: repository discovery → docs validation → site, ownership, history and links');

  // Identical Markdown must not reuse image/file paths from an old checkout.
  const relocated = path.join(work, 'relocated');
  await fs.rename(root, relocated);
  root = relocated;
  source = path.join(root, 'newcomer');
  await ac(['site', root, '--out', out, '--base', '/catalog/']);
  await fs.access(path.join(out, 'payments-service/runbook/index.html'));
  console.log('PASS: rebuilding from a relocated checkout preserves document images');

  const baseline = path.join(work, 'baseline');
  await ac(['scan', source, '--out', baseline]);
  const exported = path.join(work, 'eventcatalog');
  await ac(['to-eventcatalog', exported, '--root', baseline]);
  const imported = path.join(work, 'imported');
  await ac(['from-eventcatalog', exported, '--out', imported, '--strict']);
  const { loadCatalog } = await import('../packages/events/core/dist/index.js');
  const [roundtrip] = await loadCatalog(imported);
  assert.equal(roundtrip.frontmatter.classification, 'integration');
  assert.deepEqual(roundtrip.frontmatter.consumerFields, schema['x-autocatalog'].consumerFields);
  assert.deepEqual(roundtrip.schema.properties, schema.properties);
  console.log(
    'PASS: scan → EventCatalog export → strict import preserves contract and consumer fields',
  );

  schema.properties.amount = { type: 'string' };
  // A minor bump does not acknowledge a breaking change; a major one would pass the gate.
  schema['x-autocatalog'].version = '1.1.0';
  await write('contracts/events/refund.json', JSON.stringify(schema));
  const current = path.join(work, 'current');
  await ac(['scan', source, '--out', current]);

  const report = JSON.parse(
    await ac(['drift', '--base', baseline, '--current', current, '--format', 'json'], 1),
  );

  const breaking = report.findings.find(
    (finding) => finding.eventId === 'refund.requested' && finding.kind === 'type_changed',
  );

  assert.ok(breaking, 'The CLI must reject the breaking contract change');
  assert.deepEqual(breaking.consumers.sort(), ['Ledger', 'Unknown']);
  assert.deepEqual(breaking.usage.unaffected, ['Archive']);
  assert.match(breaking.advice, /bump to 2\.0\.0 \(1\.1\.0 is not a major bump\)/);
  console.log('PASS: regenerated contracts → failing CI gate with accurate consumer impact');

  // Following the advice: a major bump marks the break as intended, so the gate
  // passes, and the report still says exactly who to notify.
  schema['x-autocatalog'].version = '2.0.0';
  await write('contracts/events/refund.json', JSON.stringify(schema));
  const intended = path.join(work, 'intended');
  await ac(['scan', source, '--out', intended]);

  const accepted = JSON.parse(
    await ac(['drift', '--base', baseline, '--current', intended, '--format', 'json']),
  );

  const notified = accepted.findings.find(
    (finding) => finding.eventId === 'refund.requested' && finding.kind === 'type_changed',
  );

  assert.equal(notified?.acknowledged, true, 'A major bump acknowledges the breaking change');
  assert.deepEqual(notified.consumers.sort(), ['Ledger', 'Unknown']);
  console.log('PASS: following the advice (major bump) → gate passes, consumers still named');
} finally {
  await fs.rm(work, { recursive: true, force: true });
}
