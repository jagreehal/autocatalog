import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonObjectSchema, type JsonObject } from 'autocatalog-core';
import { z } from 'zod';
import {
  runDocsCheck,
  runDocsInitConventions,
  runDocsInitSchema,
  runDocsSyncSchema,
} from '../src/commands/docs';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-cli-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const schemaFile = () => path.join(root, 'contracts/docs-frontmatter.json');

const readSchema = async () =>
  jsonObjectSchema.parse(JSON.parse(await fs.readFile(schemaFile(), 'utf8')));

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

describe('ac docs init-schema', () => {
  it('hands the organisation a contract it owns', async () => {
    expect(await runDocsInitSchema({ root, quiet: true })).toBe(0);

    const written = z
      .object({ required: z.array(z.string()), properties: jsonObjectSchema })
      .parse(await readSchema());

    expect(written.required).toEqual(['title', 'owner']);
    expect(Object.keys(written.properties)).toContain('related');
  });

  it('refuses to overwrite the contract a company has already edited', async () => {
    await write('contracts/docs-frontmatter.json', '{"type":"object"}');

    expect(await runDocsInitSchema({ root, quiet: true })).toBe(1);
    expect(await fs.readFile(schemaFile(), 'utf8')).toBe('{"type":"object"}');
  });

  it('writes where it is told, for a repo that keeps contracts elsewhere', async () => {
    const out = path.join(root, 'schemas/frontmatter.json');
    expect(await runDocsInitSchema({ root, schema: out, quiet: true })).toBe(0);
    await expect(fs.access(out)).resolves.toBeUndefined();
  });
});

describe('ac docs check', () => {
  it('enforces the contract the company committed, with no flag', async () => {
    await runDocsInitSchema({ root, quiet: true });
    // Close the contract: from here, an undeclared field is a failure.
    const schema = await readSchema();
    await fs.writeFile(schemaFile(), JSON.stringify({ ...schema, additionalProperties: false }));

    await write('a/docs/ok.md', '---\ntitle: Fine\nowner: Ops\n---\n\nBody.\n');
    expect(await runDocsCheck({ root, quiet: true })).toBe(0);

    await write('a/docs/rogue.md', '---\ntitle: T\nowner: Ops\nmood: chipper\n---\n\nBody.\n');
    expect(await runDocsCheck({ root, quiet: true })).toBe(1);
  });

  it('resolves about: to a service two repositories both name, as the site merges it', async () => {
    for (const repository of ['payments-service', 'billing-service']) {
      await write(
        `${repository}/events/${repository}/Settled/autocatalog.json`,
        JSON.stringify({
          spec: 'autocatalog/v2',
          id: `${repository}.settled`,
          version: '1.0.0',
          name: 'Settled',
          summary: 'Settled.',
          domain: repository,
          producers: ['LedgerService'],
          schema: 'schema.json',
        }),
      );
      await write(`${repository}/events/${repository}/Settled/schema.json`, '{"type":"object"}');
    }

    await write(
      'payments-service/docs/ledger.md',
      '---\ntitle: Ledger\nowner: Ops\nabout:\n  - service/LedgerService\n---\n\nBody.\n',
    );

    expect(await runDocsCheck({ root, quiet: true })).toBe(0);
  });

  it('leaves a flow naming another repository to the site, and fails one that does not hold together', async () => {
    await write(
      'payments-service/events/payments/Settled/autocatalog.json',
      JSON.stringify({
        spec: 'autocatalog/v2',
        id: 'payment.settled',
        version: '1.0.0',
        name: 'Settled',
        summary: 'Settled.',
        domain: 'payments',
        producers: ['LedgerService'],
        schema: 'schema.json',
      }),
    );
    await write('payments-service/events/payments/Settled/schema.json', '{"type":"object"}');

    const flow = (service: string, next: string) =>
      `---\ntitle: Settle\nsteps:\n  - id: ledger\n    service: ${service}\n    next_step: ${next}\n  - id: settled\n    event: payments/payment.settled\n---\n`;

    await write('payments-service/flows/settle.md', flow('LedgerService', 'settled'));
    expect(await runDocsCheck({ root, quiet: true })).toBe(0);

    // Another repository's service: not in this checkout, so the site checks it.
    await write('payments-service/flows/settle.md', flow('BillingService', 'settled'));
    expect(await runDocsCheck({ root, quiet: true })).toBe(0);

    await write('payments-service/flows/settle.md', flow('LedgerService', 'nowhere'));
    expect(await runDocsCheck({ root, quiet: true })).toBe(1);
  });

  it('names the contract when the check fails, not only when it passes', async () => {
    // Whoever is fixing a failure needs to know which rules produced it — and
    // an agent following /autocatalog-docs reads the contract from this line.
    await runDocsInitSchema({ root, quiet: true });
    await write('a/docs/bad.md', '---\ntitle: No owner\n---\n\nBody.\n');

    const said: string[] = [];

    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });

    expect(await runDocsCheck({ root, quiet: true })).toBe(1);
    spy.mockRestore();

    expect(said.join('\n')).toContain('contract: ');
    expect(said.join('\n')).toContain('docs-frontmatter.json');
  });
});

describe('ac docs init-conventions', () => {
  const conventionsFile = () => path.join(root, 'contracts/autocatalog.conventions.json');

  it('hands the organisation the built-in kinds to edit, and will not overwrite them', async () => {
    expect(await runDocsInitConventions({ root, quiet: true })).toBe(0);

    const written = z
      .object({ kinds: z.record(z.string(), z.object({ folder: z.string() })) })
      .parse(JSON.parse(await fs.readFile(conventionsFile(), 'utf8')));

    expect(Object.keys(written.kinds)).toEqual(['adr', 'runbook', 'incident']);
    expect(written.kinds.adr?.folder).toBe('adr');
    expect(await runDocsInitConventions({ root, quiet: true })).toBe(1);
  });

  it('is what ac docs check enforces from then on, with no flag', async () => {
    await runDocsInitConventions({ root, quiet: true });
    await write(
      'contracts/autocatalog.conventions.json',
      JSON.stringify({
        kinds: {
          postmortem: {
            label: 'Postmortems',
            folder: 'postmortems',
            schema: { required: ['severity'] },
          },
        },
      }),
    );
    await write('a/docs/postmortems/outage.md', '---\ntitle: Outage\nowner: Ops\n---\n\nBody.\n');

    const said: string[] = [];

    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });

    expect(await runDocsCheck({ root, quiet: true })).toBe(1);
    spy.mockRestore();

    expect(said.join('\n')).toContain(
      "outage.md (postmortem): (root): must have required property 'severity'",
    );
    expect(said.join('\n')).toMatch(/kinds: \S*contracts[\\/]autocatalog\.conventions\.json/);
  });
});

describe('ac docs sync-schema', () => {
  /** The organisation's canonical contract, in a sibling checkout. */
  async function upstream(schema: JsonObject): Promise<string> {
    const file = path.join(root, 'handbook/contracts/docs-frontmatter.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(schema, null, 2));

    return file;
  }

  it('passes when the copy still matches, so CI can gate on it', async () => {
    await runDocsInitSchema({ root, quiet: true });

    const canonical = await upstream(await readSchema());

    expect(await runDocsSyncSchema({ root, from: canonical, quiet: true })).toBe(0);
  });

  it('fails, and names what changed, when the organisation moved on', async () => {
    await runDocsInitSchema({ root, quiet: true });
    const local = await readSchema();
    const canonical = await upstream({ ...local, required: ['title', 'owner', 'tier'] });

    const said: string[] = [];

    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '));
    });

    expect(await runDocsSyncSchema({ root, from: canonical, quiet: true })).toBe(1);
    spy.mockRestore();

    expect(said.join('\n')).toContain('drifted');
    expect(said.join('\n')).toContain('tier is now required');
  });

  it('updates the copy with --write, and says to re-check the documents', async () => {
    await runDocsInitSchema({ root, quiet: true });
    const local = await readSchema();
    const canonical = await upstream({ ...local, required: ['title', 'owner', 'tier'] });

    expect(await runDocsSyncSchema({ root, from: canonical, write: true, quiet: true })).toBe(0);
    const after = await readSchema();
    expect(after.required).toEqual(['title', 'owner', 'tier']);
    // Taking a stricter contract can invalidate documents that passed before.
    expect(await runDocsSyncSchema({ root, from: canonical, quiet: true })).toBe(0);
  });

  it('fails when there is nothing to compare against', async () => {
    expect(await runDocsSyncSchema({ root, quiet: true })).toBe(1);
  });

  it('fails when the copy does not record where it came from', async () => {
    await runDocsInitSchema({ root, quiet: true });
    expect(await runDocsSyncSchema({ root, quiet: true })).toBe(1);
  });

  it('fails when the source cannot be read, rather than reporting success', async () => {
    await runDocsInitSchema({ root, quiet: true });
    expect(await runDocsSyncSchema({ root, from: path.join(root, 'gone.json'), quiet: true })).toBe(
      1,
    );
  });
});
