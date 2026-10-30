import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanCommandResources, validateCommands } from '../src/command-resources';
import { discoverJsonSchemas } from '../src/scan-json-schema';

describe('command contracts', () => {
  it('draws the queue a command replies on', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-commands-'));
    const folder = path.join(root, 'commands', 'ReserveStock');

    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(
        path.join(folder, 'autocatalog.json'),
        JSON.stringify({
          id: 'ReserveStock',
          version: '1.0.0',
          name: 'Reserve stock',
          summary: 'Hold stock for an order',
          domain: 'inventory',
          senders: ['orders'],
          handler: 'inventory',
          outcome: { type: 'result', schema: './reply.json', replyTo: 'stock-replies' },
        }),
      );
      await fs.writeFile(path.join(folder, 'schema.json'), '{"type":"object"}');
      await fs.writeFile(path.join(folder, 'reply.json'), '{"type":"object"}');

      const { errors, graph } = await scanCommandResources({ root });
      const queue = { kind: 'queue', namespace: 'inventory', id: 'stock-replies' };

      expect(errors).toEqual([]);
      expect(graph.resources.map((resource) => resource.ref)).toContainEqual(queue);
      expect(graph.relationships).toContainEqual(
        expect.objectContaining({
          type: 'repliesTo',
          from: { kind: 'command', namespace: 'inventory', id: 'ReserveStock', version: '1.0.0' },
          to: queue,
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('discovers a queued command with one logical handler and an expected outcome', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-commands-'));
    const folder = path.join(root, 'commands', 'ledger', 'GenerateStatement');

    try {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(
        path.join(folder, 'autocatalog.json'),
        JSON.stringify({
          kind: 'command',
          id: 'GenerateStatement',
          version: '1.0.0',
          name: 'Generate statement',
          summary: 'Generate a monthly statement',
          domain: 'ledger',
          senders: ['billing'],
          handler: 'statement-worker',
          transport: [{ address: 'statement-jobs', protocols: ['sqs'] }],
          outcome: { type: 'completion' },
          schema: './schema.json',
        }),
      );
      await fs.writeFile(
        path.join(folder, 'schema.json'),
        JSON.stringify({
          type: 'object',
          properties: { accountId: { type: 'string' } },
          required: ['accountId'],
        }),
      );
      const result = await scanCommandResources({ root });
      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'command', namespace: 'ledger', id: 'GenerateStatement', version: '1.0.0' },
          attributes: expect.objectContaining({
            outcome: { type: 'completion' },
            schema: {
              type: 'object',
              properties: { accountId: { type: 'string' } },
              required: ['accountId'],
            },
          }),
        }),
      );
      expect(result.graph.relationships).toContainEqual(
        expect.objectContaining({
          type: 'handles',
          from: { kind: 'service', id: 'statement-worker' },
          to: { kind: 'command', namespace: 'ledger', id: 'GenerateStatement', version: '1.0.0' },
        }),
      );
      expect(validateCommands(result.graph)).toEqual([]);
      const command = result.graph.resources.find((resource) => resource.ref.kind === 'command')!;
      result.graph.relationships.push({
        type: 'handles',
        from: { kind: 'service', id: 'another-worker' },
        to: command.ref,
        provenance: 'declared',
        needsReview: false,
      });
      expect(validateCommands(result.graph)).toContainEqual(
        expect.objectContaining({ code: 'command_multiple_handlers', severity: 'breaking' }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('discovers command metadata embedded in a JSON Schema without also cataloging it as an event', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-embedded-command-'));

    try {
      await fs.writeFile(
        path.join(root, 'generate-statement.schema.json'),
        JSON.stringify({
          type: 'object',
          properties: { accountId: { type: 'string' } },
          'x-autocatalog': {
            kind: 'command',
            id: 'GenerateStatement',
            version: '1.0.0',
            name: 'Generate statement',
            summary: 'Generate statement',
            domain: 'ledger',
            handler: 'worker',
            outcome: { type: 'completion' },
          },
        }),
      );
      const result = await scanCommandResources({ root });
      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'command', namespace: 'ledger', id: 'GenerateStatement', version: '1.0.0' },
        }),
      );
      expect((await discoverJsonSchemas({ root })).events).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('command discovery in an ordinary repository', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-command-repo-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const write = async (file: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  };

  const manifest = {
    kind: 'command',
    id: 'generate-statement',
    version: '1.0.0',
    name: 'Generate statement',
    summary: 'Builds a statement',
    handler: 'worker',
  };

  it('ignores JSON outside the commands convention that is not a command', async () => {
    await write('src/tsconfig.schema.json', '{ // comments\n "a": 1 }');
    await write('graphql-schema.json', JSON.stringify({ data: 'x'.repeat(2048) }));
    await write('tools/autocatalog.json', JSON.stringify({ kind: 'event', id: 'x' }));
    await write('commands/generate-statement/autocatalog.json', JSON.stringify(manifest));
    await write('commands/generate-statement/schema.json', '{}');

    const result = await scanCommandResources({ root, maxFileBytes: 1024 });

    expect(result.errors).toEqual([]);
    expect(result.graph.resources.map((resource) => resource.ref)).toEqual([
      { kind: 'command', namespace: 'default', id: 'generate-statement', version: '1.0.0' },
      { kind: 'service', id: 'worker' },
    ]);
  });

  it('names the file and each invalid field of a command manifest', async () => {
    await write(
      'commands/generate-statement/autocatalog.json',
      JSON.stringify({ ...manifest, summary: undefined, owner: { team: 'ledger', contact: 'x' } }),
    );

    const result = await scanCommandResources({ root });

    expect(result.errors).toEqual([
      'commands/generate-statement/autocatalog.json: summary is required; owner.contact: Invalid URL',
    ]);
  });

  it('reports a conventional manifest that is not JSON', async () => {
    await write('commands/generate-statement/autocatalog.json', '{ nope');

    expect((await scanCommandResources({ root })).errors).toEqual([
      'commands/generate-statement/autocatalog.json: not valid JSON',
    ]);
  });

  it('keeps the namespace when the scan root moves', async () => {
    await write('services/billing/commands/gen/autocatalog.json', JSON.stringify(manifest));
    await write('services/billing/commands/gen/schema.json', '{}');

    const namespaces = async (scanRoot: string) =>
      (await scanCommandResources({ root: scanRoot })).graph.resources.flatMap((resource) =>
        resource.ref.kind === 'command' ? [resource.ref.namespace] : [],
      );

    expect(await namespaces(root)).toEqual(['default']);
    expect(await namespaces(path.join(root, 'services/billing'))).toEqual(['default']);
  });

  it('reports the file limit as skipped instead of failing', async () => {
    await write('commands/a/autocatalog.json', JSON.stringify({ ...manifest, id: 'a' }));
    await write('commands/a/schema.json', '{}');
    await write('commands/b/autocatalog.json', JSON.stringify({ ...manifest, id: 'b' }));
    await write('commands/b/schema.json', '{}');
    await write('README.md', '# not a candidate');

    const result = await scanCommandResources({ root, maxFiles: 2 });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([
      'Stopped after 2 candidate files (the file limit); the rest of the repository was not scanned',
    ]);
  });
});
