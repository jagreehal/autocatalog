import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTOCATALOG_GRAPH_SPEC, parseFrontmatter } from 'autocatalog-core';
import { Model, validateModel } from '@eventcatalog/visualiser/model';
import { designSchema, readDesigns, studioModelSchema } from 'autocatalog-docs-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkDesign,
  designYaml,
  editableDesign,
  fromThisSite,
  openDesign,
  startDesign,
} from '../src/design-editor';
import { markSaved, savedBy } from '../src/dev-signals';

const FILE = `---
title: Refunds
status: proposed
resources:
  - { id: payments, type: domain, name: Payments }
  - { id: RefundService, type: service, parent: payments, summary: Pays money back. }
relations: []
---

Refunds get their own service.
`;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'autocatalog-design-editor-'));
  fs.mkdirSync(path.join(root, 'designs'));
  fs.writeFileSync(path.join(root, 'designs/refunds.md'), FILE);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const catalog = () => {
  const graph = { spec: AUTOCATALOG_GRAPH_SPEC, resources: [], relationships: [] };

  return {
    designs: readDesigns([{ repository: 'payments', dir: root }], graph).designs,
    repositoryRoots: { payments: root },
    graph,
    events: [],
    snapshots: [],
  };
};

describe('designYaml', () => {
  it('writes one line per resource and position, and leaves empty lists out', () => {
    const yaml = designYaml(
      designSchema.parse({
        title: 'Refunds',
        resources: [{ id: 'RefundService', type: 'service' }],
        layout: { messages: { RefundService: { x: 1, y: 2 } } },
      }),
    );

    expect(yaml).toContain('  - { id: RefundService, type: service }');
    expect(yaml).toContain('    RefundService: { x: 1, y: 2 }');
    expect(yaml).not.toContain('relations');
    expect(yaml).not.toContain('hotspots');
  });
});

describe('saving a design from the canvas', () => {
  it('writes what the canvas holds, keeping the body, and refuses what would not hold', () => {
    const docs = catalog();
    const editable = editableDesign(docs, 'payments', 'refunds')!;
    const { model } = openDesign(docs, editable);

    model.resources.push({ id: 'event-1a2b3c4d', type: 'event', name: 'Refund issued' });
    model.relations.push({ from: 'RefundService', to: 'event-1a2b3c4d', kind: 'sends' });

    const check = () =>
      checkDesign(
        docs,
        editable,
        studioModelSchema.parse(model),
        validateModel(Model.parse(model)),
        'this-tab',
      );

    const result = check();

    expect(result).toMatchObject({ ok: true, saved: true });

    const written = fs.readFileSync(path.join(root, 'designs/refunds.md'), 'utf8');

    expect(written).toContain('  - { id: refund-issued, type: event, name: Refund issued }');
    expect(written).toContain('  - { from: RefundService, to: refund-issued, kind: sends }');
    expect(written.endsWith('\nRefunds get their own service.\n')).toBe(true);
    expect(designSchema.safeParse(parseFrontmatter(written).data).success).toBe(true);

    // A relation to nothing is refused, and nothing is written.
    model.relations.push({ from: 'RefundService', to: 'nowhere', kind: 'sends' });
    expect(check()).toMatchObject({ ok: false });
    expect(fs.readFileSync(path.join(root, 'designs/refunds.md'), 'utf8')).toBe(written);
  });

  it('takes a change only from this site, so no page elsewhere can write through the dev server', () => {
    const url = new URL('http://localhost:4321/designs/payments/refunds/edit.json');

    const request = (headers: Record<string, string>) =>
      new Request(url, { method: 'POST', headers, body: '{}' });

    expect(
      fromThisSite(request({ origin: url.origin, 'content-type': 'application/json' }), url),
    ).toBe(true);
    expect(
      fromThisSite(
        request({ origin: 'https://elsewhere.example', 'content-type': 'application/json' }),
        url,
      ),
    ).toBe(false);
    // A plain form post needs no permission from the browser, so it is refused too.
    expect(fromThisSite(request({ 'content-type': 'text/plain' }), url)).toBe(false);
  });
});

describe('starting a design', () => {
  it('writes an empty design named after its title, never over one the repository has', () => {
    const roots = { repositoryRoots: { payments: root } };

    expect(startDesign(roots, 'payments', 'Refunds')).toEqual({ ok: true, id: 'refunds-2' });
    expect(startDesign(roots, 'payments', 'Fraud checks!')).toEqual({
      ok: true,
      id: 'fraud-checks',
    });
    expect(fs.readFileSync(path.join(root, 'designs/refunds.md'), 'utf8')).toBe(FILE);

    const started = fs.readFileSync(path.join(root, 'designs/fraud-checks.md'), 'utf8');

    expect(started).toBe('---\ntitle: Fraud checks!\nstatus: draft\n---\n');
  });

  it('refuses a repository the site does not read, and a title with nothing to name a file', () => {
    const roots = { repositoryRoots: { payments: root } };

    expect(startDesign(roots, 'elsewhere', 'Refunds')).toMatchObject({ ok: false });
    expect(startDesign(roots, 'payments', '!!!')).toMatchObject({ ok: false });
  });

  it('opens an empty design on the canvas and saves what is drawn on it', () => {
    startDesign({ repositoryRoots: { payments: root } }, 'payments', 'Fraud checks');

    const docs = catalog();
    const editable = editableDesign(docs, 'payments', 'fraud-checks')!;
    const { model } = openDesign(docs, editable);

    expect(model.resources).toEqual([]);

    model.resources.push({ id: 'service-1a2b3c4d', type: 'service', name: 'FraudCheck' });

    const result = checkDesign(
      docs,
      editable,
      studioModelSchema.parse(model),
      validateModel(Model.parse(model)),
      'this-tab',
    );

    expect(result).toMatchObject({ ok: true, review: { added: [{ id: 'service-1a2b3c4d' }] } });
    expect(fs.readFileSync(editable.file, 'utf8')).toContain(
      '  - { id: FraudCheck, type: service }',
    );
  });
});

it('names the tab whose save a file holds, and no tab once anyone else writes it', () => {
  const file = path.join(root, 'designs/refunds.md');
  const other = path.join(root, 'designs/fraud-checks.md');

  markSaved(file, FILE, 'tab-a');
  fs.writeFileSync(other, FILE);

  expect(savedBy(file)).toBe('tab-a');
  expect(savedBy(other)).toBeUndefined();

  fs.writeFileSync(file, `${FILE}\nAn agent wrote this.\n`);

  expect(savedBy(file)).toBeUndefined();
});
