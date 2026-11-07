import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runFlowsVerify } from '../src/commands/flows';

let root: string;

const write = async (file: string, body: string) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), body);
};

const flow = (code: string) => `---
title: Fulfil
entity: order
field: status
steps:
  - id: a
    title: Done
    transition: { from: new, to: done }
    code: [${code}]
---
`;

const run = (over = {}) =>
  runFlowsVerify({ root, repo: 'orders', write: false, json: false, ...over });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-flows-'));
  await write(
    'entities/order.md',
    '---\nname: Order\nlifecycles:\n  status:\n    states: [new, done]\n---\n',
  );
  await write('src/order.js', 'done');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('passes something unobserved, and writes the record beside the flows', async () => {
  await write('flows/fulfil.md', flow('src/order.js'));

  expect(await run({ write: true })).toBe(0);

  const evidence = JSON.parse(await fs.readFile(path.join(root, 'flows/evidence.json'), 'utf8'));

  expect(evidence.transitions[0]).toMatchObject({
    declared: 'yes',
    code: 'yes',
    observed: 'not checked',
  });
});

it('exits 1 when a claim is contradicted', async () => {
  await write('flows/fulfil.md', flow('src/gone.js'));

  expect(await run()).toBe(1);
});

it('refuses runtime counts in a shape it does not know', async () => {
  await write('flows/fulfil.md', flow('src/order.js'));
  await write('observed.json', '{"spec":"other"}');

  expect(await run({ observed: path.join(root, 'observed.json') })).toBe(1);
});

it('reports evidence it refused to write through a symlink, and exits 1', async () => {
  await write('flows/fulfil.md', flow('src/order.js'));
  await write('target.json', 'untouched');
  await fs.symlink(path.join(root, 'target.json'), path.join(root, 'flows/evidence.json'));

  expect(await run({ write: true })).toBe(1);
  expect(await fs.readFile(path.join(root, 'target.json'), 'utf8')).toBe('untouched');
});
