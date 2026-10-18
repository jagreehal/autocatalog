import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDocsCatalog } from '../src/catalog';
import {
  dataModelPageProps,
  dataModelsPageProps,
  entityDiagram,
  modelDescription,
  modelTwin,
} from '../src/data-models';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-docs-data-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function write(file: string, body: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

const schema = `datasource db {
  provider = "postgresql"
}

/// A person who borrows books.
model Member {
  id    Int    @id @default(autoincrement())
  email String @unique
  loans Loan[]

  @@map("members")
}

model Loan {
  id       Int    @id
  memberId Int    @map("member_id")
  member   Member @relation(fields: [memberId], references: [id])

  @@index([memberId])
}`;

async function library(): Promise<void> {
  await write('library/package.json', JSON.stringify({ name: 'lending' }));
  await write('library/prisma/schema.prisma', schema);
  await write(
    'library/src/loans.ts',
    `import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const due = () => prisma.loan.findMany();
export const lend = () => prisma.loan.create({ data: {} });`,
  );
}

it('scans a repository that commits no resources.json and gives each model a page', async () => {
  await library();

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.failures).toEqual([]);
  expect(catalog.models.map(({ repository, name }) => `${repository}/${name}`)).toEqual([
    'library/loan',
    'library/member',
  ]);
  expect(catalog.graph.resources.find((resource) => resource.ref.id === 'members')?.url).toBe(
    'data/library/member/',
  );
  expect(
    catalog.graph.relationships
      .filter((edge) => edge.type === 'references')
      .map((edge) => `${edge.from.id}->${edge.to.id}`),
  ).toEqual(['Loan->members']);
});

it('lists every model with who reads and writes it', async () => {
  await library();

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const page = dataModelsPageProps(catalog.graph, catalog.models, catalog.events, '/');

  expect(page.models).toEqual([
    expect.objectContaining({
      title: 'Loan',
      href: '/data/library/loan/',
      store: 'table',
      adapter: 'Prisma',
      fields: 2,
      readers: [{ name: 'lending', href: '/catalog/#resource-service%3Alending' }],
      writers: [{ name: 'lending', href: '/catalog/#resource-service%3Alending' }],
    }),
    expect.objectContaining({ title: 'Member', name: 'members', fields: 2, readers: [] }),
  ]);
});

it('describes one model: its columns, relations, indexes and diagram', async () => {
  await library();

  const catalog = await buildDocsCatalog(root, { includeDates: false });
  const loan = catalog.models.find((model) => model.name === 'loan')!;

  const page = dataModelPageProps(catalog.graph, loan, catalog.models, catalog.events, {
    base: '/',
    root,
  });

  expect(page.fields).toEqual([
    { name: 'id', type: 'Int', required: true, primary: true },
    { name: 'memberId', type: 'Int', required: true, column: 'member_id', references: 'Member' },
    {
      name: 'member',
      type: 'Member',
      required: true,
      relation: { model: 'Member', href: '/data/library/member/', many: false, holdsKey: true },
    },
  ]);
  expect(page.indexes).toEqual([{ fields: ['memberId'], unique: false }]);
  expect(page.provenance.location).toBe('prisma/schema.prisma:14');
  expect(page.diagram).toContain('"Member" ||--o{ "Loan" : "member"');
  expect(modelTwin(page, { title: 'Loan' })).toContain(
    '| `memberId` | `Int` | yes | references Member; stored as `member_id` |',
  );
});

it('draws a model with no relations without a diagram', async () => {
  await write('library/prisma/schema.prisma', 'model Note {\n  id Int @id\n}');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(entityDiagram(catalog.models[0]!, catalog.models)).toBeUndefined();
});

it('leaves a repository without models out of the graph', async () => {
  await write('plain/src/index.ts', 'export const answer = 42;');
  await write('plain/docs/readme.md', '---\ntitle: Readme\nowner: Platform\n---\n\nHello.\n');

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.models).toEqual([]);
  expect(catalog.graph.resources.some((resource) => resource.ref.kind === 'service')).toBe(false);
});

async function diagrams(files: Record<string, string>) {
  await write('app/package.json', JSON.stringify({ name: 'app' }));

  for (const [file, body] of Object.entries(files)) await write(`app/${file}`, body);

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  return {
    catalog,
    diagram: (name: string) =>
      entityDiagram(
        catalog.models.find((model) => model.name === name)!,
        catalog.models,
      ) ?? '',
  };
}

it('draws a relation of a model to itself as one to many', async () => {
  const { diagram } = await diagrams({
    'prisma/schema.prisma': `model Node {
  id       Int    @id
  parentId Int?
  parent   Node?  @relation("Tree", fields: [parentId], references: [id])
  children Node[] @relation("Tree")
}`,
  });

  expect(diagram('node')).toContain('"Node" |o--o{ "Node" : "parent"');
});

it('quotes entity names and keeps attribute names and labels within what Mermaid reads', async () => {
  const { diagram } = await diagrams({
    'prisma/schema.prisma': `model One {
  pk   Int    @id
  fk   Int
  uk   String @unique
  to   To?    @relation(fields: [fk], references: [id])
}
model To {
  id   Int   @id
  ones One[]
}`,
    'src/models.ts': `import mongoose from 'mongoose';
const tag = new mongoose.Schema({ name: String }, { collection: 'tags' });
export const Tag = mongoose.model('Tag', tag);
const post = new mongoose.Schema({ '2fa': String, 'say "hi"': { type: mongoose.Schema.Types.ObjectId, ref: 'Tag' } }, { collection: 'posts' });
export const Post = mongoose.model('Post', post);`,
  });

  expect(diagram('one')).toBe(
    [
      'erDiagram',
      '  direction LR',
      '  "One" {',
      '    Int pk_ PK',
      '    Int fk_ FK',
      '    String uk_ UK',
      '  }',
      '  "To" {',
      '    Int id PK',
      '  }',
      '  "To" |o--o{ "One" : "to"',
    ].join('\n'),
  );
  expect(diagram('post')).toContain('    String _2fa\n');
  expect(diagram('post')).toContain(`"Tag" |o--o{ "Post" : "say 'hi'"`);
});

it('keeps Drizzle key columns in the diagram and the field count', async () => {
  const { catalog, diagram } = await diagrams({
    'docs/readme.md': '---\ntitle: Books\nowner: Platform\n---\n\nHello.\n',
    'db/schema.ts': `import { pgTable, integer } from 'drizzle-orm/pg-core';
export const authors = pgTable('authors', { id: integer('id').primaryKey() });
export const books = pgTable('books', { id: integer('id').primaryKey(), authorId: integer('author_id').notNull().references(() => authors.id) });`,
  });

  expect(diagram('books')).toContain('    integer authorId FK\n');
  expect(
    dataModelsPageProps(catalog.graph, catalog.models, catalog.events, '/').models.find(
      (model) => model.title === 'books',
    )?.fields,
  ).toBe(2);
});

it('marks each field of a composite primary key', async () => {
  const { catalog, diagram } = await diagrams({
    'prisma/schema.prisma': `model Shelf {
  room  Int
  slot  Int
  books Book[]
  @@id([room, slot])
}
model Book {
  id    Int   @id
  room  Int
  slot  Int
  shelf Shelf @relation(fields: [room, slot], references: [room, slot])
}`,
  });

  const shelf = catalog.models.find((model) => model.name === 'shelf')!;

  const page = dataModelPageProps(catalog.graph, shelf, catalog.models, catalog.events, {
    base: '/',
    root,
  });

  expect(page.fields.flatMap((field) => (field.primary ? [field.name] : []))).toEqual([
    'room',
    'slot',
  ]);
  expect(diagram('book')).toContain('  "Shelf" {\n    Int room PK\n    Int slot PK\n  }');
});

it('describes a model without naming a datastore the code leaves unnamed', () => {
  expect(modelDescription({ store: 'table', repository: 'library' })).toBe(
    "A table, read from the library repository's code.",
  );
  expect(
    modelDescription({ store: 'collection', datastore: 'main/app', repository: 'library' }),
  ).toBe("A collection in main/app, read from the library repository's code.");
});

it('scans a repository checkout for models once per process', async () => {
  await library();
  await buildDocsCatalog(root, { includeDates: false });
  await write('library/prisma/schema.prisma', `${schema}\nmodel Fine {\n  id Int @id\n}`);

  const catalog = await buildDocsCatalog(root, { includeDates: false });

  expect(catalog.models.map(({ name }) => name)).toEqual(['loan', 'member']);
});

it('gives the bare address of a shared name by the name the code uses, not the database name', async () => {
  const { catalog } = await diagrams({
    'prisma/schema.prisma': 'model Account {\n  id Int @id\n  @@map("z_accounts")\n}',
    'db/schema.ts': `import { pgTable, integer } from 'drizzle-orm/pg-core';
export const account = pgTable('a_accounts', { id: integer('id').primaryKey() });`,
  });

  expect(catalog.models.map(({ name, resource }) => `${resource.ref.id} ${name}`)).toEqual([
    'z_accounts account',
    'a_accounts a-accounts-2',
  ]);
});
