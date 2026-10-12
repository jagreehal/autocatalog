import path from 'node:path';
import { z } from 'zod';
import ts from 'typescript';
import {
  architectureResource,
  architectureService,
  emptyResourceGraph,
  mergeArchitectureGraphs,
  databaseAccess,
} from './architecture';
import {
  readOptionalResourceJson,
  readResourceSource,
  ResourceReadError,
  resourceFiles,
  type ResourceScanOptions,
} from './resource-files';
import { jsonObjectSchema, type JsonObject, type JsonValue } from './json';
import {
  resourceKey,
  isArchitectureCatalogResource,
  type CatalogResource,
  type ResourceGraph,
  type ResourceRef,
} from './resource-graph';

export interface ModelScanOptions extends ResourceScanOptions {
  datastore?: string;
  database?: string;
  service?: string;
}

export interface ResourceDiscoveryResult {
  graph: ResourceGraph;
  errors: string[];
  skipped: string[];
}

export const modelExports = z.array(
  z.object({
    kind: z.enum(['collection', 'table']),
    id: z.string().min(1),
    datastore: z.string().min(1),
    database: z.string().min(1),
    adapter: z.enum(['mongoose', 'prisma', 'drizzle']),
    schema: jsonObjectSchema,
    symbol: z.string().optional(),
  }),
);

export type ModelExport = z.infer<typeof modelExports>[number];

export interface MongooseModelContract {
  modelName: string;
  collection: { collectionName?: string; name?: string };
  schema: { toJSONSchema(): JsonObject };
}

export interface ModelExportOptions {
  datastore: string;
  database: string;
}

/** Called by an explicitly run application exporter, never by the passive scanner. */
export function exportMongooseModels(
  models: MongooseModelContract[],
  options: ModelExportOptions,
): ModelExport[] {
  return modelExports.parse(
    models.map((model) => ({
      kind: 'collection',
      id: model.collection.collectionName ?? model.collection.name,
      ...options,
      adapter: 'mongoose',
      schema: model.schema.toJSONSchema(),
      symbol: model.modelName,
    })),
  );
}

function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : undefined;
}

function objectFields(node: ts.Node | undefined): Map<string, ts.Expression> {
  const fields = new Map<string, ts.Expression>();

  if (!node || !ts.isObjectLiteralExpression(node)) return fields;

  for (const item of node.properties)
    if (ts.isPropertyAssignment(item)) {
      const name = propertyName(item.name);

      if (name) fields.set(name, item.initializer);
    }

  return fields;
}

/** An object literal's properties, or undefined when a spread or computed name could add others. */
function staticObject(node: ts.Node | undefined): Map<string, ts.Expression> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;

  if (
    !node.properties.every(
      (item) => ts.isPropertyAssignment(item) && propertyName(item.name) !== undefined,
    )
  )
    return undefined;

  return objectFields(node);
}

/** Fields named by an inclusion projection; empty (every field) for anything else. */
function includedProjection(node: ts.Node | undefined): string[] {
  const projection = staticObject(node);

  if (
    !projection ||
    ![...projection.values()].every((value) => literal(value) === 1 || literal(value) === true)
  )
    return [];

  return [...projection.keys()];
}

function literal(node: ts.Node | undefined): JsonValue | undefined {
  if (!node) return undefined;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  if (ts.isNumericLiteral(node)) return Number(node.text);

  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;

  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;

  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(literal);

    return values.every((item) => item !== undefined) ? values : undefined;
  }

  return undefined;
}

function textLiteral(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;

  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function mongooseField(
  node: ts.Expression,
  variables: Map<string, ts.Expression>,
  skipped: string[],
  open = new Set<string>(),
): JsonObject {
  if (ts.isIdentifier(node) && variables.has(node.text) && !open.has(node.text))
    return mongooseField(
      variables.get(node.text)!,
      variables,
      skipped,
      new Set([...open, node.text]),
    );

  if (
    ts.isNewExpression(node) &&
    node.expression.getText().endsWith('Schema') &&
    node.arguments?.[0]
  )
    return mongooseObject(node.arguments[0], variables, skipped);

  if (ts.isArrayLiteralExpression(node))
    return {
      type: 'array',
      items:
        node.elements[0] && ts.isExpression(node.elements[0])
          ? mongooseField(node.elements[0], variables, skipped, open)
          : {},
    };
  const fields = objectFields(node);

  if (ts.isObjectLiteralExpression(node) && !fields.has('type'))
    return mongooseObject(node, variables, skipped);
  const type = fields.get('type') ?? node;
  let schema: JsonObject;

  if (type !== node) schema = mongooseField(type, variables, skipped, open);
  else {
    const name = type.getText();

    const primitives = new Map(
      Object.entries<JsonObject>({
        String: { type: 'string' },
        Number: { type: 'number' },
        Boolean: { type: 'boolean' },
        Date: { type: 'string', format: 'date-time' },
        Buffer: { type: 'string', contentEncoding: 'base64' },
        Object: { type: 'object' },
      }),
    );

    schema =
      primitives.get(name) ??
      (name.endsWith('ObjectId') ? { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } : {});

    if (!Object.keys(schema).length)
      skipped.push(`Unsupported Mongoose type ${name}; retained as unconstrained`);
  }

  const values = literal(fields.get('enum'));

  if (Array.isArray(values)) schema.enum = values;

  for (const [input, output] of [
    ['min', 'minimum'],
    ['max', 'maximum'],
    ['minlength', 'minLength'],
    ['maxlength', 'maxLength'],
  ] as const) {
    const value = literal(fields.get(input));

    if (value !== undefined) schema[output] = value;
  }

  return schema;
}

function mongooseObject(
  node: ts.Expression,
  variables: Map<string, ts.Expression>,
  skipped: string[],
): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];

  if (!ts.isObjectLiteralExpression(node)) {
    skipped.push(`Dynamic Mongoose schema ${node.getText()} requires an exported schema`);

    return {};
  }

  for (const [name, value] of objectFields(node)) {
    properties[name] = mongooseField(value, variables, skipped);

    if (literal(objectFields(value).get('required')) === true) required.push(name);
  }

  const schema: JsonObject = { type: 'object', properties };

  if (required.length) schema.required = required;

  return schema;
}

function sourceResource(
  ref: ResourceRef<'collection' | 'table'>,
  schema: JsonObject,
  adapter: string,
  file: string,
  symbol: string,
  line: number,
): CatalogResource {
  return {
    ...architectureResource(ref, { adapter, schema }),
    source: { type: 'code', file, symbol, line },
    provenance: { default: 'extracted', fields: {} },
    needsReview: false,
  };
}

/** Remove `//` comments. String literals stay whole: they may contain `//`, `{` or `}`. */
function withoutPrismaComments(content: string): string {
  let output = '';
  let quoted = false;

  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;

    if (quoted) {
      if (char === '\\') {
        output += content.slice(index, index + 2);
        index++;
        continue;
      }

      if (char === '"' || char === '\n') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '/' && content[index + 1] === '/') {
      const end = content.indexOf('\n', index);

      if (end === -1) break;
      index = end - 1;
      continue;
    }

    output += char;
  }

  return output;
}

interface PrismaBlock {
  keyword: string;
  name: string;
  line: number;
  lines: string[];
}

/**
 * The top-level `keyword Name { ... }` blocks of a schema file. One pass over
 * the text; a brace inside a string does not open or close a block.
 */
function prismaBlocks(content: string, file: string, skipped: string[]): PrismaBlock[] {
  const code = withoutPrismaComments(content);
  const blocks: PrismaBlock[] = [];
  let depth = 0;
  let quoted = false;
  let line = 1;
  let headerStart = 0;
  let bodyStart = 0;
  let open: Omit<PrismaBlock, 'lines'> | undefined;

  for (let index = 0; index < code.length; index++) {
    const char = code[index];

    if (char === '\n') line++;

    if (quoted) {
      if (char === '\\') index++;
      else if (char === '"' || char === '\n') quoted = false;
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === '{') {
      if (depth === 0) {
        const [keyword = '', name = ''] = code
          .slice(headerStart, index)
          .trim()
          .split(/\s+/)
          .slice(-2);

        open = { keyword, name, line };
        bodyStart = index + 1;
      }

      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;

      if (depth === 0) {
        if (open?.name) blocks.push({ ...open, lines: code.slice(bodyStart, index).split('\n') });
        headerStart = index + 1;
      }
    }
  }

  if (depth > 0 && open) skipped.push(`${file}: ${open.keyword} ${open.name} is never closed`);

  return blocks;
}

const mappedName = (text: string, attribute: '@map' | '@@map' | '@@schema') =>
  new RegExp(`(?:^|\\s)${attribute}\\("([^"]*)"\\)`).exec(text)?.[1];

interface PrismaModel {
  ref: ResourceRef<'collection' | 'table'>;
  /** Prisma field name → database column name. */
  aliases: Map<string, string>;
}

/**
 * Models of every schema file, read together: a multi-file schema declares its
 * datasource, enums and related models in different files.
 */
function prismaResources(
  files: Array<{ relative: string; content: string }>,
  namespace: string,
  skipped: string[],
) {
  const graph = emptyResourceGraph();
  const models = new Map<string, PrismaModel>();

  const blocks = files.map((file) => ({
    ...file,
    blocks: prismaBlocks(file.content, file.relative, skipped),
  }));

  const all = blocks.flatMap((file) => file.blocks);
  const enums = new Map<string, string[]>();

  for (const block of all.filter((item) => item.keyword === 'enum'))
    enums.set(
      block.name,
      block.lines.flatMap((line) => {
        const name = /^\s*(\w+)/.exec(line)?.[1];

        return name ? [mappedName(line, '@map') ?? name] : [];
      }),
    );

  const related = new Set(all.flatMap((item) => (item.keyword === 'model' ? [item.name] : [])));

  const kind = all.some(
    (block) =>
      block.keyword === 'datasource' &&
      block.lines.some((line) => /^\s*provider\s*=\s*"mongodb"/.test(line)),
  )
    ? 'collection'
    : 'table';

  const primitives = new Map(
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

  for (const { relative: file, blocks: fileBlocks } of blocks)
    for (const block of fileBlocks) {
      if (block.keyword !== 'model') continue;
      const symbol = block.name;
      const body = block.lines.join('\n');
      const table = mappedName(body, '@@map') ?? symbol;
      const sqlSchema = mappedName(body, '@@schema');
      const properties: JsonObject = {};
      const required: string[] = [];
      const aliases = new Map<string, string>();

      for (const line of block.lines) {
        const field = /^\s*(\w+)\s+(\w+)(\[\]|\?)?(.*)$/.exec(line);

        if (!field) continue;
        const [, name, type, modifier, options] = field;

        if (!name || !type || related.has(type)) continue;
        const column = mappedName(options ?? '', '@map') ?? name;

        let schema =
          primitives.get(type) ??
          (enums.has(type) ? { type: 'string', enum: enums.get(type)! } : {});

        if (!primitives.has(type) && !enums.has(type))
          skipped.push(`${file}: unsupported Prisma field ${symbol}.${name} (${type})`);

        if (modifier === '[]') schema = { type: 'array', items: schema };

        if (modifier === '?') schema = { anyOf: [schema, { type: 'null' }] };
        properties[column] = schema;
        aliases.set(name, column);
        required.push(column);
      }

      const ref: ResourceRef<'collection' | 'table'> = {
        kind,
        namespace,
        id: sqlSchema ? `${sqlSchema}.${table}` : table,
      };

      const resource = sourceResource(
        ref,
        { type: 'object', properties, required },
        'prisma',
        file,
        symbol,
        block.line,
      );

      resource.attributes = { ...resource.attributes, fieldAliases: Object.fromEntries(aliases) };
      graph.resources.push(resource);
      models.set(`${symbol[0]!.toLowerCase()}${symbol.slice(1)}`, { ref, aliases });
    }

  return { graph, models };
}

/** A model, table or Prisma client that a local name refers to. */
type Binding =
  | { kind: 'model'; ref: ResourceRef<'collection' | 'table'>; inferred: boolean }
  | { kind: 'prisma' };

interface ImportedName {
  module: string;
  /** `default` for a default import or a whole CommonJS module. */
  name: string;
}

/** What one source file defines and how it links to others. Plain data, so its AST can be dropped. */
interface ModuleInfo {
  locals: Map<string, Binding>;
  imports: Map<string, ImportedName>;
  /** Exported name → local name. */
  exports: Map<string, string>;
  reexports: Map<string, ImportedName>;
  stars: string[];
  /** Mentions `.query.`, so it may use Drizzle's relational queries without importing a table. */
  queries: boolean;
}

/** Names of expressions that are exported without a local name of their own. */
const DEFAULT_EXPORT = 'export default';

/**
 * Every named value in a file, plus its import and export links. A default
 * export or `module.exports` of an expression is named {@link DEFAULT_EXPORT}.
 */
function moduleLinks(ast: ts.SourceFile) {
  const values = new Map<string, ts.Expression>();
  const imports = new Map<string, ImportedName>();
  const exports = new Map<string, string>();
  const reexports = new Map<string, ImportedName>();
  const stars: string[] = [];

  const exportValue = (name: string, value: ts.Expression) => {
    if (ts.isIdentifier(value)) exports.set(name, value.text);
    else {
      const local = name === 'default' ? DEFAULT_EXPORT : `exports.${name}`;
      values.set(local, value);
      exports.set(name, local);
    }
  };

  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = textLiteral(statement.moduleSpecifier);
      const clause = statement.importClause;

      if (!module || !clause) continue;

      if (clause.name) imports.set(clause.name.text, { module, name: 'default' });

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const item of clause.namedBindings.elements)
          imports.set(item.name.text, { module, name: item.propertyName?.text ?? item.name.text });
    } else if (ts.isExportDeclaration(statement)) {
      const module = textLiteral(statement.moduleSpecifier);

      if (!statement.exportClause) {
        if (module) stars.push(module);
      } else if (ts.isNamedExports(statement.exportClause))
        for (const item of statement.exportClause.elements) {
          const local = item.propertyName?.text ?? item.name.text;

          if (module) reexports.set(item.name.text, { module, name: local });
          else exports.set(item.name.text, local);
        }
    } else if (ts.isExportAssignment(statement)) exportValue('default', statement.expression);
    else if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name))
          exports.set(declaration.name.text, declaration.name.text);
    } else if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const { left, right } = statement.expression;
      const target = left.getText();

      if (target === 'module.exports' && ts.isObjectLiteralExpression(right)) {
        for (const item of right.properties)
          if (ts.isShorthandPropertyAssignment(item)) exports.set(item.name.text, item.name.text);
          else if (ts.isPropertyAssignment(item)) {
            const name = propertyName(item.name);

            if (name) exportValue(name, item.initializer);
          }
      } else if (target === 'module.exports') exportValue('default', right);
      else if (
        ts.isPropertyAccessExpression(left) &&
        /^(module\.)?exports$/.test(left.expression.getText())
      )
        exportValue(left.name.text, right);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const required =
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'require'
          ? textLiteral(node.initializer.arguments[0])
          : undefined;

      if (ts.isIdentifier(node.name)) {
        values.set(node.name.text, node.initializer);

        if (required) imports.set(node.name.text, { module: required, name: 'default' });
      } else if (required && ts.isObjectBindingPattern(node.name))
        for (const item of node.name.elements)
          if (ts.isIdentifier(item.name))
            imports.set(item.name.text, {
              module: required,
              name: item.propertyName ? (propertyName(item.propertyName) ?? '') : item.name.text,
            });
    }

    ts.forEachChild(node, visit);
  };

  visit(ast);

  return { values, imports, exports, reexports, stars };
}

/** The first node of an expression, outside nested functions, that matches. */
function findWithin<T extends ts.Node>(
  node: ts.Node,
  match: (node: ts.Node) => node is T,
): T | undefined {
  if (match(node)) return node;

  if (ts.isFunctionLike(node)) return undefined;

  return ts.forEachChild(node, (child) => findWithin(child, match));
}

const MONGOOSE_UNCOUNTABLE = new Set([
  'advice',
  'energy',
  'excretion',
  'digestion',
  'cooperation',
  'health',
  'justice',
  'labour',
  'machinery',
  'equipment',
  'information',
  'pollution',
  'sewage',
  'paper',
  'money',
  'species',
  'series',
  'rain',
  'rice',
  'fish',
  'sheep',
  'moose',
  'deer',
  'news',
  'expertise',
  'status',
  'media',
]);

const MONGOOSE_PLURALS: Array<[RegExp, string]> = [
  [/human$/gi, 'humans'],
  [/(m)an$/gi, '$1en'],
  [/(pe)rson$/gi, '$1ople'],
  [/(child)$/gi, '$1ren'],
  [/^(ox)$/gi, '$1en'],
  [/(ax|test)is$/gi, '$1es'],
  [/(octop|vir)us$/gi, '$1i'],
  [/(alias|status)$/gi, '$1es'],
  [/(bu)s$/gi, '$1ses'],
  [/(buffal|tomat|potat)o$/gi, '$1oes'],
  [/([ti])um$/gi, '$1a'],
  [/sis$/gi, 'ses'],
  [/(?:([^f])fe|([lr])f)$/gi, '$1$2ves'],
  [/(hive)$/gi, '$1s'],
  [/([^aeiouy]|qu)y$/gi, '$1ies'],
  [/(x|ch|ss|sh)$/gi, '$1es'],
  [/(matr|vert|ind)ix|ex$/gi, '$1ices'],
  [/([m|l])ouse$/gi, '$1ice'],
  [/(kn|w|l)ife$/gi, '$1ives'],
  [/(quiz)$/gi, '$1zes'],
  [/^goose$/i, 'geese'],
  [/s$/gi, 's'],
  [/([^a-z])$/, '$1'],
  [/$/gi, 's'],
];

/** Mongoose's default collection name for a model (mongoose/lib/helpers/pluralize.js). */
export function mongooseCollectionName(model: string): string {
  const name = model.toLowerCase();

  if (MONGOOSE_UNCOUNTABLE.has(name)) return name;
  const rule = MONGOOSE_PLURALS.find(([pattern]) => name.match(pattern));

  return rule ? name.replace(rule[0], rule[1]) : name;
}

function mongooseModels(
  values: Map<string, ts.Expression>,
  context: { ast: ts.SourceFile; relative: string; namespace: string; skipped: string[] },
) {
  const { ast, relative, namespace, skipped } = context;
  const resources: CatalogResource[] = [];
  const locals = new Map<string, Binding>();

  const isModelCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    (ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text === 'model'
      : ts.isIdentifier(node.expression) && node.expression.text === 'model') &&
    textLiteral(node.arguments[0]) !== undefined &&
    node.arguments[1] !== undefined;

  for (const [local, value] of values) {
    const call = findWithin(value, isModelCall);

    if (!call) continue;
    const model = textLiteral(call.arguments[0])!;
    const schemaArg = call.arguments[1]!;
    const symbol = /^\w+$/.test(local) ? local : model;
    const definition = ts.isIdentifier(schemaArg) ? values.get(schemaArg.text) : schemaArg;

    if (!definition || !ts.isNewExpression(definition) || !definition.arguments?.[0]) {
      skipped.push(`${relative}: ${symbol} has a dynamic schema`);
      continue;
    }

    const collection =
      textLiteral(call.arguments[2]) ??
      textLiteral(objectFields(definition.arguments[1]).get('collection'));

    // Without a declared collection the name is Mongoose's default pluralisation,
    // which an application can replace; the name and every edge to it stay reviewable.
    const ref: ResourceRef<'collection'> = {
      kind: 'collection',
      namespace,
      id: collection ?? mongooseCollectionName(model),
    };

    locals.set(local, { kind: 'model', ref, inferred: !collection });

    const resource = sourceResource(
      ref,
      mongooseObject(definition.arguments[0], values, skipped),
      'mongoose',
      relative,
      symbol,
      ast.getLineAndCharacterOfPosition(call.getStart()).line + 1,
    );

    if (!collection) {
      resource.provenance.fields.id = 'inferred';
      resource.needsReview = true;
      skipped.push(
        `${relative}: ${symbol} collection name inferred; declare collection for custom pluralization`,
      );
    }

    resources.push(resource);
  }

  return { resources, locals };
}

function drizzleResources(ast: ts.SourceFile, namespace: string, file: string, skipped: string[]) {
  const resources: CatalogResource[] = [];
  const tables = new Map<string, ResourceRef<'table'>>();
  const constructors = new Map<string, string>();

  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !textLiteral(statement.moduleSpecifier)?.startsWith('drizzle-orm/')
    )
      continue;
    const bindings = statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements)
        constructors.set(item.name.text, item.propertyName?.text ?? item.name.text);
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const call = node.initializer;

      const factory = ts.isIdentifier(call.expression)
        ? constructors.get(call.expression.text)
        : undefined;

      const id = textLiteral(call.arguments[0]);

      if (
        factory &&
        ['pgTable', 'mysqlTable', 'sqliteTable'].includes(factory) &&
        id &&
        call.arguments[1]
      ) {
        const properties: JsonObject = {};
        const required: string[] = [];
        const aliases: JsonObject = {};

        for (const [name, expression] of objectFields(call.arguments[1])) {
          let base = expression;
          let nonNullable = false;
          let array = false;

          while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression)) {
            const modifier = base.expression.name.text;

            if (modifier === 'notNull' || modifier === 'primaryKey') nonNullable = true;

            if (modifier === 'array') array = true;
            base = base.expression.expression;
          }

          if (!ts.isCallExpression(base) || !ts.isIdentifier(base.expression)) {
            skipped.push(`${file}: dynamic Drizzle column ${name}`);
            properties[name] = {};
            required.push(name);
            continue;
          }

          const type = constructors.get(base.expression.text) ?? base.expression.text;
          const column = textLiteral(base.arguments[0]) ?? name;

          const primitives = new Map(
            Object.entries<JsonObject>({
              text: { type: 'string' },
              varchar: { type: 'string' },
              char: { type: 'string' },
              uuid: { type: 'string', format: 'uuid' },
              integer: { type: 'integer' },
              int: { type: 'integer' },
              smallint: { type: 'integer' },
              serial: { type: 'integer' },
              boolean: { type: 'boolean' },
              real: { type: 'number' },
              doublePrecision: { type: 'number' },
              numeric: { type: 'string', format: 'decimal' },
              decimal: { type: 'string', format: 'decimal' },
              bigint: { type: 'string', pattern: '^-?[0-9]+$' },
              timestamp: { type: 'string', format: 'date-time' },
              date: { type: 'string', format: 'date' },
              json: {},
              jsonb: {},
            }),
          );

          let schema = primitives.get(type) ?? {};

          if (!primitives.has(type))
            skipped.push(`${file}: unsupported Drizzle column ${name} (${type})`);
          const values = literal(objectFields(base.arguments[1]).get('enum'));

          if (Array.isArray(values)) schema = { ...schema, enum: values };

          if (array) schema = { type: 'array', items: schema };

          if (!nonNullable && !['serial'].includes(type))
            schema = { anyOf: [schema, { type: 'null' }] };
          properties[column] = schema;
          aliases[name] = column;
          required.push(column);
        }

        const ref: ResourceRef<'table'> = { kind: 'table', namespace, id };
        tables.set(node.name.text, ref);

        const resource = sourceResource(
          ref,
          { type: 'object', properties, required },
          'drizzle',
          file,
          node.name.text,
          ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        );

        resource.attributes = { ...resource.attributes, fieldAliases: aliases };
        resources.push(resource);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(ast);

  return { resources, tables };
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** TypeScript resolves an import of the emitted file to its source. */
const SOURCE_FOR_OUTPUT = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

const isSourceFile = (file: string) => SOURCE_EXTENSIONS.includes(path.extname(file));

const DRIZZLE_READS = new Set(['from', 'leftJoin', 'rightJoin', 'innerJoin', 'fullJoin']);

const PRISMA_READS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const PRISMA_WRITES = new Set([
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

/**
 * A Drizzle builder call with a table argument. Reading needs a builder before
 * it (`db.select().from(t)`, so `Array.from(t)` is not a read). Writing needs
 * the query to be chained, awaited or returned.
 */
function drizzleAccess(call: ts.CallExpression, method: string): 'reads' | 'writes' | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;

  if (DRIZZLE_READS.has(method))
    return ts.isCallExpression(call.expression.expression) ? 'reads' : undefined;

  if (method !== 'insert' && method !== 'update' && method !== 'delete') return undefined;
  const parent = call.parent;

  // Read from syntax: `cache.delete(users)` as a statement is not a query, and
  // `await cache.delete(users)` is.
  return (ts.isPropertyAccessExpression(parent) && parent.expression === call) ||
    ts.isAwaitExpression(parent) ||
    ts.isReturnStatement(parent)
    ? 'writes'
    : undefined;
}

/** Fields named by a Prisma `select`; empty (every field) unless it is a plain literal. */
function prismaSelection(args: ts.Node | undefined, aliases: Map<string, string>): string[] {
  const select = staticObject(args)?.get('select');
  const fields = select ? staticObject(select) : undefined;

  if (!fields) return [];
  const columns: string[] = [];

  for (const [name, value] of fields) {
    const column = aliases.get(name);

    // A relation: its own columns are not this table's.
    if (!column) continue;
    const chosen = literal(value);

    if (chosen !== true && chosen !== false) return [];

    if (chosen) columns.push(column);
  }

  return columns;
}

/** The root package's name: a service id that does not depend on the checkout's directory name. */
async function packageName(root: string): Promise<string | undefined> {
  const manifest = await readOptionalResourceJson(path.join(root, 'package.json'), { root }).catch(
    () => undefined,
  );

  const parsed = z.object({ name: z.string().min(1) }).safeParse(manifest);

  return parsed.success ? parsed.data.name : undefined;
}

/**
 * Two definitions of one resource that disagree, typically one `model User` per
 * service of a monorepo, sharing the default datastore. Merging would have to
 * pick one, so the resource is kept for its edges but without a schema, and the
 * scan reports it rather than failing.
 */
function withoutCompetingSchemas(graphs: ResourceGraph[], skipped: string[]): ResourceGraph[] {
  const definitions = new Map<string, Array<{ ref: ResourceRef; file: string; schema: string }>>();

  for (const resource of graphs.flatMap((graph) => graph.resources)) {
    if (!isArchitectureCatalogResource(resource) || !resource.attributes.schema) continue;
    const key = resourceKey(resource.ref);

    definitions.set(key, [
      ...(definitions.get(key) ?? []),
      {
        ref: resource.ref,
        file: resource.source?.file ?? '',
        schema: JSON.stringify(resource.attributes.schema),
      },
    ]);
  }

  const competing = new Set<string>();

  for (const [key, found] of definitions) {
    if (new Set(found.map((item) => item.schema)).size < 2) continue;
    competing.add(key);
    const files = [...new Set(found.map((item) => item.file))].sort();
    const ref = found[0]!.ref;

    const where =
      files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files.at(-1)}` : files[0];

    skipped.push(
      `${ref.kind} ${ref.id} is defined differently in ${where}; its schema is left out until each is scanned with its own datastore`,
    );
  }

  if (!competing.size) return graphs;

  return graphs.map((graph) => ({
    ...graph,
    resources: graph.resources.map((resource) => {
      if (!competing.has(resourceKey(resource.ref)) || !isArchitectureCatalogResource(resource))
        return resource;
      const { schema: _schema, fieldAliases: _aliases, ...attributes } = resource.attributes;

      return {
        ...resource,
        attributes,
        provenance: { default: 'inferred' as const, fields: {} },
        needsReview: true,
      };
    }),
  }));
}

/** Passive model extraction: source is parsed, never imported or evaluated. */
export async function scanModelResources(
  options: ModelScanOptions,
): Promise<ResourceDiscoveryResult> {
  const root = path.resolve(options.root);
  // Identity must not depend on where the repository is checked out: a drift
  // baseline lives in a directory of another name. Without a configured
  // datastore every model shares `default/default`; definitions that then
  // collide are reported by withoutCompetingSchemas instead of failing the scan.
  const namespace = `${options.datastore ?? 'default'}/${options.database ?? 'default'}`;
  const service = options.service ?? (await packageName(root)) ?? 'default';
  const graphs: ResourceGraph[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];

  const files = await resourceFiles(options, {
    include: (file) => isSourceFile(file) || file.endsWith('.prisma'),
    skipped,
  });

  const read = async (file: string) => {
    try {
      return await readResourceSource(file, options);
    } catch (error) {
      if (!(error instanceof ResourceReadError)) throw error;
      skipped.push(error.message);

      return undefined;
    }
  };

  const relativeTo = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const schemaFiles: Array<{ relative: string; content: string }> = [];

  for (const file of files.filter((item) => item.endsWith('.prisma'))) {
    const content = await read(file);

    if (content !== undefined) schemaFiles.push({ relative: relativeTo(file), content });
  }

  const prisma = prismaResources(schemaFiles, namespace, skipped);
  graphs.push(prisma.graph);

  // First pass: what each file defines, imports and exports. Its syntax tree
  // is dropped; the second pass parses again only the files that use a model.
  const modules = new Map<string, ModuleInfo>();
  const drizzleTables = new Map<string, ResourceRef<'table'>>();

  for (const file of files.filter(isSourceFile)) {
    const content = await read(file);

    if (content === undefined) continue;
    const relative = relativeTo(file);
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const { values, ...links } = moduleLinks(ast);
    const locals = new Map<string, Binding>();
    const graph = emptyResourceGraph();

    const constructors = new Set(
      [...links.imports].flatMap(([local, imported]) =>
        imported.name === 'PrismaClient' ? [local] : [],
      ),
    );

    const isClient = (node: ts.Node): node is ts.NewExpression =>
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      constructors.has(node.expression.text);

    if (constructors.size)
      for (const [local, value] of values)
        if (findWithin(value, isClient)) locals.set(local, { kind: 'prisma' });

    if (content.includes('drizzle-orm')) {
      const drizzle = drizzleResources(ast, namespace, relative, skipped);
      graph.resources.push(...drizzle.resources);

      for (const [local, ref] of drizzle.tables) {
        locals.set(local, { kind: 'model', ref, inferred: false });
        drizzleTables.set(local, ref);
      }
    }

    if (content.includes('mongoose')) {
      const mongoose = mongooseModels(values, { ast, relative, namespace, skipped });
      graph.resources.push(...mongoose.resources);

      for (const [local, binding] of mongoose.locals) locals.set(local, binding);
    }

    if (graph.resources.length) {
      graph.resources.push(architectureService(service));
      graphs.push(graph);
    }

    modules.set(file, { ...links, locals, queries: content.includes('.query.') });
  }

  const resolveModule = (file: string, specifier: string) => {
    if (!specifier.startsWith('.')) return undefined;
    const base = path.resolve(path.dirname(file), specifier);
    const extension = path.extname(base);
    const stem = base.slice(0, base.length - extension.length);

    return [
      base,
      ...(SOURCE_FOR_OUTPUT.get(extension) ?? []).map((source) => `${stem}${source}`),
      ...SOURCE_EXTENSIONS.map((source) => `${base}${source}`),
      ...SOURCE_EXTENSIONS.map((source) => path.join(base, `index${source}`)),
    ].find((candidate) => modules.has(candidate));
  };

  // `seen` stops an import cycle; a name is looked up at most once per lookup.
  const exported = (file: string, name: string, seen: Set<string>): Binding | undefined => {
    const key = `${file}\0${name}`;
    const info = modules.get(file);

    if (!info || seen.has(key)) return undefined;
    seen.add(key);
    const local = info.exports.get(name);

    if (local !== undefined) return bound(file, local, seen);
    const reexport = info.reexports.get(name);

    if (reexport) {
      const target = resolveModule(file, reexport.module);

      return target ? exported(target, reexport.name, seen) : undefined;
    }

    if (name === 'default') return undefined;

    for (const star of info.stars) {
      const target = resolveModule(file, star);
      const binding = target ? exported(target, name, seen) : undefined;

      if (binding) return binding;
    }

    return undefined;
  };

  const bound = (file: string, local: string, seen: Set<string>): Binding | undefined => {
    const info = modules.get(file);
    const own = info?.locals.get(local);

    if (own) return own;
    const imported = info?.imports.get(local);
    const target = imported ? resolveModule(file, imported.module) : undefined;

    return target && imported ? exported(target, imported.name, seen) : undefined;
  };

  // Second pass: accesses, in the files that can reach a model.
  for (const [file, info] of modules) {
    const bindings = new Map<string, Binding>();

    for (const local of new Set([...info.locals.keys(), ...info.imports.keys()])) {
      const binding = bound(file, local, new Set());

      if (binding) bindings.set(local, binding);
    }

    if (!bindings.size && !(info.queries && drizzleTables.size)) continue;
    const content = await read(file);

    if (content === undefined) continue;
    const relative = relativeTo(file);
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const graph = emptyResourceGraph();

    const clients = new Set(
      [...bindings].flatMap(([name, binding]) => (binding.kind === 'prisma' ? [name] : [])),
    );

    const access = (
      node: ts.Node,
      type: 'reads' | 'writes',
      ref: ResourceRef<'collection' | 'table'>,
      inferred: boolean,
      fields: string[] = [],
    ) =>
      graph.relationships.push({
        type,
        from: { kind: 'service', id: service },
        to: ref,
        provenance: inferred ? 'inferred' : 'extracted',
        needsReview: inferred,
        source: {
          type: 'code',
          file: relative,
          line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        },
        attributes: type === 'reads' && fields.length ? { fields } : undefined,
      });

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression;
        const model = ts.isIdentifier(receiver) ? bindings.get(receiver.text) : undefined;
        const argument = node.arguments[0];

        const table =
          argument && ts.isIdentifier(argument) ? bindings.get(argument.text) : undefined;

        if (model?.kind === 'model' && model.ref.kind === 'collection') {
          const type = method === 'create' ? 'writes' : databaseAccess(method);

          if (type)
            access(
              node,
              type,
              model.ref,
              model.inferred,
              type === 'reads' ? includedProjection(node.arguments[1]) : [],
            );
        }

        if (table?.kind === 'model' && table.ref.kind === 'table') {
          const type = drizzleAccess(node, method);

          if (type) access(node, type, table.ref, table.inferred);
        }

        // Drizzle's relational queries: db.query.<table>.findMany()
        if (
          (method === 'findMany' || method === 'findFirst') &&
          ts.isPropertyAccessExpression(receiver) &&
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === 'query'
        ) {
          const ref = drizzleTables.get(receiver.name.text);

          if (ref) access(node, 'reads', ref, false);
        }

        if (
          ts.isPropertyAccessExpression(receiver) &&
          ts.isIdentifier(receiver.expression) &&
          clients.has(receiver.expression.text)
        ) {
          const delegate = prisma.models.get(receiver.name.text);

          const type = PRISMA_READS.has(method)
            ? 'reads'
            : PRISMA_WRITES.has(method)
              ? 'writes'
              : undefined;

          if (delegate && type)
            access(node, type, delegate.ref, false, prismaSelection(argument, delegate.aliases));
        }

        // An interactive transaction hands its callback a client.
        const callback = node.arguments[0];

        if (
          method === '$transaction' &&
          ts.isIdentifier(receiver) &&
          clients.has(receiver.text) &&
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        ) {
          const client = callback.parameters[0]?.name;

          if (client && ts.isIdentifier(client)) clients.add(client.text);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(ast);

    if (graph.relationships.length) {
      graph.resources.push(architectureService(service));
      graphs.push(graph);
    }
  }

  try {
    const exports: ModelExport[] = modelExports.parse(
      (await readOptionalResourceJson(path.join(root, '.autocatalog', 'models.json'), { root })) ??
        [],
    );

    const exported = emptyResourceGraph();

    for (const definition of exports)
      exported.resources.push(
        sourceResource(
          {
            kind: definition.kind,
            namespace: `${definition.datastore}/${definition.database}`,
            id: definition.id,
          },
          definition.schema,
          definition.adapter,
          '.autocatalog/models.json',
          definition.symbol ?? definition.id,
          1,
        ),
      );
    const exportedKeys = new Set(exported.resources.map((resource) => resourceKey(resource.ref)));

    const passive = withoutCompetingSchemas(
      graphs.map((graph) => ({
        ...graph,
        resources: graph.resources.filter(
          (resource) => !exportedKeys.has(resourceKey(resource.ref)),
        ),
      })),
      skipped,
    );

    return { graph: mergeArchitectureGraphs(...passive, exported), errors, skipped };
  } catch (error) {
    return {
      graph: emptyResourceGraph(),
      errors: [error instanceof Error ? error.message : String(error)],
      skipped,
    };
  }
}
