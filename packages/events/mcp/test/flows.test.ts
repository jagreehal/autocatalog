import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { loadCatalog } from '../src/tools.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-flows-'));

  const write = async (file: string, body: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), body);
  };

  await fs.mkdir(path.join(root, 'events'));
  await write(
    'entities/order.md',
    '---\nname: Order\nlifecycles:\n  status:\n    states: [new, done]\n---\n',
  );
  await write(
    'flows/fulfil.md',
    '---\ntitle: Fulfil\nentity: order\nfield: status\nsteps:\n  - id: a\n    title: Done\n    transition: { from: new, to: done }\n    rules: [Stock first]\n---\n',
  );
  await write(
    'docs/findings/one.md',
    '---\ntitle: One\nowner: Ops\nnature: question\nstatus: draft\ndate: 2026-11-06\nflow: fulfil\nstep: a\n---\n',
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('gives an agent a flow with each finding’s status, and how to read the counts', async () => {
  const server = createServer(await loadCatalog(path.join(root, 'events'), root));
  const client = new Client({ name: 'flows-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const call = async (args: Record<string, string>) => {
    const result = await client.callTool({ name: 'flow_context', arguments: args });

    // SAFETY: this tool always answers with one text block.
    return result as { isError?: boolean; content: Array<{ text: string }> };
  };

  const listed = await call({});

  expect(JSON.parse(listed.content[0]!.text).flows).toMatchObject([{ id: 'fulfil' }]);

  const context = JSON.parse((await call({ id: 'fulfil' })).content[0]!.text);

  expect(context.howToRead).toContain('hypothesis');
  expect(context.steps[0].notes).toMatchObject([
    { title: 'One', nature: 'question', status: 'draft', hotspot: true },
  ]);
  expect(context.observe).toEqual([
    {
      tool: 'autotel-mcp get_state_transitions',
      input: { entity: 'order', field: 'status' },
    },
  ]);

  await fs.writeFile(
    path.join(root, 'entities/order.md'),
    '---\nname: Order\nlifecycles:\n  capture.status:\n    states: [new, done]\n  status:\n    states: [new, done]\n---\n',
  );
  await fs.writeFile(
    path.join(root, 'flows/dotted.md'),
    '---\ntitle: Dotted\nentity: order\nsteps:\n  - id: a\n    title: A\n    field: capture.status\n    transition: { from: new, to: done }\n  - id: b\n    title: B\n    field: capture.status\n    transition: { from: done, to: new }\n  - id: c\n    title: C\n    field: status\n    transition: { from: new, to: done }\n---\n',
  );

  const dotted = JSON.parse((await call({ id: 'dotted' })).content[0]!.text);

  expect(dotted.observe.map((hint: { input: object }) => hint.input)).toEqual([
    { entity: 'order', field: 'capture.status' },
    { entity: 'order', field: 'status' },
  ]);

  await fs.writeFile(
    path.join(root, 'flows/evidence.json'),
    JSON.stringify({
      spec: 'autocatalog-flow-evidence/v0.1.0',
      checkedAt: '2026-11-06',
      transitions: [
        {
          flow: 'fulfil',
          step: 'a',
          entity: 'order',
          field: 'status',
          from: ['new'],
          to: 'gone',
          declared: 'yes',
          schema: 'yes',
          code: 'yes',
          observed: 'yes',
          rules: 'none',
          count: 9,
        },
      ],
      undeclared: [],
    }),
  );

  const stale = JSON.parse((await call({ id: 'fulfil' })).content[0]!.text);

  expect(stale.steps[0].evidence).toBe('not checked');

  expect((await call({ id: 'nope' })).isError).toBe(true);

  await client.close();
});
