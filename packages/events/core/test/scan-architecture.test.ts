import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanArchitecture } from '../src/scan-architecture';
import { readResourceGraph, writeResourceGraph } from '../src/resource-store';
import {
  architectureResource,
  datastoreOwnership,
  emptyResourceGraph,
  promoteRelationship,
} from '../src/architecture';
import { driftResources } from '../src/resource-drift';
import type { ResourceGraph } from '../src/resource-graph';

const span = (traceId: string, service: string, operation: string) => ({
  resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
  scopeSpans: [
    {
      spans: [
        {
          traceId,
          spanId: `${traceId}-span`,
          attributes: [
            { key: 'db.system', value: { stringValue: 'mongodb' } },
            { key: 'db.name', value: { stringValue: 'finance' } },
            { key: 'db.mongodb.collection', value: { stringValue: 'statements' } },
            { key: 'db.operation', value: { stringValue: operation } },
          ],
        },
      ],
    },
  ],
});

const exportOf = (...resourceSpans: ReturnType<typeof span>[]) => ({ resourceSpans });

const edge = (graph: ResourceGraph | undefined, type: string, from: string) =>
  graph?.relationships.find((item) => item.type === type && item.from.id === from);

describe('architecture scan publication', () => {
  it('joins model contracts and trace observations, preserving promotions across rescans', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-architecture-'));

    try {
      await fs.writeFile(
        path.join(root, 'model.ts'),
        `import mongoose from 'mongoose'; const schema = new mongoose.Schema({ amount: Number }, { collection: 'statements' }); const Statement = mongoose.model('Statement', schema);`,
      );

      const options = {
        root,
        datastore: 'curve',
        database: 'finance',
        service: 'billing',
        traces: exportOf(span('trace-1', 'billing', 'insert')),
      };

      const first = await scanArchitecture(options);
      expect(first.errors).toEqual([]);
      expect(datastoreOwnership(first.graph)[0]?.writers).toEqual(['billing']);
      await writeResourceGraph(
        root,
        promoteRelationship(first.graph, first.graph.relationships[0]!),
      );

      const second = await scanArchitecture({ ...options, traces: undefined });
      expect(second.graph.relationships[0]).toMatchObject({
        provenance: 'declared',
        needsReview: false,
        evidence: { count: 1, sampleTraceIds: ['trace-1'] },
      });
      expect((await readResourceGraph(root))?.relationships[0]?.provenance).toBe('declared');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accumulates distinct exports, ignores a repeated export and keeps promoted evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-accumulate-'));
    const base = { root, datastore: 'curve' };
    const a = exportOf(span('trace-a', 'billing', 'insert'));

    const b = exportOf(
      span('trace-b1', 'billing', 'insert'),
      span('trace-b2', 'billing', 'update'),
      span('trace-b3', 'reporting', 'find'),
    );

    const c = exportOf(span('trace-c', 'reporting', 'find'));

    try {
      const first = await scanArchitecture({ ...base, traces: a });
      expect(first.errors).toEqual([]);
      await writeResourceGraph(
        root,
        promoteRelationship(first.graph, edge(first.graph, 'writes', 'billing')!),
      );

      const second = await scanArchitecture({ ...base, traces: b });
      expect(second.errors).toEqual([]);
      expect(edge(second.graph, 'writes', 'billing')).toMatchObject({
        provenance: 'declared',
        needsReview: false,
        evidence: {
          count: 3,
          sampleTraceIds: ['trace-a', 'trace-b1', 'trace-b2'],
          operations: ['insert', 'update'],
        },
      });
      expect(edge(second.graph, 'reads', 'reporting')?.evidence?.count).toBe(1);

      const repeated = await scanArchitecture({ ...base, traces: b });
      expect(repeated.errors).toEqual([]);
      expect(edge(repeated.graph, 'writes', 'billing')?.evidence?.count).toBe(3);
      expect(edge(repeated.graph, 'reads', 'reporting')?.evidence?.count).toBe(1);
      expect(repeated.graph.resources.find((r) => r.ref.id === 'statements')?.evidence?.count).toBe(
        4,
      );

      const third = await scanArchitecture({ ...base, traces: c });
      expect(third.errors).toEqual([]);
      expect(edge(third.graph, 'writes', 'billing')).toMatchObject({
        provenance: 'declared',
        evidence: { count: 3, sampleTraceIds: ['trace-a', 'trace-b1', 'trace-b2'] },
      });
      expect(edge(third.graph, 'reads', 'reporting')?.evidence).toMatchObject({
        count: 2,
        sampleTraceIds: ['trace-b3', 'trace-c'],
      });

      const refreshed = await scanArchitecture(base);
      expect(refreshed.errors).toEqual([]);
      expect(refreshed.graph.relationships).toEqual(third.graph.relationships);
      expect(await readResourceGraph(root)).toEqual(third.graph);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('demotes deleted code edges to observations when evidence exists, else drops them', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-deleted-code-'));
    const options = { root, datastore: 'curve', database: 'finance', service: 'billing' };

    try {
      await fs.writeFile(
        path.join(root, 'model.ts'),
        `import mongoose from 'mongoose'; const schema = new mongoose.Schema({ amount: Number }, { collection: 'statements' }); const Statement = mongoose.model('Statement', schema); Statement.create({ amount: 1 }); Statement.find({}, { amount: 1 });`,
      );

      const extracted = await scanArchitecture({
        ...options,
        traces: exportOf(span('trace-1', 'billing', 'insert')),
      });

      expect(extracted.errors).toEqual([]);
      expect(edge(extracted.graph, 'writes', 'billing')).toMatchObject({
        provenance: 'extracted',
        source: { file: 'model.ts' },
      });
      expect(edge(extracted.graph, 'reads', 'billing')?.evidence).toBeUndefined();

      await fs.writeFile(path.join(root, 'model.ts'), `export const nothing = 1;`);
      const rescanned = await scanArchitecture(options);
      expect(rescanned.errors).toEqual([]);
      const writes = edge(rescanned.graph, 'writes', 'billing');
      expect(writes).toMatchObject({ provenance: 'observed', needsReview: true });
      expect(writes?.source).toBeUndefined();
      expect(writes?.attributes).toBeUndefined();
      expect(writes?.evidence?.sampleTraceIds).toEqual(['trace-1']);
      expect(edge(rescanned.graph, 'reads', 'billing')).toBeUndefined();

      const statements = rescanned.graph.resources.find((r) => r.ref.id === 'statements');
      expect(statements).toMatchObject({ needsReview: true, provenance: { default: 'inferred' } });
      expect(statements?.source).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('scanning an ordinary repository', () => {
  it('flags a traced read of a collection another team owns, from CODEOWNERS and Backstage', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-cross-owner-'));

    try {
      await fs.writeFile(
        path.join(root, 'model.ts'),
        `import mongoose from 'mongoose'; const schema = new mongoose.Schema({ amount: Number }, { collection: 'statements' }); const Statement = mongoose.model('Statement', schema);`,
      );
      await fs.writeFile(path.join(root, 'CODEOWNERS'), 'model.ts @ledger\n');
      await fs.writeFile(
        path.join(root, 'catalog-info.yaml'),
        'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: checkout\nspec:\n  type: service\n  owner: payments\n',
      );

      const options = { root, datastore: 'curve', database: 'finance', publish: false };
      const baseline = await scanArchitecture(options);

      const current = await scanArchitecture({
        ...options,
        traces: exportOf(span('trace-1', 'checkout', 'find')),
      });

      expect(current.errors).toEqual([]);
      expect(
        driftResources(baseline.graph, current.graph)
          .filter((finding) => finding.code === 'cross_owner_access')
          .map((finding) => [finding.severity, finding.message]),
      ).toEqual([
        [
          'breaking',
          'checkout (payments) reads collection curve/finance/statements, which ledger owns',
        ],
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('counts only ownership files towards the file limit, so a large repository still scans', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-limit-'));

    try {
      await fs.mkdir(path.join(root, 'assets'));
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          fs.writeFile(path.join(root, 'assets', `${index}.png`), ''),
        ),
      );
      await fs.writeFile(
        path.join(root, 'catalog-info.yaml'),
        'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: billing\nspec:\n  owner: ledger\n',
      );

      const result = await scanArchitecture({ root, maxFiles: 5, publish: false });

      expect(result.errors).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports sources that disagree instead of failing the scan', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'architecture-contested-'));

    try {
      const imported = emptyResourceGraph();

      const users = architectureResource(
        { kind: 'collection', namespace: 'default/default', id: 'users' },
        { schema: { type: 'object', properties: { id: { type: 'number' } } } },
      );

      users.provenance = { default: 'declared', fields: {} };
      imported.resources.push(users);

      await fs.mkdir(path.join(root, '.autocatalog/imports'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.autocatalog/imports/registry.json'),
        JSON.stringify({ graph: imported, claims: [] }),
      );
      await fs.writeFile(
        path.join(root, 'user.ts'),
        "import mongoose from 'mongoose';\nexport const User = mongoose.model('User', new mongoose.Schema({ id: String }), 'users');\n",
      );

      const result = await scanArchitecture({ root, publish: false });

      expect(result.errors).toEqual([]);
      expect(result.skipped).toContain(
        'collection default/default/users: sources disagree on its schema; it is left out until they agree',
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
