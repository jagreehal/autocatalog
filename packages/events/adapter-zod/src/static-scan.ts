/**
 * Static Zod extraction: it reads source and never executes it. It needs no
 * installed `node_modules`, works across Zod majors, reads past `.transform()`,
 * and never runs another repository's module side effects.
 */
import {
  isJsonObject,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from 'autocatalog-core';
import ts from 'typescript';
import { z } from 'zod';

/** `required` as this resolver writes it; anything else reads as none. */
const requiredList = z.array(z.string()).catch([]);

function propertiesOf(schema: JsonObject): JsonObject {
  return isJsonObject(schema.properties) ? schema.properties : {};
}

function requiredOf(schema: JsonObject): string[] {
  return requiredList.parse(schema.required);
}

/** A schema we could not fully represent, and why. */
export interface StaticLimit {
  symbol: string;
  reason: string;
}

export interface StaticSchema {
  /** JSON Schema, as far as we could resolve it. */
  schema: JsonObject;
  /** Set when something in the chain could not be represented. */
  limits: StaticLimit[];
}

export interface StaticExport {
  symbol: string;
  line: number;
  /** Present when the export is a plain schema. */
  schema?: StaticSchema;
  /** Present when the export is z.discriminatedUnion / z.union of named members. */
  unionMembers?: string[];
  /** Present when the export is defineEvent(meta, schema). */
  defineEventMeta?: JsonObject;
  /**
   * Present when the export is an array of object literals: a registry of
   * events written out by hand, each `schema` resolved to JSON Schema.
   */
  registryItems?: RegistryItem[];
}

/** One record of a hand-written registry, with its `schema` resolved. */
export interface RegistryItem {
  item: JsonObject;
  limits: StaticLimit[];
}

/** Unrepresentable in JSON Schema — we keep what we have and flag it. */
const OPAQUE = new Set(['transform', 'refine', 'superRefine', 'catch', 'brand', 'pipe']);

/**
 * Chainable modifiers with nothing to say in JSON Schema: annotations,
 * normalisers, and checks JSON Schema has no keyword for.
 */
const TRANSPARENT = new Set([
  'describe',
  'meta',
  'readonly',
  'lazy',
  'finite',
  'trim',
  'toLowerCase',
  'toUpperCase',
  'ip',
  'cidr',
]);

/** String formats, as Zod's own toJSONSchema names them. */
const FORMATS = new Map([
  ['email', 'email'],
  ['uuid', 'uuid'],
  ['guid', 'uuid'],
  ['url', 'uri'],
  ['datetime', 'date-time'],
  ['date', 'date'],
  ['time', 'time'],
  ['duration', 'duration'],
  ['ipv4', 'ipv4'],
  ['ipv6', 'ipv6'],
  ['emoji', 'emoji'],
  ['nanoid', 'nanoid'],
  ['cuid', 'cuid'],
  ['cuid2', 'cuid2'],
  ['ulid', 'ulid'],
  ['base64', 'base64'],
]);

/** Numeric checks and the bound each one sets; the number is the argument unless given. */
const NUMBER_BOUNDS = new Map([
  ['min', { keyword: 'minimum' }],
  ['gte', { keyword: 'minimum' }],
  ['gt', { keyword: 'exclusiveMinimum' }],
  ['max', { keyword: 'maximum' }],
  ['lte', { keyword: 'maximum' }],
  ['lt', { keyword: 'exclusiveMaximum' }],
  ['positive', { keyword: 'exclusiveMinimum', value: 0 }],
  ['nonnegative', { keyword: 'minimum', value: 0 }],
  ['negative', { keyword: 'exclusiveMaximum', value: 0 }],
  ['nonpositive', { keyword: 'maximum', value: 0 }],
  ['multipleOf', { keyword: 'multipleOf' }],
  ['step', { keyword: 'multipleOf' }],
]);

/** Length checks, by the type they apply to. */
const LENGTH_BOUNDS = new Map([
  [
    'string',
    new Map([
      ['min', ['minLength']],
      ['max', ['maxLength']],
      ['length', ['minLength', 'maxLength']],
    ]),
  ],
  [
    'array',
    new Map([
      ['min', ['minItems']],
      ['max', ['maxItems']],
      ['length', ['minItems', 'maxItems']],
    ]),
  ],
]);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An integer, bounded to the safe range where nothing tighter is declared, as Zod does. */
function safeInteger(schema: JsonObject): JsonObject {
  return {
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
    ...schema,
    type: 'integer',
  };
}

/** The `type` a resolved schema declares, or '' when it declares one of several or none. */
const typeName = z.string().catch('');

const literalString = z.string();

/** Substring checks, as the pattern each one implies. */
const SUBSTRING_PATTERNS = new Map([
  ['startsWith', (text: string) => `^${escapeRegExp(text)}`],
  ['endsWith', (text: string) => `${escapeRegExp(text)}$`],
  ['includes', (text: string) => escapeRegExp(text)],
]);

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** `5`, `-5`, `- -5` → the number. */
function numberValue(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = numberValue(node.operand);

    return inner === undefined ? undefined : -inner;
  }

  return undefined;
}

function literalValue(node: ts.Expression): JsonPrimitive | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  const number = numberValue(node);

  if (number !== undefined) return number;

  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;

  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;

  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  return undefined;
}

/** Read a literal expression into a plain JS value. Returns undefined if not literal. */
function literalTree(node: ts.Expression): JsonValue | undefined {
  const simple = literalValue(node);

  if (simple !== undefined) return simple;

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(literalTree).filter((v) => v !== undefined);
  }

  if (ts.isObjectLiteralExpression(node)) return objectLiteralTree(node);

  return undefined;
}

function objectLiteralTree(node: ts.ObjectLiteralExpression): JsonObject {
  const out: JsonObject = {};

  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;

    if (!key) continue;
    const value = literalTree(prop.initializer);

    if (value !== undefined) out[key] = value;
  }

  return out;
}

/**
 * Walk a call chain back to its root, collecting method names outermost-last.
 *
 * Stops at `z.object(...)` rather than unwinding to the bare `z`: a namespace is
 * not a schema. `isLocal` tells us whether an identifier is a const in this file
 * (so `Base.extend(...)` keeps unwinding to `Base`) or an import/namespace
 * (so `z.object(...)` is the root).
 */
function unwindChain(expr: ts.Expression, isLocal: (name: string) => boolean) {
  const calls: ts.CallExpression[] = [];
  let current: ts.Expression = expr;

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const base = current.expression.expression;

    // `z.object({...})` / `v.string()` — the call itself is the root factory.
    if (ts.isIdentifier(base) && !isLocal(base.text)) break;
    calls.unshift(current);
    current = base;
  }

  return { root: current, calls };
}

function methodName(call: ts.CallExpression): string {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : '';
}

/** `z.object({...})` → the object literal argument, if this is a z.<fn>(...) call. */
function zodFactory(expr: ts.Expression): { fn: string; args: ts.NodeArray<ts.Expression> } | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;

  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    // z.object(...) — accept any single-identifier namespace so `import * as v from 'zod'` works.
    return { fn: callee.name.text, args: expr.arguments };
  }

  return null;
}

class Resolver {
  private readonly consts = new Map<string, ts.Expression>();
  private readonly resolving = new Set<string>();
  /** "EventType.RUN_STARTED" -> "RUN_STARTED" for local enums. */
  private readonly enumMembers = new Map<string, JsonPrimitive>();

  constructor(private readonly sf: ts.SourceFile) {
    sf.forEachChild((node) => {
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            this.consts.set(decl.name.text, decl.initializer);
          }
        }

        return;
      }

      // Enum members are how real codebases spell their discriminators.
      if (ts.isEnumDeclaration(node)) {
        for (const member of node.members) {
          const name = ts.isIdentifier(member.name) ? member.name.text : null;

          if (!name) continue;
          const value = member.initializer ? literalValue(member.initializer) : name;
          this.enumMembers.set(`${node.name.text}.${name}`, value ?? name);
        }
      }
    });
  }

  /** Literal value, following local enum member references. */
  private literal(node: ts.Expression): JsonPrimitive | undefined {
    const direct = literalValue(node);

    if (direct !== undefined) return direct;

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      return this.enumMembers.get(`${node.expression.text}.${node.name.text}`);
    }

    return undefined;
  }

  byName(name: string): ts.Expression | undefined {
    return this.consts.get(name);
  }

  /**
   * One item of a hand-written registry: its literal fields, and its `schema`
   * as JSON Schema, whether written as JSON Schema or as Zod.
   */
  registryItem(literal: ts.ObjectLiteralExpression, symbol: string): RegistryItem {
    const limits: StaticLimit[] = [];
    const item = objectLiteralTree(literal);

    const schemaProp = literal.properties
      .filter(ts.isPropertyAssignment)
      .find((prop) => ts.isIdentifier(prop.name) && prop.name.text === 'schema');

    if (schemaProp) {
      let expr = schemaProp.initializer;

      // A schema kept in its own const, followed as far as it goes.
      for (let hops = 0; ts.isIdentifier(expr) && this.consts.has(expr.text) && hops < 16; hops++) {
        const next = this.consts.get(expr.text)!;

        if (!ts.isObjectLiteralExpression(next)) break;
        expr = next;
      }

      item.schema = ts.isObjectLiteralExpression(expr)
        ? objectLiteralTree(expr)
        : this.resolve(expr, limits, symbol);
    }

    return { item, limits };
  }

  /** Resolve an expression to JSON Schema, following .extend()/.omit()/.pick() chains. */
  resolve(expr: ts.Expression, limits: StaticLimit[], symbol: string): JsonObject {
    const { root, calls } = unwindChain(expr, (n) => this.consts.has(n));

    let schema: JsonObject;

    if (ts.isIdentifier(root) && !this.consts.has(root.text)) {
      // A bare identifier we cannot see — most likely an import from another module.
      limits.push({ symbol, reason: `unresolved reference '${root.text}' (likely imported)` });
      schema = {};
    } else if (ts.isIdentifier(root)) {
      if (this.resolving.has(root.text)) {
        limits.push({ symbol, reason: `circular reference via '${root.text}'` });

        return {};
      }

      this.resolving.add(root.text);
      schema = this.resolve(this.consts.get(root.text)!, limits, symbol);
      this.resolving.delete(root.text);
    } else {
      schema = this.fromFactory(root, limits, symbol);
    }

    for (const call of calls) {
      schema = this.applyMethod(schema, call, limits, symbol);
    }

    return schema;
  }

  private fromFactory(expr: ts.Expression, limits: StaticLimit[], symbol: string): JsonObject {
    const factory = zodFactory(expr);

    if (!factory) {
      limits.push({ symbol, reason: 'schema root is not a recognisable z.* call' });

      return {};
    }

    const { fn, args } = factory;

    switch (fn) {
      case 'object':
      case 'looseObject':
      case 'strictObject': {
        const literal = args[0];

        if (!literal || !ts.isObjectLiteralExpression(literal)) return { type: 'object' };

        return this.objectFromLiteral(literal, limits, symbol);
      }

      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'int':
        return safeInteger({ type: 'number' });
      case 'bigint':
        return { type: 'integer' };
      case 'boolean':
        return { type: 'boolean' };
      case 'date':
        return { type: 'string', format: 'date-time' };
      case 'literal': {
        const v = args[0] ? this.literal(args[0]) : undefined;

        return v === undefined ? {} : { const: v };
      }

      case 'enum': {
        const arr = args[0];

        if (arr && ts.isArrayLiteralExpression(arr)) {
          const values = arr.elements.map(literalValue).filter((v) => v !== undefined);

          return { type: 'string', enum: values };
        }

        return { type: 'string' };
      }

      case 'array': {
        const inner = args[0] ? this.resolve(args[0], limits, symbol) : {};

        return { type: 'array', items: inner };
      }

      case 'record': {
        const value = args[1] ?? args[0];

        return {
          type: 'object',
          additionalProperties: value ? this.resolve(value, limits, symbol) : true,
        };
      }

      case 'union':
      case 'discriminatedUnion': {
        const arr = fn === 'union' ? args[0] : args[1];

        if (arr && ts.isArrayLiteralExpression(arr)) {
          return { anyOf: arr.elements.map((e) => this.resolve(e, limits, symbol)) };
        }

        return {};
      }

      case 'any':
      case 'unknown':
        return {};
      case 'null':
        return { type: 'null' };
      case 'custom':
        limits.push({ symbol, reason: 'z.custom() has no JSON Schema representation' });

        return {};
      default: {
        // z.email(), z.uuid() and the other top-level string formats.
        const format = FORMATS.get(fn);

        if (format) return { type: 'string', format };
        limits.push({ symbol, reason: `unsupported z.${fn}()` });

        return {};
      }
    }
  }

  /**
   * A validator as the JSON Schema keyword it implies, or undefined when
   * `name` is not one. A bound that is not a literal is flagged, not guessed.
   */
  private constraint(
    schema: JsonObject,
    name: string,
    call: ts.CallExpression,
    limits: StaticLimit[],
    symbol: string,
  ): JsonObject | undefined {
    const [arg] = call.arguments;
    const declared = typeName.parse(schema.type);
    const type = declared === 'integer' ? 'number' : declared;

    const unreadable = () => {
      limits.push({ symbol, reason: `.${name}() takes a value that is not a literal` });

      return schema;
    };

    const bound = type === 'number' ? NUMBER_BOUNDS.get(name) : undefined;

    if (bound) {
      const value = 'value' in bound ? bound.value : arg && numberValue(arg);

      return value === undefined ? unreadable() : { ...schema, [bound.keyword]: value };
    }

    if (type === 'number' && name === 'safe') return safeInteger(schema);

    const lengths = LENGTH_BOUNDS.get(type)?.get(name);

    if (lengths) {
      const value = arg && numberValue(arg);

      if (value === undefined) return unreadable();

      return { ...schema, ...Object.fromEntries(lengths.map((keyword) => [keyword, value])) };
    }

    if (type !== 'string') return undefined;

    const format = FORMATS.get(name);

    if (format) return { ...schema, format };

    if (name === 'regex') {
      if (!arg || !ts.isRegularExpressionLiteral(arg)) return unreadable();

      return { ...schema, pattern: arg.text.slice(1, arg.text.lastIndexOf('/')) };
    }

    const substring = SUBSTRING_PATTERNS.get(name);

    if (substring) {
      const text = literalString.safeParse(arg && literalValue(arg));

      return text.success ? { ...schema, pattern: substring(text.data) } : unreadable();
    }

    return undefined;
  }

  private objectFromLiteral(
    literal: ts.ObjectLiteralExpression,
    limits: StaticLimit[],
    symbol: string,
  ): JsonObject {
    const properties: Record<string, JsonObject> = {};
    const required: string[] = [];

    for (const prop of literal.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;

      const key = ts.isIdentifier(prop.name)
        ? prop.name.text
        : ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;

      if (!key) continue;

      const optional = this.isOptional(prop.initializer);
      properties[key] = this.resolve(prop.initializer, limits, symbol);

      if (!optional) required.push(key);
    }

    return required.length
      ? { type: 'object', properties, required }
      : { type: 'object', properties };
  }

  private isOptional(expr: ts.Expression): boolean {
    const { calls } = unwindChain(expr, (n) => this.consts.has(n));

    return calls.some((c) => ['optional', 'nullish', 'default'].includes(methodName(c)));
  }

  private applyMethod(
    schema: JsonObject,
    call: ts.CallExpression,
    limits: StaticLimit[],
    symbol: string,
  ): JsonObject {
    const name = methodName(call);

    if (TRANSPARENT.has(name)) return schema;

    const constrained = this.constraint(schema, name, call, limits, symbol);

    if (constrained) return constrained;

    if (OPAQUE.has(name)) {
      limits.push({ symbol, reason: `.${name}() cannot be represented in JSON Schema` });

      return schema;
    }

    switch (name) {
      case 'extend': {
        const arg = call.arguments[0];

        if (!arg || !ts.isObjectLiteralExpression(arg)) return schema;
        const added = this.objectFromLiteral(arg, limits, symbol);

        return {
          ...schema,
          type: 'object',
          properties: {
            ...propertiesOf(schema),
            ...propertiesOf(added),
          },
          required: [...new Set([...requiredOf(schema), ...requiredOf(added)])],
        };
      }

      case 'omit':
      case 'pick': {
        const arg = call.arguments[0];

        if (!arg || !ts.isObjectLiteralExpression(arg)) return schema;

        const keys = new Set(
          arg.properties
            .filter(ts.isPropertyAssignment)
            .map((p) =>
              ts.isIdentifier(p.name) ? p.name.text : ts.isStringLiteral(p.name) ? p.name.text : '',
            )
            .filter(Boolean),
        );

        const props = { ...propertiesOf(schema) };
        const req = requiredOf(schema);

        for (const key of Object.keys(props)) {
          const keep = name === 'pick' ? keys.has(key) : !keys.has(key);

          if (!keep) delete props[key];
        }

        return {
          ...schema,
          properties: props,
          required: req.filter((k) => k in props),
        };
      }

      case 'int':
        return safeInteger(schema);
      case 'partial':
        return { ...schema, required: [] };
      case 'optional':
      case 'nullish':
      case 'default':
      case 'nullable':
        return schema;
      case 'merge': {
        const arg = call.arguments[0];

        if (!arg) return schema;
        const other = this.resolve(arg, limits, symbol);

        return {
          ...schema,
          properties: {
            ...propertiesOf(schema),
            ...propertiesOf(other),
          },
          required: [...new Set([...requiredOf(schema), ...requiredOf(other)])],
        };
      }

      default:
        limits.push({ symbol, reason: `unsupported .${name}()` });

        return schema;
    }
  }
}

/** True when the file imports zod under any alias. */
export function importsZod(text: string): boolean {
  return /from\s+['"]zod(\/v\d)?['"]/.test(text);
}

/**
 * Syntax errors for an already-parsed file, via the public Program API. A
 * single-file program with no lib and no resolution does no further parsing.
 */
function syntaxErrors(sf: ts.SourceFile): readonly ts.Diagnostic[] {
  const host: ts.CompilerHost = { ...ts.createCompilerHost({}), getSourceFile: () => sf };

  return ts
    .createProgram([sf.fileName], { noLib: true, noResolve: true, types: [] }, host)
    .getSyntacticDiagnostics(sf);
}

/**
 * Parse one TypeScript source file and return its exported Zod schemas.
 * Never executes anything.
 */
export function staticExports(text: string, fileName: string): StaticExport[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

  // ts.createSourceFile is error-tolerant: it happily parses broken source and
  // returns a partial tree. Left unchecked, a malformed file yields zero events
  // and looks identical to a file with no events — the exact silent failure the
  // runtime path used to have.
  const parseErrors = syntaxErrors(sf);

  if (parseErrors.length > 0) {
    const first = parseErrors[0]!;
    const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    throw new Error(
      `parse error: ${message}${parseErrors.length > 1 ? ` (+${parseErrors.length - 1} more)` : ''}`,
    );
  }

  const resolver = new Resolver(sf);
  const out: StaticExport[] = [];

  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

    if (!exported) return;

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const symbol = decl.name.text;
      const line = lineOf(sf, decl);

      // A schema is never a function. ag-ui's event-factories.ts exports 35 arrow
      // functions named *Event; without this they resolve to empty schemas and
      // double the catalog with things that are not events.
      if (
        ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer) ||
        ts.isClassExpression(decl.initializer)
      ) {
        continue;
      }

      // defineEvent(meta, schema)
      if (
        ts.isCallExpression(decl.initializer) &&
        ts.isIdentifier(decl.initializer.expression) &&
        decl.initializer.expression.text === 'defineEvent'
      ) {
        const [metaArg, schemaArg] = decl.initializer.arguments;

        const meta =
          metaArg && ts.isObjectLiteralExpression(metaArg) ? objectLiteralTree(metaArg) : {};

        const limits: StaticLimit[] = [];
        out.push({
          symbol,
          line,
          defineEventMeta: meta,
          schema: schemaArg
            ? { schema: resolver.resolve(schemaArg, limits, symbol), limits }
            : undefined,
        });
        continue;
      }

      // [{ id, version, schema, ... }, ...] — a registry written out by hand.
      if (ts.isArrayLiteralExpression(decl.initializer)) {
        const items = decl.initializer.elements
          .filter(ts.isObjectLiteralExpression)
          .map((literal) => resolver.registryItem(literal, symbol));

        if (items.length > 0) out.push({ symbol, line, registryItems: items });
        continue;
      }

      // z.discriminatedUnion('type', [A, B, ...]) — a registry of named members
      const factory = zodFactory(decl.initializer);

      if (factory && (factory.fn === 'discriminatedUnion' || factory.fn === 'union')) {
        const arr = factory.fn === 'union' ? factory.args[0] : factory.args[1];

        if (arr && ts.isArrayLiteralExpression(arr)) {
          const members = arr.elements.filter(ts.isIdentifier).map((e) => e.text);

          if (members.length) {
            out.push({ symbol, line, unionMembers: members });
            continue;
          }
        }
      }

      // A plain schema export.
      const limits: StaticLimit[] = [];
      const schema = resolver.resolve(decl.initializer, limits, symbol);

      if (Object.keys(schema).length > 0 || limits.length > 0) {
        out.push({ symbol, line, schema: { schema, limits } });
      }
    }
  });

  return out;
}
