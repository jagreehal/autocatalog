import ts from 'typescript';
import type { JsonObject } from './json';
import {
  filled,
  literal,
  objectFields,
  propertyName,
  sourceResource,
  textLiteral,
} from './model-source';
import type { Binding, ModelField, ParsedModel } from './model-source';
import type { CatalogResource, ResourceRef } from './resource-graph';

/** A file's names as TypeScript scopes them. */
interface Scope {
  /** A variable's initializer; nothing for a parameter, an import, or a name the file does not declare. */
  valueOf: (name: ts.Identifier) => ts.Expression | undefined;
  /** Whether a name is `model`, or one that was imported or assigned as. */
  isModel: (name: ts.Identifier) => boolean;
  /** Whether a name comes from a package that is not named for Mongoose. */
  isForeign: (name: ts.Identifier) => boolean;
}

/** `mongoose.model`, bound or not. */
function takesModel(value: ts.Expression | undefined): boolean {
  if (value && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    const { name, expression } = value.expression;

    return name.text === 'bind' && takesModel(expression);
  }

  return value !== undefined && ts.isPropertyAccessExpression(value) && value.name.text === 'model';
}

type DeclarationOf = (name: ts.Identifier) => ts.Declaration | undefined;

function declaresModel(name: ts.Identifier, declaration: ts.Declaration | undefined): boolean {
  // `import { model as registerModel }` and `const { model: registerModel } = mongoose`.
  if (declaration && (ts.isImportSpecifier(declaration) || ts.isBindingElement(declaration))) {
    return (declaration.propertyName ?? declaration.name).getText() === 'model';
  }

  return (
    name.text === 'model' ||
    (declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      takesModel(declaration.initializer))
  );
}

/** A package not named for Mongoose. A file of the repository's own may pass Mongoose on. */
const isOtherPackage = (module: string | undefined) =>
  module !== undefined && !module.includes('mongoose') && !/^([./~#]|@\/)/.test(module);

/** What an expression starts from: `mongoose` in `mongoose.model.bind(mongoose)`, a `require`'s module. */
function rootOf(value: ts.Expression): ts.Expression {
  if (ts.isPropertyAccessExpression(value)) {
    return rootOf(value.expression);
  }

  if (!ts.isCallExpression(value)) {
    return value;
  }

  const [module] = value.arguments;

  return module && ts.isIdentifier(value.expression) && value.expression.text === 'require'
    ? module
    : rootOf(value.expression);
}

/** What a variable, or a name taken out of one, is given; nothing for a parameter. */
function givenTo(declaration: ts.Declaration): ts.Expression | undefined {
  const holder = ts.findAncestor(
    declaration,
    (node) => ts.isVariableDeclaration(node) || ts.isFunctionLike(node),
  );

  return holder && ts.isVariableDeclaration(holder) ? holder.initializer : undefined;
}

/** Whether a name comes from a package other than Mongoose, by import, `require` or a property of one. */
function isForeign(
  declaration: ts.Declaration | undefined,
  declarationOf: DeclarationOf,
  seen: ReadonlySet<ts.Declaration> = new Set(),
): boolean {
  if (!declaration || seen.has(declaration)) {
    return false;
  }

  const value = givenTo(declaration);

  if (!value) {
    const statement = ts.findAncestor(declaration, ts.isImportDeclaration);

    return isOtherPackage(textLiteral(statement?.moduleSpecifier));
  }

  const root = rootOf(value);

  return ts.isIdentifier(root)
    ? isForeign(declarationOf(root), declarationOf, new Set([...seen, declaration]))
    : isOtherPackage(textLiteral(root));
}

function scopeOf(ast: ts.SourceFile): Scope {
  const checker = ts
    .createProgram(
      [ast.fileName],
      { allowJs: true, noLib: true, noResolve: true, types: [] },
      {
        getSourceFile: (file) => (file === ast.fileName ? ast : undefined),
        getDefaultLibFileName: () => '',
        getCurrentDirectory: () => '',
        getCanonicalFileName: (file) => file,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (file) => file === ast.fileName,
        readFile: () => undefined,
        writeFile: () => undefined,
      },
    )
    .getTypeChecker();

  const declarationOf: DeclarationOf = (name) =>
    checker.getSymbolAtLocation(name)?.declarations?.[0];

  return {
    valueOf: (name) => {
      const declaration = checker.getSymbolAtLocation(name)?.valueDeclaration;

      return declaration && ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined;
    },
    isModel: (name) => declaresModel(name, declarationOf(name)),
    isForeign: (name) => isForeign(declarationOf(name), declarationOf),
  };
}

/** A schema being read: the names it uses, what could not be read, and the values open around it. */
interface Reading {
  valueOf: Scope['valueOf'];
  skipped: Array<string>;
  open: ReadonlySet<ts.Expression>;
}

/** The value of a name, read inside itself only once. */
function named(node: ts.Expression, { valueOf, open }: Reading): ts.Expression | undefined {
  const value = ts.isIdentifier(node) ? valueOf(node) : undefined;

  return value && !open.has(value) ? value : undefined;
}

const within = (reading: Reading, value: ts.Expression): Reading => ({
  ...reading,
  open: new Set([...reading.open, value]),
});

const isSchema = (node: ts.Expression): node is ts.NewExpression =>
  ts.isNewExpression(node) && node.expression.getText().endsWith('Schema');

const MONGOOSE_TYPES = new Map(
  Object.entries<JsonObject>({
    String: { type: 'string' },
    Number: { type: 'number' },
    Boolean: { type: 'boolean' },
    Date: { type: 'string', format: 'date-time' },
    Buffer: { type: 'string', contentEncoding: 'base64' },
    Object: { type: 'object' },
  }),
);

const OBJECT_ID: JsonObject = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };

function mongooseType(type: ts.Expression, skipped: Array<string>): JsonObject {
  const name = type.getText();
  const schema = MONGOOSE_TYPES.get(name) ?? (name.endsWith('ObjectId') ? OBJECT_ID : undefined);

  if (!schema) {
    skipped.push(`Unsupported Mongoose type ${name}; retained as unconstrained`);
  }

  return { ...schema };
}

/** What a field's options say about its values. */
function mongooseConstraints(options: Map<string, ts.Expression>): JsonObject {
  const constraints: JsonObject = {};
  const values = literal(options.get('enum'));

  if (Array.isArray(values)) {
    constraints.enum = values;
  }

  for (const [input, output] of [
    ['min', 'minimum'],
    ['max', 'maximum'],
    ['minlength', 'minLength'],
    ['maxlength', 'maxLength'],
  ] as const) {
    const value = literal(options.get(input));

    if (value !== undefined) {
      constraints[output] = value;
    }
  }

  return constraints;
}

function mongooseField(node: ts.Expression, reading: Reading): JsonObject {
  const value = named(node, reading);

  if (value) {
    return mongooseField(value, within(reading, value));
  }

  if (isSchema(node) && node.arguments?.[0]) {
    return mongooseObject(node.arguments[0], reading);
  }

  if (ts.isArrayLiteralExpression(node)) {
    const [item] = node.elements;

    return { type: 'array', items: item ? mongooseField(item, reading) : {} };
  }

  const options = objectFields(node);
  const type = options.get('type');

  if (ts.isObjectLiteralExpression(node) && !type) {
    return mongooseObject(node, reading);
  }

  return {
    ...(type ? mongooseField(type, reading) : mongooseType(node, reading.skipped)),
    ...mongooseConstraints(options),
  };
}

function mongooseObject(node: ts.Expression, reading: Reading): JsonObject {
  const properties: JsonObject = {};
  const required: Array<string> = [];

  if (!ts.isObjectLiteralExpression(node)) {
    reading.skipped.push(`Dynamic Mongoose schema ${node.getText()} requires an exported schema`);

    return {};
  }

  for (const [name, value] of objectFields(node)) {
    properties[name] = mongooseField(value, reading);

    if (literal(objectFields(value).get('required')) === true) {
      required.push(name);
    }
  }

  return { type: 'object', properties, ...(required.length > 0 && { required }) };
}

/**
 * A Mongoose schema's fields as its page lists them: each one's type as
 * written, the options that constrain it, and the model a `ref` points at.
 */
function mongooseFields(node: ts.Expression | undefined, reading: Reading): Array<ModelField> {
  return node && ts.isObjectLiteralExpression(node)
    ? [...objectFields(node)].map(([name, value]) => mongooseFieldDetail(name, value, reading))
    : [];
}

function mongooseList(
  name: string,
  [item]: ReadonlyArray<ts.Expression>,
  reading: Reading,
): ModelField {
  const inner = item ? mongooseFieldDetail(name, item, reading) : { name, type: 'Mixed' };

  return {
    ...inner,
    list: true,
    ...('relation' in inner && inner.relation && { relation: { ...inner.relation, many: true } }),
  };
}

function mongooseFieldDetail(name: string, node: ts.Expression, reading: Reading): ModelField {
  const value = named(node, reading);

  if (value) {
    return mongooseFieldDetail(name, value, within(reading, value));
  }

  if (ts.isArrayLiteralExpression(node)) {
    return mongooseList(name, node.elements, reading);
  }

  if (isSchema(node)) {
    return { name, type: 'Object', fields: mongooseFields(node.arguments?.[0], reading) };
  }

  return ts.isObjectLiteralExpression(node) && !objectFields(node).has('type')
    ? { name, type: 'Object', fields: mongooseFields(node, reading) }
    : mongooseTyped(name, node, reading);
}

/** A field given as a type, or as options that name one. */
function mongooseTyped(name: string, node: ts.Expression, reading: Reading): ModelField {
  const options = objectFields(node);
  const type = options.get('type');

  const described =
    type && (ts.isArrayLiteralExpression(type) || ts.isNewExpression(type))
      ? mongooseFieldDetail(name, type, reading)
      : { name, type: (type ?? node).getText().replace(/^.*\./, '') };

  return { ...described, ...mongooseOptions(name, options) };
}

function mongooseOptions(name: string, options: Map<string, ts.Expression>) {
  const values = literal(options.get('enum'));
  const ref = textLiteral(options.get('ref'));
  const fallback = options.get('default');

  return {
    ...(literal(options.get('required')) !== true && { optional: true }),
    ...(literal(options.get('unique')) === true && { unique: true }),
    ...(fallback && { default: fallback.getText() }),
    ...(Array.isArray(values) && { enum: values.map(String) }),
    ...(filled(ref) && { relation: { model: ref, many: false, fields: [name] } }),
  } satisfies Partial<ModelField>;
}

const enclosingFunction = (node: ts.Node) => ts.findAncestor(node.parent, ts.isFunctionLike);

/** The property of a value's own object literal that a call is in: `Track` in `{ Track: model(...) }`. */
function memberOf(call: ts.Node, value: ts.Expression | undefined): string | undefined {
  let object = value;

  while (
    object &&
    (ts.isAsExpression(object) ||
      ts.isSatisfiesExpression(object) ||
      ts.isParenthesizedExpression(object))
  ) {
    object = object.expression;
  }

  const property = object && ts.findAncestor(call, (node) => node.parent === object);

  return property && ts.isPropertyAssignment(property) ? propertyName(property.name) : undefined;
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

  if (MONGOOSE_UNCOUNTABLE.has(name)) {
    return name;
  }

  const rule = MONGOOSE_PLURALS.find(([pattern]) => name.match(pattern));

  return rule ? name.replace(rule[0], rule[1]) : name;
}

/** The value a model belongs to, and its name. */
interface ModelOwner {
  local: string;
  value: ts.Expression;
}

interface ModelCall {
  call: ts.CallExpression;
  schema: ts.Expression;
  /** Its `model` comes from a package that is not named for Mongoose. */
  foreign: boolean;
}

/** A call that registers a model: `model(name, schema)`, `connection.model(name, schema)`. */
function modelCall(node: ts.Node, scope: Scope): ModelCall | undefined {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }

  const { expression } = node;
  const schema = node.arguments[1];

  const registers = ts.isPropertyAccessExpression(expression)
    ? expression.name.text === 'model'
    : ts.isIdentifier(expression) && scope.isModel(expression);

  if (!schema || !registers) {
    return undefined;
  }

  const foreign = ts.isIdentifier(expression) && scope.isForeign(expression);

  // Another package's `model` is worth a word only when it is given a schema.
  return foreign && !schemaOf(schema, scope) ? undefined : { call: node, schema, foreign };
}

/** Each model call in a file, and the value it belongs to. */
function mongooseModelCalls(ast: ts.SourceFile, values: Map<string, ts.Expression>, scope: Scope) {
  const calls: Array<ModelCall> = [];

  const visit = (node: ts.Node) => {
    const found = modelCall(node, scope);

    if (found) {
      calls.push(found);
    }

    ts.forEachChild(node, visit);
  };

  visit(ast);

  // Only where no function stands between the call and the value.
  const owners = new Map<ts.CallExpression, ModelOwner>();

  for (const [local, value] of values) {
    for (const { call } of calls) {
      const inside = call.pos >= value.pos && call.end <= value.end;

      if (inside && enclosingFunction(call) === enclosingFunction(value)) {
        owners.set(call, { local, value });
      }
    }
  }

  return { calls, owners };
}

/** A schema's fields and options, from the `new Schema(...)` written there or by a name in scope. */
function schemaOf(
  schema: ts.Expression,
  { valueOf }: Scope,
): { fields: ts.Expression; options: ts.Expression | undefined } | undefined {
  const value = ts.isIdentifier(schema) ? valueOf(schema) : schema;
  const [fields, options] = value && ts.isNewExpression(value) ? (value.arguments ?? []) : [];

  return fields && { fields, options };
}

/** The name a model's source gives: its variable's, unless that is an export without one. */
const symbolOf = (local: string | undefined, model: string) =>
  local !== undefined && /^\w+$/.test(local) ? local : model;

/** Bind a model to its name, or to its property of the object that name holds. */
function bindModel(
  locals: Map<string, Binding>,
  { local, member }: { local: string; member: string | undefined },
  binding: Binding,
) {
  const held = locals.get(local);

  // Of several models in one value that is not an object of them, the first.
  if (member === undefined) {
    locals.set(local, held ?? binding);

    return;
  }

  const members = held?.kind === 'models' ? held.members : new Map<string, Binding>();

  locals.set(local, { kind: 'models', members: members.set(member, binding) });
}

const DYNAMIC_SCHEMA = 'has a dynamic schema; export it with exportMongooseModels';

const SCHEMA_ELSEWHERE =
  'is built inside a function with a schema this file does not declare; export it with exportMongooseModels';

export interface MongooseModels {
  resources: Array<CatalogResource>;
  /** The names in the file that refer to a model. */
  locals: Map<string, Binding>;
  models: Array<ParsedModel & { model: string }>;
}

interface MongooseFile {
  ast: ts.SourceFile;
  relative: string;
  namespace: string;
  skipped: Array<string>;
}

const foreignCall = ({ call }: ModelCall) => ({
  problem: `${textLiteral(call.arguments[0]) ?? 'a model'} is registered by another package; export it with exportMongooseModels`,
});

/** What a model call says, or why it cannot be read. */
function readCall({ call, schema }: ModelCall, scope: Scope, owner: ModelOwner | undefined) {
  const model = textLiteral(call.arguments[0]);

  if (model === undefined) {
    return { problem: "a model's name is computed; export it with exportMongooseModels" };
  }

  const member = memberOf(call, owner?.value);
  const symbol = member ?? symbolOf(owner?.local, model);
  const definition = schemaOf(schema, scope);

  if (!definition) {
    const why = enclosingFunction(call) ? SCHEMA_ELSEWHERE : DYNAMIC_SCHEMA;

    return { problem: `${symbol} ${why}` };
  }

  const collection =
    textLiteral(call.arguments[2]) ??
    textLiteral(objectFields(definition.options).get('collection'));

  // Without a declared collection the name is Mongoose's default pluralisation,
  // which an application can replace; the name and every edge to it stay reviewable.
  return {
    model,
    member,
    symbol,
    fields: definition.fields,
    id: collection ?? mongooseCollectionName(model),
    inferred: !filled(collection),
  };
}

/** Every model a file declares with Mongoose, and the names that refer to them. */
export function mongooseModels(
  values: Map<string, ts.Expression>,
  { ast, relative, namespace, skipped }: MongooseFile,
): MongooseModels {
  const resources: Array<CatalogResource> = [];
  const locals = new Map<string, Binding>();
  const models: Array<ParsedModel & { model: string }> = [];

  const scope = scopeOf(ast);
  const { calls, owners } = mongooseModelCalls(ast, values, scope);

  for (const found of calls) {
    const line = ast.getLineAndCharacterOfPosition(found.call.getStart()).line + 1;
    const owner = owners.get(found.call);
    const read = found.foreign ? foreignCall(found) : readCall(found, scope, owner);

    if (read.problem !== undefined) {
      skipped.push(`${relative}:${line}: ${read.problem}`);
      continue;
    }

    const { model, member, symbol, fields, id, inferred } = read;
    const ref: ResourceRef<'collection'> = { kind: 'collection', namespace, id };

    if (owner) {
      bindModel(locals, { local: owner.local, member }, { kind: 'model', ref, inferred });
    }

    const unread: Array<string> = [];
    const reading: Reading = { valueOf: scope.valueOf, skipped: unread, open: new Set() };

    const resource = sourceResource(
      ref,
      { adapter: 'mongoose', schema: mongooseObject(fields, reading) },
      { file: relative, symbol, line },
    );

    skipped.push(...unread.map((problem) => `${relative}:${line}: ${problem}`));

    models.push({
      model,
      resource,
      ref,
      fields: mongooseFields(fields, reading),
      file: relative,
      line,
    });

    if (inferred) {
      resource.provenance.fields.id = 'inferred';
      resource.needsReview = true;
      skipped.push(
        `${relative}: ${symbol} collection name inferred; declare collection for custom pluralization`,
      );
    }

    resources.push(resource);
  }

  return { resources, locals, models };
}
