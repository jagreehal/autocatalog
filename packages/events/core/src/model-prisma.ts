import { emptyResourceGraph } from './architecture';
import type { JsonObject } from './json';
import {
  describeModel,
  filled,
  literal,
  modelReferences,
  sourceResource,
  staticObject,
} from './model-source';
import type { ModelField, ModelIndex, ModelRelation, ParsedModel } from './model-source';
import type { ResourceGraph, ResourceRef } from './resource-graph';
import type ts from 'typescript';

interface PrismaDoc {
  text: string;
  /** The comment is the whole line, so it documents the line below it. */
  own: boolean;
}

/** A string, which a line's end closes too; a comment; or the text between them. */
const COMMENTED = /"(?:[^"\\\n]+|\\[\s\S]?)*["\n]?|\/\/[^\n]*|[^"/]+|\//g;

const newlines = (text: string) => text.split('\n').length - 1;

/**
 * Remove `//` comments. String literals stay whole: they may contain `//`, `{`
 * or `}`. A `///` comment is Prisma's documentation for what it sits on, so its
 * text is kept by line number.
 */
function withoutPrismaComments(content: string) {
  const docs = new Map<number, PrismaDoc>();
  let output = '';
  let line = 1;

  for (const { 0: token, index } of content.matchAll(COMMENTED)) {
    if (!token.startsWith('//')) {
      output += token;
      line += newlines(token);
      continue;
    }

    if (token.startsWith('///')) {
      const lineStart = content.lastIndexOf('\n', index) + 1;

      docs.set(line, {
        text: token.slice(3).trim(),
        own: content.slice(lineStart, index).trim() === '',
      });
    }
  }

  return { code: output, docs };
}

// Bounds the walk, so a schema of nothing but `///` lines stays linear.
const MAX_DOC_LINES = 50;

/** The `///` lines directly above a line, as one paragraph: the last 50 at most. */
function docAbove(docs: Map<number, PrismaDoc>, line: number): string | undefined {
  const lines: Array<string> = [];

  for (let above = line - 1; lines.length < MAX_DOC_LINES; above--) {
    const doc = docs.get(above);

    if (doc?.own !== true) {
      break;
    }

    lines.unshift(doc.text);
  }

  return lines.join('\n').trim() || undefined;
}

interface PrismaBlock {
  keyword: string;
  name: string;
  line: number;
  lines: Array<string>;
  /** Its `///` documentation. */
  doc?: string | undefined;
  /** Each line's `///` documentation, trailing it or directly above it. */
  docs: Array<string | undefined>;
}

/** A string, a brace, or the text between them. */
const BRACED = /"(?:[^"\\\n]+|\\[\s\S]?)*["\n]?|[{}]|[^"{}]+/g;

/** The lines of a block's body, with the `///` documentation of each. */
function prismaBody(body: string, start: number, docs: Map<number, PrismaDoc>) {
  const lines = body.split('\n');

  return {
    lines,
    doc: docAbove(docs, start),
    docs: lines.map((_, i) => {
      const own = docs.get(start + i);

      return own && !own.own ? own.text : docAbove(docs, start + i);
    }),
  };
}

/** The words before a block's brace: `model User`. */
function prismaHeader(text: string) {
  const [keyword = '', name = ''] = text.trim().split(/\s+/).slice(-2);

  return { keyword, name };
}

/**
 * The top-level `keyword Name { ... }` blocks of a schema file. One pass over
 * the text; a brace inside a string does not open or close a block.
 */
function prismaBlocks(content: string, file: string, skipped: Array<string>): Array<PrismaBlock> {
  const { code, docs } = withoutPrismaComments(content);
  const blocks: Array<PrismaBlock> = [];
  let depth = 0;
  let line = 1;
  let headerStart = 0;
  let bodyStart = 0;
  let open: Pick<PrismaBlock, 'keyword' | 'name' | 'line'> | undefined;

  for (const { 0: token, index } of code.matchAll(BRACED)) {
    const opens = token === '{';
    const closes = token === '}' && depth > 0;

    if (opens && depth === 0) {
      open = { ...prismaHeader(code.slice(headerStart, index)), line };
      bodyStart = index + 1;
    }

    if (closes && depth === 1 && open) {
      blocks.push({ ...open, ...prismaBody(code.slice(bodyStart, index), open.line, docs) });
      headerStart = index + 1;
    }

    depth += Number(opens) - Number(closes);
    line += newlines(token);
  }

  if (depth > 0 && open) {
    skipped.push(`${file}: ${open.keyword} ${open.name} is never closed`);
  }

  return blocks.filter(({ name }) => name !== '');
}

const mappedName = (text: string, attribute: '@map' | '@@map' | '@@schema') =>
  new RegExp(`(?:^|\\s)${attribute}\\("([^"]*)"\\)`).exec(text)?.[1];

/** The text between an attribute's parentheses, nested calls and strings included. */
function attributeArguments(text: string, attribute: string): string | undefined {
  const start = new RegExp(`(?:^|\\s)${attribute}\\(`).exec(text);

  if (!start) {
    return undefined;
  }

  const from = start.index + start[0].length;
  let depth = 1;
  let quoted = false;

  for (let index = from; index < text.length; index++) {
    const char = text[index];

    if (quoted) {
      if (char === '\\') {
        index++;
      } else if (char === '"') {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return text.slice(from, index).trim();
    }
  }

  return undefined;
}

/** `fields: [a, b(sort: Desc)]` as `['a', 'b']`. */
function namedList(text: string, name?: string): Array<string> | undefined {
  const list = new RegExp(
    filled(name) ? `${name}:\\s*\\[([^\\]]*)\\]` : String.raw`^\s*\[([^\]]*)\]`,
  ).exec(text)?.[1];

  if (list === undefined) {
    return undefined;
  }

  // An item's arguments may hold commas of their own: `email(sort: Desc, length: 10)`.
  let depth = 0;
  let names = '';

  for (const char of list) {
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      names += char;
    }
  }

  return names
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const PRISMA_PRIMITIVES = new Map(
  Object.entries<JsonObject>({
    String: { type: 'string' },
    Boolean: { type: 'boolean' },
    Int: { type: 'integer' },
    Float: { type: 'number' },
    Decimal: { type: 'string', format: 'decimal' },
    BigInt: { type: 'string', pattern: '^-?[0-9]+$' },
    DateTime: { type: 'string', format: 'date-time' },
    Bytes: { type: 'string', contentEncoding: 'base64' },
    Json: {},
  }),
);

interface PrismaContext {
  file: string;
  skipped: Array<string>;
  enums: Map<string, Array<string>>;
  /** MongoDB's embedded `type` blocks. */
  composites: Map<string, PrismaBlock>;
  models: Map<string, ResourceRef<'collection' | 'table'>>;
  /** The embedded types being read, which may hold themselves. */
  open: ReadonlySet<string>;
}

interface PrismaLine {
  name: string;
  type: string;
  modifier: string | undefined;
  /** Its attributes, as written. */
  options: string;
  column: string;
}

/** `Unsupported("geometry(Point, 4326)")?`: the type's argument comes before its modifier. */
const FIELD = /^\s*(\w+)\s+(\w+)(?:\("[^"]*"\))?(\[\]|\?)?(.*)$/;

function prismaLine(line: string): PrismaLine | undefined {
  const match = FIELD.exec(line);

  if (!match) {
    return undefined;
  }

  const [, name = '', type = '', modifier, options = ''] = match;

  return { name, type, modifier, options, column: mappedName(options, '@map') ?? name };
}

function prismaAttributes(options: string) {
  const fallback = attributeArguments(options, '@default');

  return {
    ...(/(?:^|\s)@id\b/.test(options) && { id: true }),
    ...(/(?:^|\s)@unique\b/.test(options) && { unique: true }),
    ...(fallback !== undefined && { default: fallback }),
    ...(/(?:^|\s)@updatedAt\b/.test(options) && { updatedAt: true }),
  };
}

const prismaField = (
  { name, type, modifier, options, column }: PrismaLine,
  doc: string | undefined,
): ModelField => ({
  name,
  type,
  ...(column !== name && { column }),
  ...(modifier === '[]' && { list: true }),
  ...(modifier === '?' && { optional: true }),
  ...prismaAttributes(options),
  ...(filled(doc) && { doc }),
});

function prismaRelation({ type, modifier, options }: PrismaLine, to: ResourceRef): ModelRelation {
  const relation = attributeArguments(options, '@relation') ?? '';
  const name = /^"([^"]*)"/.exec(relation)?.[1] ?? /name:\s*"([^"]*)"/.exec(relation)?.[1];
  const keys = namedList(relation, 'fields');
  const references = namedList(relation, 'references');

  return {
    model: type,
    to,
    many: modifier === '[]',
    ...(filled(name) && { name }),
    ...(keys && { fields: keys }),
    ...(references && { references }),
  };
}

/** What a column's type is: its schema, and an enum's values or an embedded type's fields. */
function prismaType(
  { name, type }: PrismaLine,
  owner: string,
  context: PrismaContext,
): { schema: JsonObject } & Pick<ModelField, 'enum' | 'fields'> {
  const values = context.enums.get(type);
  const schema = PRISMA_PRIMITIVES.get(type);
  const composite = context.open.has(type) ? undefined : context.composites.get(type);

  if (values) {
    return { schema: schema ?? { type: 'string', enum: values }, enum: values };
  }

  if (schema) {
    return { schema };
  }

  if (composite) {
    const open = new Set([...context.open, type]);
    const embedded = prismaFields(composite, { ...context, open });

    return { schema: embedded.schema, fields: embedded.fields };
  }

  context.skipped.push(`${context.file}: unsupported Prisma field ${owner}.${name} (${type})`);

  return { schema: {} };
}

function modified(schema: JsonObject, modifier: string | undefined): JsonObject {
  if (modifier === '[]') {
    return { type: 'array', items: schema };
  }

  return modifier === '?' ? { anyOf: [schema, { type: 'null' }] } : schema;
}

interface PrismaFields {
  fields: Array<ModelField>;
  schema: JsonObject;
  /** Each field's column. */
  aliases: Map<string, string>;
}

/** A model's or embedded type's fields, its JSON Schema, and each field's column. */
function prismaFields(block: PrismaBlock, context: PrismaContext): PrismaFields {
  const fields: Array<ModelField> = [];
  const properties: JsonObject = {};
  const required: Array<string> = [];
  const aliases = new Map<string, string>();

  for (const [index, text] of block.lines.entries()) {
    const line = prismaLine(text);

    if (!line) {
      continue;
    }

    const field = prismaField(line, block.docs[index]);
    const related = context.models.get(line.type);

    // A relation is the link between two models, not a column of either: it
    // stays out of the schema drift compares, and the field holding the key is
    // a column of its own.
    if (related) {
      fields.push({ ...field, relation: prismaRelation(line, related) });
      continue;
    }

    const { schema, ...described } = prismaType(line, block.name, context);

    properties[line.column] = modified(schema, line.modifier);
    aliases.set(line.name, line.column);
    required.push(line.column);
    fields.push({ ...field, ...described });
  }

  return { fields, schema: { type: 'object', properties, required }, aliases };
}

/** `@@index`, `@@unique` and `@@id`, by the fields each covers. */
function prismaIndexes(block: PrismaBlock): Array<ModelIndex> {
  return block.lines.flatMap((line) => {
    const kind = /^\s*@@(index|unique|id)\s*\(/.exec(line)?.[1];
    const args = kind === undefined ? undefined : attributeArguments(line.trim(), `@@${kind}`);

    const fields = args === undefined ? undefined : (namedList(args) ?? namedList(args, 'fields'));

    if (args === undefined || !fields) {
      return [];
    }

    const name = /(?:name|map):\s*"([^"]*)"/.exec(args)?.[1];

    return [
      {
        fields,
        unique: kind !== 'index',
        ...(kind === 'id' && { primary: true }),
        ...(filled(name) && { name }),
      },
    ];
  });
}

export interface PrismaModel {
  ref: ResourceRef<'collection' | 'table'>;
  /** Prisma field name → database column name. */
  aliases: Map<string, string>;
}

export interface PrismaResources {
  graph: ResourceGraph;
  /** Each model, by its client delegate's name. */
  models: Map<string, PrismaModel>;
}

const named = (blocks: Array<PrismaBlock>, keyword: string) =>
  blocks.filter((block) => block.keyword === keyword);

/** Each enum's values, as the database stores them. */
const prismaEnums = (blocks: Array<PrismaBlock>) =>
  new Map(
    named(blocks, 'enum').map(({ name, lines }) => [
      name,
      lines.flatMap((line) => {
        const value = /^\s*(\w+)/.exec(line)?.[1];

        return value === undefined ? [] : [mappedName(line, '@map') ?? value];
      }),
    ]),
  );

/** Each model's collection or table, by the model's name. */
function prismaRefs(blocks: Array<PrismaBlock>, namespace: string) {
  const mongo = named(blocks, 'datasource').some(({ lines }) =>
    lines.some((line) => /^\s*provider\s*=\s*"mongodb"/.test(line)),
  );

  return new Map(
    named(blocks, 'model').map((block): [string, ResourceRef<'collection' | 'table'>] => {
      const body = block.lines.join('\n');
      const table = mappedName(body, '@@map') ?? block.name;
      const sqlSchema = mappedName(body, '@@schema');

      return [
        block.name,
        {
          kind: mongo ? 'collection' : 'table',
          namespace,
          id: filled(sqlSchema) ? `${sqlSchema}.${table}` : table,
        },
      ];
    }),
  );
}

/**
 * Models of every schema file, read together: a multi-file schema declares its
 * datasource, enums and related models in different files.
 */
export function prismaResources(
  files: Array<{ relative: string; content: string }>,
  namespace: string,
  skipped: Array<string>,
): PrismaResources {
  const graph = emptyResourceGraph();
  const models = new Map<string, PrismaModel>();

  const blocks = files.flatMap(({ relative, content }) =>
    prismaBlocks(content, relative, skipped).map((block) => ({ ...block, file: relative })),
  );

  // Every model's identity first, so a relation can name one declared later.
  const refs = prismaRefs(blocks, namespace);

  const context = {
    skipped,
    enums: prismaEnums(blocks),
    composites: new Map(named(blocks, 'type').map((block) => [block.name, block])),
    models: refs,
    open: new Set<string>(),
  };

  const parsed: Array<ParsedModel> = [];

  for (const block of blocks) {
    const { name: symbol, file, line } = block;
    const ref = block.keyword === 'model' ? refs.get(symbol) : undefined;

    if (!ref) {
      continue;
    }

    const { fields, schema, aliases } = prismaFields(block, { ...context, file });
    const resource = sourceResource(ref, { adapter: 'prisma', schema }, { file, symbol, line });

    resource.attributes = { ...resource.attributes, fieldAliases: Object.fromEntries(aliases) };

    if (block.doc !== undefined) {
      resource.summary = block.doc;
    }

    graph.resources.push(resource);
    models.set(`${symbol.charAt(0).toLowerCase()}${symbol.slice(1)}`, { ref, aliases });
    const model = { resource, ref, fields, file, line };

    describeModel(model, prismaIndexes(block));
    parsed.push(model);
  }

  graph.relationships.push(...modelReferences(parsed));

  return { graph, models };
}

export const PRISMA_READS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

export const PRISMA_WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Fields named by a Prisma `select`; empty (every field) unless it is a plain literal. */
export function prismaSelection(
  args: ts.Node | undefined,
  aliases: Map<string, string>,
): Array<string> {
  const select = staticObject(args)?.get('select');
  const fields = select ? staticObject(select) : undefined;

  if (!fields) {
    return [];
  }

  const columns: Array<string> = [];

  for (const [name, value] of fields) {
    const column = aliases.get(name);

    // A relation: its own columns are not this table's.
    if (!filled(column)) {
      continue;
    }

    const chosen = literal(value);

    if (chosen !== true && chosen !== false) {
      return [];
    }

    if (chosen) {
      columns.push(column);
    }
  }

  return columns;
}
