import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  scanModelResources,
  exportMongooseModels,
  type ModelScanOptions,
} from '../src/model-resources';
import { datastoreOwnership } from '../src/architecture';
import type { JsonValue } from '../src/json';
import { isArchitectureCatalogResource, type ResourceGraph } from '../src/resource-graph';

describe('model resources', () => {
  it('keeps exclusion projections conservative instead of claiming only excluded fields are read', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-excluded-model-fields-'));

    try {
      await fs.writeFile(
        path.join(root, 'model.ts'),
        `import mongoose from 'mongoose'; const schema = new mongoose.Schema({ amount: Number, currency: String }, { collection: 'statements' }); const Statement = mongoose.model('Statement', schema); Statement.find({}, { amount: 0 });`,
      );
      const result = await scanModelResources({ root, service: 'reporting' });
      expect(result.errors).toEqual([]);
      expect(
        result.graph.relationships.find((edge) => edge.type === 'reads')?.attributes?.fields,
      ).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('extracts the Mongoose contract and code accesses without evaluating repository code', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-models-'));

    try {
      await fs.writeFile(
        path.join(root, 'statements.ts'),
        `
        import mongoose from 'mongoose';
        throw new Error('This module must never execute');
        const statementSchema = new mongoose.Schema({
          amount: { type: Number, required: true },
          currency: { type: String, enum: ['GBP', 'EUR'], required: true },
          settledAt: Date,
          items: [{ sku: { type: String, required: true } }],
        }, { collection: 'statements' });
        const Statement = mongoose.model('Statement', statementSchema);
        Statement.create({ amount: 42, currency: 'GBP' });
        Statement.find({}, { amount: 1 });
      `,
      );

      const result = await scanModelResources({
        root,
        datastore: 'acme',
        database: 'finance',
        service: 'billing',
      });

      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'collection', namespace: 'acme/finance', id: 'statements' },
          attributes: expect.objectContaining({
            adapter: 'mongoose',
            schema: {
              type: 'object',
              properties: {
                amount: { type: 'number' },
                currency: { type: 'string', enum: ['GBP', 'EUR'] },
                settledAt: { type: 'string', format: 'date-time' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { sku: { type: 'string' } },
                    required: ['sku'],
                  },
                },
              },
              required: ['amount', 'currency'],
            },
          }),
        }),
      );
      expect(datastoreOwnership(result.graph)[0]).toMatchObject({
        writers: ['billing'],
        readers: ['billing'],
      });
      expect(result.graph.relationships).toContainEqual(
        expect.objectContaining({ type: 'reads', attributes: { fields: ['amount'] } }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('extracts mapped Prisma tables and distinguishes nullable columns from relations', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-prisma-'));

    try {
      await fs.writeFile(
        path.join(root, 'schema.prisma'),
        `
        datasource db { provider = "postgresql" }
        enum Currency {
          GBP
          EUR
        }
        model Statement {
          id Int @id @default(autoincrement())
          total Decimal @map("amount")
          currency Currency
          settledAt DateTime? @map("settled_at")
          customerId Int
          customer Customer @relation(fields: [customerId], references: [id])
          @@map("statements")
          @@schema("ledger")
        }
        model Customer {
          id Int @id
          statements Statement[]
        }
      `,
      );

      const result = await scanModelResources({
        root,
        datastore: 'acme',
        database: 'finance',
        service: 'billing',
      });

      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'table', namespace: 'acme/finance', id: 'ledger.statements' },
          attributes: expect.objectContaining({
            adapter: 'prisma',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                amount: { type: 'string', format: 'decimal' },
                currency: { type: 'string', enum: ['GBP', 'EUR'] },
                settled_at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
                customerId: { type: 'integer' },
              },
              required: ['id', 'amount', 'currency', 'settled_at', 'customerId'],
            },
          }),
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('extracts Drizzle columns, nullable values, and read/write query edges', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-drizzle-'));

    try {
      await fs.writeFile(
        path.join(root, 'tables.ts'),
        `
        import { pgTable, serial, numeric, text, timestamp } from 'drizzle-orm/pg-core';
        export const statements = pgTable('statements', {
          id: serial('id').primaryKey(), amount: numeric('amount').notNull(),
          currency: text('currency', { enum: ['GBP', 'EUR'] }).notNull(), settledAt: timestamp('settled_at'),
        });
        db.insert(statements).values({ amount: '42' });
        db.select().from(statements);
      `,
      );

      const result = await scanModelResources({
        root,
        datastore: 'acme',
        database: 'finance',
        service: 'billing',
      });

      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'table', namespace: 'acme/finance', id: 'statements' },
          attributes: expect.objectContaining({
            adapter: 'drizzle',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                amount: { type: 'string', format: 'decimal' },
                currency: { type: 'string', enum: ['GBP', 'EUR'] },
                settled_at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
              },
              required: ['id', 'amount', 'currency', 'settled_at'],
            },
          }),
        }),
      );
      expect(datastoreOwnership(result.graph)[0]).toMatchObject({
        writers: ['billing'],
        readers: ['billing'],
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('resolves model imports in reader modules and does not lose multiple projections', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-import-models-'));

    try {
      await fs.writeFile(
        path.join(root, 'models.ts'),
        `import mongoose from 'mongoose'; const schema = new mongoose.Schema({ amount: Number, currency: String }, { collection: 'statements' }); export const Statement = mongoose.model('Statement', schema);`,
      );
      await fs.writeFile(
        path.join(root, 'reader.ts'),
        `import { Statement as BillingStatement } from './models.js'; BillingStatement.find({}, { amount: 1 }); BillingStatement.find({}, { currency: 1 });`,
      );

      const result = await scanModelResources({
        root,
        datastore: 'acme',
        database: 'finance',
        service: 'reporting',
      });

      expect(result.errors).toEqual([]);
      expect(datastoreOwnership(result.graph)[0]?.readers).toEqual(['reporting']);
      expect(
        result.graph.relationships.find((edge) => edge.type === 'reads')?.attributes?.fields,
      ).toEqual(['amount', 'currency']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('uses an explicit model export for contracts assembled through plugins or application code', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-export-models-'));

    try {
      const definitions = exportMongooseModels(
        [
          {
            modelName: 'Statement',
            collection: { collectionName: 'statements' },
            schema: {
              toJSONSchema: () => ({
                type: 'object',
                properties: { pluginField: { type: 'string' } },
                required: ['pluginField'],
              }),
            },
          },
        ],
        { datastore: 'acme', database: 'finance' },
      );

      await fs.mkdir(path.join(root, '.autocatalog'));
      await fs.writeFile(
        path.join(root, '.autocatalog', 'models.json'),
        JSON.stringify(definitions),
      );
      const result = await scanModelResources({ root });
      expect(result.errors).toEqual([]);
      expect(result.graph.resources).toContainEqual(
        expect.objectContaining({
          ref: { kind: 'collection', namespace: 'acme/finance', id: 'statements' },
          attributes: expect.objectContaining({
            schema: {
              type: 'object',
              properties: { pluginField: { type: 'string' } },
              required: ['pluginField'],
            },
          }),
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('connects Prisma client reads and writes to mapped physical columns', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-prisma-access-'));

    try {
      await fs.writeFile(
        path.join(root, 'schema.prisma'),
        'model Statement {\n  id Int @id\n  total Float @map("amount")\n  @@map("statements")\n}\n',
      );
      await fs.writeFile(
        path.join(root, 'client.ts'),
        `import { PrismaClient } from '@prisma/client'; export const prisma = new PrismaClient();`,
      );
      await fs.writeFile(
        path.join(root, 'worker.ts'),
        `import { prisma } from './client'; prisma.statement.findMany({ select: { total: true } }); prisma.statement.update({ where: { id: 1 }, data: { total: 42 } });`,
      );

      const result = await scanModelResources({
        root,
        datastore: 'acme',
        database: 'finance',
        service: 'reporting',
      });

      expect(result.errors).toEqual([]);
      expect(datastoreOwnership(result.graph)[0]).toMatchObject({
        writers: ['reporting'],
        readers: ['reporting'],
      });
      expect(
        result.graph.relationships.find((edge) => edge.type === 'reads')?.attributes?.fields,
      ).toEqual(['amount']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

type Edge = [type: string, id: string, provenance: string, needsReview: boolean, fields?: string[]];

/** Write a throwaway repository, scan it, and remove it. */
async function scanFiles(
  files: Record<string, string>,
  options: Partial<ModelScanOptions> = {},
  directory = 'ac-models-',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), directory));

  try {
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), content);
    }

    return await scanModelResources({ root, service: 'svc', ...options });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function edges(graph: ResourceGraph): Edge[] {
  return graph.relationships
    .map((edge): Edge => {
      const fields = z.array(z.string()).optional().parse(edge.attributes?.fields);

      const row: [string, string, string, boolean] = [
        edge.type,
        edge.to.id,
        edge.provenance,
        edge.needsReview,
      ];

      return fields ? [...row, fields] : row;
    })
    .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`));
}

function schemaOf(graph: ResourceGraph, id: string): JsonValue | undefined {
  const resource = graph.resources.find((item) => item.ref.id === id);

  return resource && isArchitectureCatalogResource(resource)
    ? resource.attributes.schema
    : undefined;
}

const mongooseModel = (collection: string, extra = '') =>
  `import mongoose from 'mongoose'; const s = new mongoose.Schema({ a: String, b: String }, { collection: '${collection}' }); ${extra}`;

describe('Prisma schema parsing', () => {
  it('keeps a model whole when a string attribute contains a brace', async () => {
    const result = await scanFiles({
      'schema.prisma': `datasource db { provider = "postgresql" }
model Settings {
  id Int @id
  data Json @default("{}")
  raw Json @default(dbgenerated("'{}'::jsonb"))
  ownerId Int @map("owner_id") // the owning account
  @@map("user_settings")
}`,
    });

    expect(result.errors).toEqual([]);
    expect(schemaOf(result.graph, 'user_settings')).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, data: {}, raw: {}, owner_id: { type: 'integer' } },
      required: ['id', 'data', 'raw', 'owner_id'],
    });
  });

  it('does not treat // inside a string as a comment', async () => {
    const result = await scanFiles({
      'schema.prisma': `model User {
  id Int @id
  avatar String @default("https://x/a.png") @map("avatar_url")
  @@map("users")
}`,
    });

    expect(schemaOf(result.graph, 'users')).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, avatar_url: { type: 'string' } },
      required: ['id', 'avatar_url'],
    });
  });

  it('uses the mapped database value of an enum member', async () => {
    const result = await scanFiles({
      'schema.prisma': `enum Status {
  ACTIVE @map("active")
  INACTIVE @map("inactive")
  PENDING
}
model User {
  id Int @id
  status Status
}`,
    });

    expect(schemaOf(result.graph, 'User')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        status: { type: 'string', enum: ['active', 'inactive', 'PENDING'] },
      },
      required: ['id', 'status'],
    });
  });

  it('reads the datasource provider from any schema file of a multi-file schema', async () => {
    const result = await scanFiles({
      'prisma/schema/schema.prisma': `datasource db {\n  provider = "mongodb"\n  url = env("DATABASE_URL")\n}`,
      'prisma/schema/user.prisma': `model User {\n  id String @id @map("_id")\n}`,
    });

    expect(result.graph.resources.map((resource) => resource.ref)).toEqual([
      { kind: 'collection', namespace: 'default/default', id: 'User' },
    ]);
  });

  it('scans hostile input in linear time', async () => {
    const started = performance.now();
    const result = await scanFiles({ 'schema.prisma': 'model a {'.repeat(34_000) });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.errors).toEqual([]);
    expect(result.graph.resources).toEqual([]);
    expect(result.skipped).toEqual(['schema.prisma: model a is never closed']);
  });
});

describe('Prisma client recognition', () => {
  const schema = `model User {\n  id Int @id\n  email String\n}\nmodel Post {\n  id Int @id\n}`;

  it.each([
    ['??', 'g.prisma ?? new PrismaClient()'],
    ['||', 'g.prisma || new PrismaClient({ log: [] })'],
    ['a conditional', "process.env.NODE_ENV === 'test' ? g.prisma : new PrismaClient()"],
  ])('recognises a singleton client created with %s', async (_, initializer) => {
    const result = await scanFiles({
      'schema.prisma': schema,
      'db.ts': `import { PrismaClient } from '@prisma/client'; const g = globalThis as any; export const prisma = ${initializer};`,
      'worker.ts': `import { prisma } from './db'; prisma.user.create({ data: {} });`,
    });

    expect(edges(result.graph)).toEqual([['writes', 'User', 'extracted', false]]);
  });

  it('follows the transaction client of a callback and the calls of a batch', async () => {
    const result = await scanFiles({
      'schema.prisma': schema,
      'db.ts': `import { PrismaClient } from '@prisma/client'; export const prisma = new PrismaClient();
prisma.$transaction(async (tx) => { await tx.user.create({ data: {} }); });
prisma.$transaction([prisma.post.findMany(), prisma.post.deleteMany()]);`,
    });

    expect(edges(result.graph)).toEqual([
      ['reads', 'Post', 'extracted', false],
      ['writes', 'Post', 'extracted', false],
      ['writes', 'User', 'extracted', false],
    ]);
  });
});

describe('Mongoose operations', () => {
  it.each([
    ['find', 'reads'],
    ['findOne', 'reads'],
    ['findById', 'reads'],
    ['aggregate', 'reads'],
    ['exists', 'reads'],
    ['estimatedDocumentCount', 'reads'],
    ['countDocuments', 'reads'],
    ['distinct', 'reads'],
    ['create', 'writes'],
    ['insertMany', 'writes'],
    ['findByIdAndUpdate', 'writes'],
    ['findByIdAndDelete', 'writes'],
    ['findByIdAndRemove', 'writes'],
    ['findOneAndRemove', 'writes'],
    ['bulkWrite', 'writes'],
    ['bulkSave', 'writes'],
    ['replaceOne', 'writes'],
    ['updateOne', 'writes'],
    ['deleteMany', 'writes'],
  ])('classifies %s as %s', async (method, type) => {
    const result = await scanFiles({
      'm.ts': mongooseModel('users', `const User = mongoose.model('User', s); User.${method}();`),
    });

    expect(edges(result.graph)).toEqual([[type, 'users', 'extracted', false]]);
  });

  it('does not treat an unrelated method as database access', async () => {
    const result = await scanFiles({
      'm.ts': mongooseModel('users', `const User = mongoose.model('User', s); User.hydrate({});`),
    });

    expect(edges(result.graph)).toEqual([]);
  });
});

describe('model module resolution', () => {
  const model = mongooseModel('users', `export const User = mongoose.model('User', s);`);

  it.each<[string, Record<string, string>]>([
    [
      'a default export imported by default',
      {
        'm.ts': mongooseModel('users', `export default mongoose.model('User', s);`),
        'r.ts': `import Account from './m'; Account.find();`,
      },
    ],
    [
      'a named model exported as default',
      {
        'm.ts': mongooseModel(
          'users',
          `const User = mongoose.model('User', s); export default User;`,
        ),
        'r.ts': `import User from './m.js'; User.find();`,
      },
    ],
    [
      'a barrel named re-export',
      {
        'models/user.ts': model,
        'models/index.ts': `export { User as Account } from './user';`,
        'r.ts': `import { Account } from './models'; Account.find();`,
      },
    ],
    [
      'a barrel star re-export',
      {
        'models/user.ts': model,
        'models/index.ts': `export * from './user';`,
        'r.ts': `import { User } from './models/index.js'; User.find();`,
      },
    ],
    [
      'a local import re-exported by name',
      {
        'models/user.ts': model,
        'models/index.ts': `import { User } from './user'; export { User };`,
        'r.ts': `import { User } from './models'; User.find();`,
      },
    ],
    [
      'CommonJS module.exports and require',
      {
        'm.js': `const mongoose = require('mongoose'); const s = new mongoose.Schema({ a: String }, { collection: 'users' }); module.exports = mongoose.model('User', s);`,
        'r.js': `const User = require('./m'); User.find();`,
      },
    ],
    [
      'CommonJS named exports and destructured require',
      {
        'm.cjs': `const mongoose = require('mongoose'); const s = new mongoose.Schema({ a: String }, { collection: 'users' }); const User = mongoose.model('User', s); module.exports = { User };`,
        'r.cjs': `const { User: Account } = require('./m.cjs'); Account.find();`,
      },
    ],
    [
      'an .mts module imported as .mjs',
      { 'm.mts': model, 'r.mts': `import { User } from './m.mjs'; User.find();` },
    ],
    [
      'a .cts module imported as .cjs',
      { 'm.cts': model, 'r.cts': `import { User } from './m.cjs'; User.find();` },
    ],
    [
      'a .tsx module imported as .js',
      { 'm.tsx': model, 'r.tsx': `import { User } from './m.js'; User.find();` },
    ],
  ])('follows %s', async (_, files) => {
    const result = await scanFiles(files);

    expect(result.errors).toEqual([]);
    expect(edges(result.graph)).toEqual([['reads', 'users', 'extracted', false]]);
  });
});

describe('Drizzle tables', () => {
  const tables = `import { pgTable, text, integer } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: integer('id').primaryKey(), tags: text('tags').array().notNull(), notes: text('notes').array() });
export const posts = pgTable('posts', { id: integer('id').primaryKey() });
export const comments = pgTable('comments', { id: integer('id').primaryKey() });`;

  it('describes an array column as an array of its element type', async () => {
    const result = await scanFiles({ 't.ts': tables });

    expect(schemaOf(result.graph, 'users')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
      },
      required: ['id', 'tags', 'notes'],
    });
  });

  it('reads joined tables and tables queried through db.query', async () => {
    const result = await scanFiles({
      't.ts': tables,
      'q.ts': `import { users, posts, comments } from './t';
db.select().from(users).leftJoin(posts, eq(users.id, posts.id)).innerJoin(comments, eq(posts.id, comments.id));
db.query.posts.findMany(); db.query.comments.findFirst();`,
    });

    expect(edges(result.graph)).toEqual([
      ['reads', 'comments', 'extracted', false],
      ['reads', 'posts', 'extracted', false],
      ['reads', 'users', 'extracted', false],
    ]);
  });

  it('records writes only from Drizzle query builders', async () => {
    const result = await scanFiles({
      't.ts': `${tables}
const cache = new Map(); cache.get(users); cache.delete(users); cache.set(posts, 1); Array.from(comments);
await db.insert(users).values({}); await db.update(posts).set({}).where(x); await db.delete(comments);`,
    });

    expect(edges(result.graph)).toEqual([
      ['writes', 'comments', 'extracted', false],
      ['writes', 'posts', 'extracted', false],
      ['writes', 'users', 'extracted', false],
    ]);
  });
});

describe('Mongoose collection names', () => {
  it("applies Mongoose's pluralisation and marks the guessed name and its edges for review", async () => {
    const result = await scanFiles({
      'm.ts': `import mongoose from 'mongoose'; const s = new mongoose.Schema({ a: String });
const Category = mongoose.model('Category', s); const Person = mongoose.model('Person', s); const Sheep = mongoose.model('Sheep', s);
Category.deleteMany({}); Person.find();`,
    });

    const collections = result.graph.resources.filter(
      (resource) => resource.ref.kind === 'collection',
    );

    expect(
      collections.map((resource) => [
        resource.ref.id,
        resource.provenance.fields.id,
        resource.needsReview,
      ]),
    ).toEqual([
      ['categories', 'inferred', true],
      ['people', 'inferred', true],
      ['sheep', 'inferred', true],
    ]);
    expect(edges(result.graph)).toEqual([
      ['reads', 'people', 'inferred', true],
      ['writes', 'categories', 'inferred', true],
    ]);
  });
});

describe('resource identity', () => {
  it('names an unconfigured datastore and service the same way wherever the repository is checked out', async () => {
    const files = {
      'schema.prisma': `model User {\n  id Int @id\n}`,
      'db.ts': `import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.user.findMany();`,
    };

    const current = await scanFiles(files, { service: undefined }, 'current-');
    const baseline = await scanFiles(files, { service: undefined }, 'baseline-');

    expect(baseline.graph).toEqual(current.graph);
    expect(current.graph.resources.map((resource) => resource.ref)).toEqual([
      { kind: 'service', id: 'default' },
      { kind: 'table', namespace: 'default/default', id: 'User' },
    ]);
  });

  it('names the service after the package when it is not configured', async () => {
    const result = await scanFiles(
      {
        'package.json': JSON.stringify({ name: '@acme/billing' }),
        'm.ts': mongooseModel('users', `const User = mongoose.model('User', s); User.find();`),
      },
      { service: undefined },
    );

    expect(result.graph.relationships.map((edge) => edge.from)).toEqual([
      { kind: 'service', id: '@acme/billing' },
    ]);
  });

  it('reports two different definitions of one table instead of failing the scan', async () => {
    const result = await scanFiles({
      'services/a/schema.prisma': `model User {\n  id Int @id\n}`,
      'services/b/schema.prisma': `model User {\n  id String @id\n}`,
    });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([
      'table User is defined differently in services/a/schema.prisma and services/b/schema.prisma; its schema is left out until each is scanned with its own datastore',
    ]);

    const table = result.graph.resources.find((resource) => resource.ref.kind === 'table');

    expect(table).toMatchObject({ needsReview: true, provenance: { default: 'inferred' } });
    expect(schemaOf(result.graph, 'User')).toBeUndefined();
  });
});

describe('scan robustness', () => {
  it('skips an oversized source file and keeps scanning', async () => {
    const result = await scanFiles(
      {
        'schema.prisma': `model User {\n  id Int @id\n}`,
        'public/vendor.js': 'x'.repeat(2048),
      },
      { maxFileBytes: 1024 },
    );

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual(['public/vendor.js: larger than 1024 bytes']);
    expect(result.graph.resources.map((resource) => resource.ref.id)).toEqual(['User']);
  });

  it('counts only candidate files towards the file limit', async () => {
    const files = Object.fromEntries([
      ['schema.prisma', `model User {\n  id Int @id\n}`],
      ...Array.from({ length: 20 }, (_, index) => [`docs/page-${index}.md`, '# page']),
    ]);

    const result = await scanFiles(files, { maxFiles: 5 });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.graph.resources.map((resource) => resource.ref.id)).toEqual(['User']);
  });

  it('stops at the file limit with a warning rather than failing', async () => {
    const files: Record<string, string> = {};

    for (let index = 0; index < 4; index++) files[`m${index}.ts`] = 'export {};';

    const result = await scanFiles(files, { maxFiles: 2 });

    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([
      'Stopped after 2 candidate files (the file limit); the rest of the repository was not scanned',
    ]);
  });
});

describe('read projections', () => {
  it('treats a Mongoose projection with a spread as reading every field', async () => {
    const result = await scanFiles({
      'm.ts': mongooseModel(
        'users',
        `const User = mongoose.model('User', s); const base = { b: 1 }; User.find({}, { ...base, a: 1 });`,
      ),
    });

    expect(edges(result.graph)).toEqual([['reads', 'users', 'extracted', false]]);
  });

  it.each([
    ['a spread', '{ ...base, email: true }'],
    ['a computed value', '{ email: wanted }'],
    ['a shorthand property', '{ email }'],
  ])('treats a Prisma select with %s as reading every field', async (_, select) => {
    const result = await scanFiles({
      'schema.prisma': `model User {\n  id Int @id\n  email String\n}`,
      'db.ts': `import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.user.findMany({ select: ${select} });`,
    });

    expect(edges(result.graph)).toEqual([['reads', 'User', 'extracted', false]]);
  });

  it('keeps the literal subset of a Prisma select', async () => {
    const result = await scanFiles({
      'schema.prisma': `model User {\n  id Int @id\n  email String @map("email_address")\n}`,
      'db.ts': `import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient(); prisma.user.findMany({ select: { email: true, id: false } });`,
    });

    expect(edges(result.graph)).toEqual([['reads', 'User', 'extracted', false, ['email_address']]]);
  });
});

describe('Prisma model detail', () => {
  const library = `datasource db {
  provider = "mongodb"
}

/// A person who borrows books.
model Member {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  /// Where we send overdue notices.
  email     String   @unique
  tier      Tier     @default(STANDARD)
  joinedAt  DateTime @default(now())
  updatedAt DateTime @updatedAt
  address   Address?
  mentorId  String?  @db.ObjectId
  mentor    Member?  @relation("Mentoring", fields: [mentorId], references: [id])
  mentees   Member[] @relation("Mentoring")
  loans     Loan[]

  @@map("members")
}

model Loan {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  memberId String @db.ObjectId
  member   Member @relation(fields: [memberId], references: [id])
  bookIsbn String
  dueOn    DateTime /// Inclusive.

  @@index([memberId, dueOn(sort: Desc)])
  @@unique([memberId, bookIsbn], name: "one_copy_each")
}

type Address {
  street String
  city   String
}

enum Tier {
  STANDARD
  GOLD @map("gold")
}`;

  const resource = (graph: ResourceGraph, id: string) =>
    graph.resources.filter(isArchitectureCatalogResource).find((item) => item.ref.id === id);

  it('describes fields, keys, defaults, enums, embedded types and documentation', async () => {
    const result = await scanFiles({ 'schema.prisma': library });
    const members = { kind: 'collection', namespace: 'default/default', id: 'members' };

    expect(result.skipped).toEqual([]);
    expect(resource(result.graph, 'members')?.summary).toBe('A person who borrows books.');
    expect(resource(result.graph, 'members')?.attributes.fields).toEqual([
      { name: 'id', column: '_id', type: 'String', id: true, default: 'auto()' },
      { name: 'email', type: 'String', unique: true, doc: 'Where we send overdue notices.' },
      { name: 'tier', type: 'Tier', default: 'STANDARD', enum: ['STANDARD', 'gold'] },
      { name: 'joinedAt', type: 'DateTime', default: 'now()' },
      { name: 'updatedAt', type: 'DateTime', updatedAt: true },
      {
        name: 'address',
        type: 'Address',
        optional: true,
        fields: [
          { name: 'street', type: 'String' },
          { name: 'city', type: 'String' },
        ],
      },
      { name: 'mentorId', type: 'String', optional: true },
      {
        name: 'mentor',
        type: 'Member',
        optional: true,
        relation: {
          model: 'Member',
          to: members,
          many: false,
          name: 'Mentoring',
          fields: ['mentorId'],
          references: ['id'],
        },
      },
      {
        name: 'mentees',
        type: 'Member',
        list: true,
        relation: { model: 'Member', to: members, many: true, name: 'Mentoring' },
      },
      {
        name: 'loans',
        type: 'Loan',
        list: true,
        relation: {
          model: 'Loan',
          to: { kind: 'collection', namespace: 'default/default', id: 'Loan' },
          many: true,
        },
      },
    ]);
    expect(schemaOf(result.graph, 'members')).toMatchObject({
      properties: {
        address: {
          anyOf: [
            {
              type: 'object',
              properties: { street: { type: 'string' }, city: { type: 'string' } },
            },
            { type: 'null' },
          ],
        },
      },
    });
  });

  it('reads indexes and trailing documentation', async () => {
    const result = await scanFiles({ 'schema.prisma': library });

    expect(resource(result.graph, 'Loan')?.attributes.indexes).toEqual([
      { fields: ['memberId', 'dueOn'], unique: false },
      { fields: ['memberId', 'bookIsbn'], unique: true, name: 'one_copy_each' },
    ]);
    expect(resource(result.graph, 'Loan')?.attributes.fields).toContainEqual({
      name: 'dueOn',
      type: 'DateTime',
      doc: 'Inclusive.',
    });
  });

  it('reads a long run of documentation in linear time, keeping its last 50 lines', async () => {
    const started = performance.now();

    const result = await scanFiles({
      'schema.prisma': `model Note {\n${'/// line\n'.repeat(20_000)}  id Int @id\n}\n`,
    });

    expect(performance.now() - started).toBeLessThan(2000);
    expect(resource(result.graph, 'Note')?.attributes.fields).toEqual([
      expect.objectContaining({ doc: Array.from({ length: 50 }, () => 'line').join('\n') }),
    ]);
  });

  it('joins a model to each model it holds a key of, once, and not to itself', async () => {
    const result = await scanFiles({
      'schema.prisma': `${library}
model Post {
  id   Int   @id
  tags Tag[]
}
model Tag {
  id    Int    @id
  posts Post[]
}`,
    });

    expect(
      result.graph.relationships
        .filter((edge) => edge.type === 'references')
        .map((edge) => [edge.from.id, edge.to.id, edge.attributes?.fields]),
    ).toEqual([
      ['Loan', 'members', ['member']],
      ['Post', 'Tag', ['tags']],
    ]);
  });
});

describe('Drizzle and Mongoose model detail', () => {
  const references = (graph: ResourceGraph) =>
    graph.relationships
      .filter((edge) => edge.type === 'references')
      .map((edge) => [edge.from.id, edge.to.id]);

  it('follows a Drizzle column reference to a table in another file', async () => {
    const result = await scanFiles({
      'authors.ts': `import { pgTable, serial, text } from 'drizzle-orm/pg-core';
export const authors = pgTable('authors', { id: serial('id').primaryKey(), name: text('name').notNull().unique() });`,
      'books.ts': `import { pgTable, serial, integer, timestamp } from 'drizzle-orm/pg-core';
import { authors } from './authors';
export const books = pgTable('books', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').references(() => authors.id),
  createdAt: timestamp('created_at').defaultNow(),
});`,
    });

    const books = result.graph.resources.find((resource) => resource.ref.id === 'books');

    expect(books?.attributes).toMatchObject({
      fields: [
        { name: 'id', type: 'serial', id: true },
        {
          name: 'authorId',
          column: 'author_id',
          type: 'integer',
          optional: true,
          relation: {
            model: 'authors',
            to: { kind: 'table', namespace: 'default/default', id: 'authors' },
            fields: ['authorId'],
            references: ['id'],
          },
        },
        { name: 'createdAt', column: 'created_at', default: 'now()' },
      ],
    });
    expect(references(result.graph)).toEqual([['books', 'authors']]);
  });

  it('follows a Mongoose ref to the model it names', async () => {
    const result = await scanFiles({
      'models.ts': `import mongoose from 'mongoose';
const author = new mongoose.Schema({ name: { type: String, required: true, unique: true } }, { collection: 'authors' });
export const Author = mongoose.model('Author', author);
const book = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', required: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
}, { collection: 'books' });
export const Book = mongoose.model('Book', book);`,
    });

    const books = result.graph.resources.find((resource) => resource.ref.id === 'books');

    expect(books?.attributes).toMatchObject({
      fields: [
        { name: 'title', type: 'String' },
        {
          name: 'author',
          type: 'ObjectId',
          relation: { model: 'Author', to: { kind: 'collection', id: 'authors' } },
        },
        {
          name: 'status',
          optional: true,
          default: "'draft'",
          enum: ['draft', 'published'],
        },
      ],
    });
    expect(references(result.graph)).toEqual([['books', 'authors']]);
  });
});

const modelOf = (graph: ResourceGraph, id: string) =>
  graph.resources.filter(isArchitectureCatalogResource).find((item) => item.ref.id === id);

describe('model relations across files and schemas', () => {
  const references = (graph: ResourceGraph) =>
    graph.relationships
      .filter((edge) => edge.type === 'references')
      .map((edge) => [`${edge.from.kind}:${edge.from.id}`, `${edge.to.kind}:${edge.to.id}`])
      .sort();

  const relationOf = (graph: ResourceGraph, table: string, field: string) =>
    z
      .array(z.object({ name: z.string(), relation: z.record(z.string(), z.unknown()).optional() }))
      .parse(modelOf(graph, table)?.attributes.fields)
      .find((item) => item.name === field)?.relation;

  it('resolves a Drizzle reference in its own file first, then through an aliased import', async () => {
    const result = await scanFiles({
      'src/a/schema.ts': `import { pgTable, integer } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: integer('id').primaryKey() });
export const posts = pgTable('posts', {
  id: integer('id').primaryKey(),
  authorId: integer('author_id').references(() => users.id),
  editorId: integer('editor_id').references(() => missing.id),
});`,
      'src/b/schema.ts': `import { pgTable, integer } from 'drizzle-orm/pg-core';
import { users as people } from '../a/schema';
export const users = pgTable('legacy_users', { id: integer('id').primaryKey() });
export const comments = pgTable('comments', {
  id: integer('id').primaryKey(),
  personId: integer('person_id').references(() => people.id),
});`,
    });

    expect(references(result.graph)).toEqual([
      ['table:comments', 'table:users'],
      ['table:posts', 'table:users'],
    ]);
    expect(relationOf(result.graph, 'posts', 'editorId')).not.toHaveProperty('to');
  });

  it('reads each Prisma schema with its own datasource and relations', async () => {
    const result = await scanFiles({
      'prisma/schema/base.prisma': `datasource db {\n  provider = "mongodb"\n}`,
      'prisma/schema/user.prisma': `model User {\n  id String @id @map("_id")\n  posts Post[]\n}`,
      'prisma/schema/post.prisma': `model Post {\n  id String @id @map("_id")\n  authorId String\n  author User @relation(fields: [authorId], references: [id])\n}`,
      'services/billing/prisma/schema.prisma': `datasource db {\n  provider = "postgresql"\n}\nmodel Invoice {\n  id Int @id\n  userId Int\n  user User @relation(fields: [userId], references: [id])\n}\nmodel User {\n  id Int @id\n  invoices Invoice[]\n}`,
    });

    expect(
      result.graph.resources
        .filter(isArchitectureCatalogResource)
        .map((resource) => `${resource.ref.kind}:${resource.ref.id}`)
        .sort(),
    ).toEqual(['collection:Post', 'collection:User', 'table:Invoice', 'table:User']);
    expect(references(result.graph)).toEqual([
      ['collection:Post', 'collection:User'],
      ['table:Invoice', 'table:User'],
    ]);
  });
});

describe('Prisma field and index syntax', () => {
  it('keeps index fields whole when their arguments hold commas', async () => {
    const result = await scanFiles({
      'schema.prisma': `model User {\n  id Int @id\n  email String\n  @@index([email(sort: Desc, length: 10), id])\n}`,
    });

    expect(modelOf(result.graph, 'User')?.attributes.indexes).toEqual([
      { fields: ['email', 'id'], unique: false },
    ]);
  });

  it('keeps the optional modifier of an Unsupported type', async () => {
    const result = await scanFiles({
      'schema.prisma': `model Place {\n  id Int @id\n  geo Unsupported("geometry(Point, 4326)")?\n}`,
    });

    expect(modelOf(result.graph, 'Place')?.attributes.fields).toContainEqual({
      name: 'geo',
      type: 'Unsupported',
      optional: true,
    });
  });
});

describe('scan scope', () => {
  it.each(['.next', '.output', '.svelte-kit', '.vercel', 'out', 'vendor'])(
    'does not read models from %s, which holds copies rather than source',
    async (folder) => {
      const result = await scanFiles({
        'schema.prisma': 'model User {\n  id Int @id\n}',
        [`${folder}/schema.prisma`]: 'model Copy {\n  id Int @id\n}',
      });

      expect(result.graph.resources.map((resource) => resource.ref.id)).toEqual(['User']);
    },
  );
});
