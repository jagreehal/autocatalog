import ts from 'typescript';
import type { JsonObject, JsonValue } from './json';
import { filled, literal, objectFields, sourceResource, textLiteral } from './model-source';
import type { ModelField, ParsedModel } from './model-source';
import type { CatalogResource, ResourceRef } from './resource-graph';

export interface DrizzleResources {
  resources: Array<CatalogResource>;
  models: Array<ParsedModel>;
  /** Each table, by the variable that holds it. */
  tables: Map<string, ResourceRef<'table'>>;
}

interface DrizzleFile {
  namespace: string;
  file: string;
  skipped: Array<string>;
}

function drizzleBindings(statement: ts.Statement): ReadonlyArray<ts.ImportSpecifier> {
  if (!ts.isImportDeclaration(statement)) {
    return [];
  }

  const bindings = statement.importClause?.namedBindings;
  const module = textLiteral(statement.moduleSpecifier) ?? '';

  return bindings && ts.isNamedImports(bindings) && module.startsWith('drizzle-orm/')
    ? bindings.elements
    : [];
}

/** Drizzle's own name for each name a file imports from it. */
const drizzleImports = (ast: ts.SourceFile) =>
  new Map(
    ast.statements
      .flatMap((statement) => drizzleBindings(statement))
      .map(({ name, propertyName }) => [name.text, (propertyName ?? name).text]),
  );

interface DrizzleColumn {
  field: ModelField;
  nonNullable: boolean;
  array: boolean;
  /** What the modifiers are called on: `varchar('name')`. */
  base: ts.Expression;
}

/** `.references(() => users.id)`: the table is resolved once every file is read. */
function referenced({ field }: DrizzleColumn, argument: ts.Expression | undefined) {
  const target = argument && ts.isArrowFunction(argument) ? argument.body : undefined;

  if (target && ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    field.relation = {
      model: target.expression.text,
      many: false,
      fields: [field.name],
      references: [target.name.text],
    };
  }
}

/** What each call after a column's type says about it. */
const MODIFIERS = new Map<string, (column: DrizzleColumn, argument?: ts.Expression) => void>([
  [
    'notNull',
    (column) => {
      column.nonNullable = true;
    },
  ],
  [
    'primaryKey',
    (column) => {
      column.nonNullable = true;
      column.field.id = true;
    },
  ],
  [
    'unique',
    ({ field }) => {
      field.unique = true;
    },
  ],
  [
    'default',
    ({ field }, argument) => {
      if (argument) {
        field.default = argument.getText();
      }
    },
  ],
  [
    'defaultNow',
    ({ field }) => {
      field.default = 'now()';
    },
  ],
  ['references', referenced],
  [
    'array',
    (column) => {
      column.array = true;
    },
  ],
]);

function drizzleColumn(name: string, expression: ts.Expression): DrizzleColumn {
  const column: DrizzleColumn = {
    field: { name, type: '' },
    nonNullable: false,
    array: false,
    base: expression,
  };

  while (
    ts.isCallExpression(column.base) &&
    ts.isPropertyAccessExpression(column.base.expression)
  ) {
    MODIFIERS.get(column.base.expression.name.text)?.(column, column.base.arguments[0]);
    column.base = column.base.expression.expression;
  }

  return column;
}

const COLUMN_SCHEMAS = new Map(
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

/** A column type's schema, as its enum, list and nullability make it. */
function columnSchema(
  type: string,
  values: JsonValue | undefined,
  { array, nullable }: { array: boolean; nullable: boolean },
): JsonObject {
  const named = COLUMN_SCHEMAS.get(type) ?? {};
  const one = Array.isArray(values) ? { ...named, enum: values } : named;
  const schema = array ? { type: 'array', items: one } : one;

  return nullable ? { anyOf: [schema, { type: 'null' }] } : schema;
}

const columnDetail = (
  values: JsonValue | undefined,
  { array, nullable }: { array: boolean; nullable: boolean },
) => ({
  ...(array && { list: true }),
  ...(nullable && { optional: true }),
  ...(Array.isArray(values) && { enum: values.map(String) }),
});

/** A table's columns: their JSON Schema, their names in code, and their fields. */
function drizzleTable(
  columns: ts.Expression,
  imported: Map<string, string>,
  { file, skipped }: DrizzleFile,
) {
  const properties: JsonObject = {};
  const required: Array<string> = [];
  const aliases: JsonObject = {};
  const fields: Array<ModelField> = [];

  for (const [name, expression] of objectFields(columns)) {
    const { field, nonNullable, array, base } = drizzleColumn(name, expression);

    if (!ts.isCallExpression(base) || !ts.isIdentifier(base.expression)) {
      skipped.push(`${file}: dynamic Drizzle column ${name}`);
      properties[name] = {};
      required.push(name);
      continue;
    }

    const type = imported.get(base.expression.text) ?? base.expression.text;
    const column = textLiteral(base.arguments[0]) ?? name;

    if (!COLUMN_SCHEMAS.has(type)) {
      skipped.push(`${file}: unsupported Drizzle column ${name} (${type})`);
    }

    const values = literal(objectFields(base.arguments[1]).get('enum'));
    const holds = { array, nullable: !nonNullable && type !== 'serial' };

    properties[column] = columnSchema(type, values, holds);
    aliases[name] = column;
    required.push(column);
    fields.push({
      ...field,
      type,
      ...(column !== name && { column }),
      ...columnDetail(values, holds),
    });
  }

  return { schema: { type: 'object', properties, required }, aliases, fields };
}

const TABLES = new Set(['pgTable', 'mysqlTable', 'sqliteTable']);

/** The table a variable holds: `const users = pgTable('users', { ... })`. */
function tableDeclaration(node: ts.Node, imported: Map<string, string>) {
  if (
    !ts.isVariableDeclaration(node) ||
    !ts.isIdentifier(node.name) ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer)
  ) {
    return undefined;
  }

  const { expression, arguments: args } = node.initializer;
  const [name, columns] = args;
  const id = textLiteral(name);

  return ts.isIdentifier(expression) &&
    TABLES.has(imported.get(expression.text) ?? '') &&
    filled(id) &&
    columns
    ? { symbol: node.name.text, id, columns }
    : undefined;
}

export function drizzleResources(ast: ts.SourceFile, context: DrizzleFile): DrizzleResources {
  const { namespace, file } = context;
  const resources: Array<CatalogResource> = [];
  const models: Array<ParsedModel> = [];
  const tables = new Map<string, ResourceRef<'table'>>();
  const imported = drizzleImports(ast);

  const visit = (node: ts.Node) => {
    const table = tableDeclaration(node, imported);

    if (table) {
      const { symbol, id, columns } = table;
      const { schema, aliases, fields } = drizzleTable(columns, imported, context);
      const ref: ResourceRef<'table'> = { kind: 'table', namespace, id };
      const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const resource = sourceResource(ref, { adapter: 'drizzle', schema }, { file, symbol, line });

      tables.set(symbol, ref);
      resource.attributes = { ...resource.attributes, fieldAliases: aliases };
      resources.push(resource);
      models.push({ resource, ref, fields, file, line });
    }

    ts.forEachChild(node, visit);
  };

  visit(ast);

  return { resources, models, tables };
}

const DRIZZLE_READS = new Set(['from', 'leftJoin', 'rightJoin', 'innerJoin', 'fullJoin']);

const DRIZZLE_WRITES = new Set(['insert', 'update', 'delete']);

/** Chained, awaited or returned, read from syntax: `cache.delete(users)` as a statement is not a query. */
const isQuery = (call: ts.CallExpression) =>
  (ts.isPropertyAccessExpression(call.parent) && call.parent.expression === call) ||
  ts.isAwaitExpression(call.parent) ||
  ts.isReturnStatement(call.parent);

/**
 * A Drizzle builder call with a table argument. Reading needs a builder before
 * it (`db.select().from(t)`, so `Array.from(t)` is not a read). Writing needs
 * the query to be chained, awaited or returned.
 */
export function drizzleAccess(
  call: ts.CallExpression,
  method: string,
): 'reads' | 'writes' | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return undefined;
  }

  if (DRIZZLE_READS.has(method)) {
    return ts.isCallExpression(call.expression.expression) ? 'reads' : undefined;
  }

  return DRIZZLE_WRITES.has(method) && isQuery(call) ? 'writes' : undefined;
}
