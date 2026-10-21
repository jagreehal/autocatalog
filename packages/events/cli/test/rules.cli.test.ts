import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { jsonSchemaDiscoveryAdapter, type DriftReport } from 'autocatalog-core';
import { runDrift } from '../src/commands/drift';

const execFileAsync = promisify(execFile);

const schema = (id: string) =>
  JSON.stringify({
    $id: id,
    title: id,
    type: 'object',
    properties: { id: { type: 'string' } },
    'x-autocatalog': { id, version: '1.0.0', domain: 'payments' },
  });

// TypeScript, run as Node runs it: types stripped, nothing compiled.
const OWNERS_RULE = `
type Graph = { resources: Array<{ ref: { kind: string; namespace?: string; id: string }; owner?: unknown }> };

export default {
  id: 'events-have-owners',
  name: 'Every event has an owner',
  run: ({ current }: { current: Graph }) =>
    current.resources
      .filter((resource) => resource.ref.kind === 'event' && !resource.owner)
      .map((resource) => ({ message: 'no owner', resource: resource.ref, suggestion: 'Add it to CODEOWNERS' })),
};
`;

describe('ac drift with catalog rules', () => {
  let repo: string;

  const write = async (file: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await fs.writeFile(path.join(repo, file), text);
  };

  // Rules are read from the base, so a rule change counts once it is committed.
  const commit = async () => {
    await execFileAsync('git', ['add', '-A', 'contracts'], { cwd: repo });
    await execFileAsync('git', ['commit', '-q', '-m', 'rules'], { cwd: repo });
  };

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-rules-test-'));
    await write('schemas/payment.completed.schema.json', schema('payment.completed'));
    await write('contracts/rules/owners.rule.ts', OWNERS_RULE);
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await execFileAsync('git', ['add', '.'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: repo });
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  const drift = async (allowCodeExecution = true) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runDrift({
        baseRef: 'HEAD',
        root: repo,
        format: 'json',
        allowCodeExecution,
        adapters: [jsonSchemaDiscoveryAdapter],
      });

      // SAFETY: --format json prints the report and nothing else.
      const report = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as DriftReport;

      return { code, rules: report.findings.filter((f) => f.kind.startsWith('rule_')) };
    } finally {
      log.mockRestore();
    }
  };

  it('runs rules only with consent', async () => {
    await expect(drift(false)).rejects.toThrow(/contracts\/rules has 1 rule\(s\)/);
  });

  it('reports what the base already broke as info, and gates on what the change adds', async () => {
    const before = await drift();

    expect(before.code).toBe(0);
    expect(before.rules.map((f) => f.severity)).toEqual(['info']);
    expect(before.rules[0]!.message).toContain('Every event has an owner (events-have-owners)');

    await write('schemas/payment.refunded.schema.json', schema('payment.refunded'));

    const after = await drift();

    expect(after.code).toBe(1);
    expect(after.rules.map((f) => `${f.severity} ${f.eventId}`)).toEqual([
      'info event/payment.completed',
      'breaking event/payment.refunded',
    ]);
    expect(after.rules[1]!.message).toContain('no owner. Add it to CODEOWNERS');
  });

  it('checks a change against the base’s rules, so the change cannot loosen them', async () => {
    await fs.rm(path.join(repo, 'contracts/rules/owners.rule.ts'));
    await write(
      'contracts/rules/rules.json',
      JSON.stringify({ severity: { 'events-have-owners': 'off' } }),
    );

    expect((await drift()).code).toBe(1);

    await execFileAsync('git', ['checkout', '--', 'contracts'], { cwd: repo });
    await fs.rm(path.join(repo, 'contracts/rules/rules.json'));
  });

  it('takes severities and exceptions from rules.json', async () => {
    await write(
      'contracts/rules/rules.json',
      JSON.stringify({ except: { 'events-have-owners': ['event:payments/payment.ref*'] } }),
    );
    await commit();

    expect((await drift()).code).toBe(0);

    await write(
      'contracts/rules/rules.json',
      JSON.stringify({ severity: { 'events-have-owners': 'off' } }),
    );
    await commit();

    expect((await drift()).rules).toEqual([]);

    await fs.rm(path.join(repo, 'contracts/rules/rules.json'));
    await commit();
  });

  it('gives rules each event’s payload schema', async () => {
    await write(
      'contracts/rules/meaning.rule.mjs',
      `export default {
        id: 'ids-declare-meaning',
        name: 'Ids say what they identify',
        severity: 'info',
        run: ({ current }) =>
          current.resources
            .filter((r) => r.ref.kind === 'event' && r.attributes.payloadSchema?.properties?.id && !r.attributes.payloadSchema.properties.id['x-meaning'])
            .map((r) => ({ message: 'id declares no x-meaning', resource: r.ref })),
      };`,
    );
    await commit();

    const { rules } = await drift();

    expect(rules.filter((f) => f.message.includes('id declares no x-meaning'))).toHaveLength(2);

    await fs.rm(path.join(repo, 'contracts/rules/meaning.rule.mjs'));
    await commit();
  });

  it('fails the gate on a rule that could not run, without failing the others', async () => {
    await write(
      'contracts/rules/broken.rule.mjs',
      `export default { id: 'broken', name: 'Broken', run: () => { throw new Error('boom'); } };`,
    );
    await commit();

    const { code, rules } = await drift();

    expect(code).toBe(1);
    expect(rules.map((f) => `${f.severity} ${f.kind}`)).toContain('breaking rule_failed');
    expect(rules.find((f) => f.kind === 'rule_failed')!.message).toContain('boom');
    expect(rules.filter((f) => f.kind === 'rule_violation')).toHaveLength(2);
  });
});
