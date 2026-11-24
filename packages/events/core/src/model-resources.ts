import path from 'node:path';
import { z } from 'zod';
import ts from 'typescript';
import {
  architectureService,
  emptyResourceGraph,
  mergeArchitectureGraphs,
  databaseAccess,
} from './architecture';
import {
  packageName,
  readOptionalResourceJson,
  readResourceSource,
  ResourceReadError,
  resourceFiles,
} from './resource-files';
import type { ResourceScanOptions } from './resource-files';
import { mongooseModels } from './model-mongoose';
import { drizzleAccess, drizzleResources } from './model-drizzle';
import { PRISMA_READS, PRISMA_WRITES, prismaResources, prismaSelection } from './model-prisma';
import type { PrismaModel } from './model-prisma';
import {
  describeModel,
  literal,
  modelReferences,
  propertyName,
  sourceResource,
  staticObject,
  textLiteral,
} from './model-source';
import type { Binding, ModelField, ParsedModel } from './model-source';
import { jsonObjectSchema } from './json';
import type { JsonObject } from './json';
import { resourceKey, isArchitectureCatalogResource } from './resource-graph';
import type { ResourceGraph, ResourceRef } from './resource-graph';

export { mongooseCollectionName } from './model-mongoose';

export type { ModelField, ModelIndex, ModelRelation } from './model-source';

export interface ModelScanOptions extends ResourceScanOptions {
  datastore?: string;
  database?: string;
  service?: string;
}

export interface ResourceDiscoveryResult {
  graph: ResourceGraph;
  errors: Array<string>;
  skipped: Array<string>;
}

export const modelExports = z.array(
  z.object({
    kind: z.enum(['collection', 'table']),
    id: z.string().min(1),
    datastore: z.string().min(1),
    database: z.string().min(1),
    adapter: z.enum(['mongoose', 'prisma', 'drizzle', 'odcs']),
    schema: jsonObjectSchema,
    symbol: z.string().optional(),
    /** The service that uses it; the scan's own when left out. Only read with `access`. */
    service: z.string().min(1).optional(),
    access: z.array(z.enum(['reads', 'writes'])).optional(),
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
  /** The service that uses the models; the scan's `--service` when left out. */
  service?: string;
  /** What that service does with them. Left out, the export claims no access. */
  access?: Array<'reads' | 'writes'>;
}

/** Called by an explicitly run application exporter, never by the passive scanner. */
export function exportMongooseModels(
  models: Array<MongooseModelContract>,
  options: ModelExportOptions,
): Array<ModelExport> {
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

/** Fields named by an inclusion projection; empty (every field) for anything else. */
function includedProjection(node: ts.Node | undefined): Array<string> {
  const projection = staticObject(node);

  if (
    !projection ||
    ![...projection.values()].every((value) => literal(value) === 1 || literal(value) === true)
  ) {
    return [];
  }

  return [...projection.keys()];
}

const relationRef = z.object({
  kind: z.string(),
  namespace: z.string().optional(),
  id: z.string(),
  version: z.string().optional(),
});

export const modelFields: z.ZodType<Array<ModelField>> = z.array(
  z.object({
    name: z.string(),
    column: z.string().optional(),
    type: z.string(),
    list: z.boolean().optional(),
    optional: z.boolean().optional(),
    id: z.boolean().optional(),
    unique: z.boolean().optional(),
    default: z.string().optional(),
    updatedAt: z.boolean().optional(),
    enum: z.array(z.string()).optional(),
    doc: z.string().optional(),
    relation: z
      .object({
        model: z.string(),
        to: relationRef.optional(),
        many: z.boolean(),
        name: z.string().optional(),
        fields: z.array(z.string()).optional(),
        references: z.array(z.string()).optional(),
      })
      .optional(),
    get fields() {
      return modelFields.optional();
    },
  }),
);

export const modelIndexes = z.array(
  z.object({
    fields: z.array(z.string()),
    unique: z.boolean(),
    primary: z.boolean().optional(),
    name: z.string().optional(),
  }),
);

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
  stars: Array<string>;
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
  const stars: Array<string> = [];

  const exportValue = (name: string, value: ts.Expression) => {
    if (ts.isIdentifier(value)) {
      exports.set(name, value.text);
    } else {
      const local = name === 'default' ? DEFAULT_EXPORT : `exports.${name}`;
      values.set(local, value);
      exports.set(name, local);
    }
  };

  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = textLiteral(statement.moduleSpecifier);
      const clause = statement.importClause;

      if (!module || !clause) {
        continue;
      }

      if (clause.name) {
        imports.set(clause.name.text, { module, name: 'default' });
      }

      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) {
          imports.set(item.name.text, { module, name: item.propertyName?.text ?? item.name.text });
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      const module = textLiteral(statement.moduleSpecifier);

      if (!statement.exportClause) {
        if (module) {
          stars.push(module);
        }
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) {
          const local = item.propertyName?.text ?? item.name.text;

          if (module) {
            reexports.set(item.name.text, { module, name: local });
          } else {
            exports.set(item.name.text, local);
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      exportValue('default', statement.expression);
    } else if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, declaration.name.text);
        }
      }
    } else if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const { left, right } = statement.expression;
      const target = left.getText();

      if (target === 'module.exports' && ts.isObjectLiteralExpression(right)) {
        for (const item of right.properties) {
          if (ts.isShorthandPropertyAssignment(item)) {
            exports.set(item.name.text, item.name.text);
          } else if (ts.isPropertyAssignment(item)) {
            const name = propertyName(item.name);

            if (name) {
              exportValue(name, item.initializer);
            }
          }
        }
      } else if (target === 'module.exports') {
        exportValue('default', right);
      } else if (
        ts.isPropertyAccessExpression(left) &&
        /^(module\.)?exports$/.test(left.expression.getText())
      ) {
        exportValue(left.name.text, right);
      }
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

        if (required) {
          imports.set(node.name.text, { module: required, name: 'default' });
        }
      } else if (required && ts.isObjectBindingPattern(node.name)) {
        for (const item of node.name.elements) {
          if (ts.isIdentifier(item.name)) {
            imports.set(item.name.text, {
              module: required,
              name: item.propertyName ? (propertyName(item.propertyName) ?? '') : item.name.text,
            });
          }
        }
      }
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
  if (match(node)) {
    return node;
  }

  if (ts.isFunctionLike(node)) {
    return undefined;
  }

  return ts.forEachChild(node, (child) => findWithin(child, match));
}

/** The binding a call's receiver names: `Track`, or `models.Track` in an object of models. */
function receiverBinding(
  receiver: ts.Expression,
  bindings: Map<string, Binding>,
): Binding | undefined {
  if (ts.isIdentifier(receiver)) {
    return bindings.get(receiver.text);
  }

  if (!ts.isPropertyAccessExpression(receiver) || !ts.isIdentifier(receiver.expression)) {
    return undefined;
  }

  const group = bindings.get(receiver.expression.text);

  return group?.kind === 'models' ? group.members.get(receiver.name.text) : undefined;
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

/**
 * Two definitions of one resource that disagree, typically one `model User` per
 * service of a monorepo, sharing the default datastore. Merging would have to
 * pick one, so the resource is kept for its edges but without a schema, and the
 * scan reports it rather than failing.
 */
function withoutCompetingSchemas(
  graphs: Array<ResourceGraph>,
  skipped: Array<string>,
): Array<ResourceGraph> {
  const definitions = new Map<string, Array<{ ref: ResourceRef; file: string; schema: string }>>();

  for (const resource of graphs.flatMap((graph) => graph.resources)) {
    if (!isArchitectureCatalogResource(resource) || !resource.attributes.schema) {
      continue;
    }

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
    if (new Set(found.map((item) => item.schema)).size < 2) {
      continue;
    }

    competing.add(key);
    const files = [...new Set(found.map((item) => item.file))].sort();
    const ref = found[0]!.ref;

    const where =
      files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files.at(-1)}` : files[0];

    skipped.push(
      `${ref.kind} ${ref.id} is defined differently in ${where}; its schema is left out until each is scanned with its own datastore`,
    );
  }

  if (!competing.size) {
    return graphs;
  }

  return graphs.map((graph) => ({
    ...graph,
    resources: graph.resources.map((resource) => {
      if (!competing.has(resourceKey(resource.ref)) || !isArchitectureCatalogResource(resource)) {
        return resource;
      }

      const {
        schema: _schema,
        fieldAliases: _aliases,
        fields: _fields,
        indexes: _indexes,
        ...attributes
      } = resource.attributes;

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
  const graphs: Array<ResourceGraph> = [];
  const errors: Array<string> = [];
  const skipped: Array<string> = [];

  const files = await resourceFiles(options, {
    include: (file) => isSourceFile(file) || file.endsWith('.prisma'),
    skipped,
  });

  const read = async (file: string) => {
    try {
      return await readResourceSource(file, options);
    } catch (error) {
      if (!(error instanceof ResourceReadError)) {
        throw error;
      }

      skipped.push(error.message);

      return undefined;
    }
  };

  const relativeTo = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const schemaFiles: Array<{ relative: string; content: string }> = [];

  for (const file of files.filter((item) => item.endsWith('.prisma'))) {
    const content = await read(file);

    if (content !== undefined) {
      schemaFiles.push({ relative: relativeTo(file), content });
    }
  }

  // Each schema is read on its own, with its own datasource: a multi-file
  // schema is the folder `prisma/schema/`, any other is its file's folder.
  const schemas = new Map<string, typeof schemaFiles>();

  for (const file of schemaFiles) {
    const folder =
      /^(?:.*\/)?prisma\/schema\//.exec(file.relative)?.[0] ?? path.posix.dirname(file.relative);

    schemas.set(folder, [...(schemas.get(folder) ?? []), file]);
  }

  const prisma = { models: new Map<string, PrismaModel>() };

  for (const group of schemas.values()) {
    const { graph, models } = prismaResources(group, namespace, skipped);

    graphs.push(graph);

    for (const [name, model] of models) {
      prisma.models.set(name, model);
    }
  }

  // First pass: what each file defines, imports and exports. Its syntax tree
  // is dropped; the second pass parses again only the files that use a model.
  const modules = new Map<string, ModuleInfo>();
  const drizzleTables = new Map<string, ResourceRef<'table'>>();
  const drizzleModels: Array<{ file: string; model: ParsedModel }> = [];
  const mongooseModelsByName = new Map<string, ParsedModel>();

  for (const file of files.filter(isSourceFile)) {
    const content = await read(file);

    if (content === undefined) {
      continue;
    }

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

    if (constructors.size) {
      for (const [local, value] of values) {
        if (findWithin(value, isClient)) {
          locals.set(local, { kind: 'prisma' });
        }
      }
    }

    if (content.includes('drizzle-orm')) {
      const drizzle = drizzleResources(ast, { namespace, file: relative, skipped });
      graph.resources.push(...drizzle.resources);
      drizzleModels.push(...drizzle.models.map((model) => ({ file, model })));

      for (const [local, ref] of drizzle.tables) {
        locals.set(local, { kind: 'model', ref, inferred: false });
        drizzleTables.set(local, ref);
      }
    }

    if (content.includes('mongoose')) {
      const mongoose = mongooseModels(values, { ast, relative, namespace, skipped });
      graph.resources.push(...mongoose.resources);

      for (const model of mongoose.models) {
        mongooseModelsByName.set(model.model, model);
      }

      for (const [local, binding] of mongoose.locals) {
        locals.set(local, binding);
      }
    }

    if (graph.resources.length) {
      graph.resources.push(architectureService(service));
      graphs.push(graph);
    }

    modules.set(file, { ...links, locals, queries: content.includes('.query.') });
  }

  const resolveModule = (file: string, specifier: string) => {
    if (!specifier.startsWith('.')) {
      return undefined;
    }

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

    if (!info || seen.has(key)) {
      return undefined;
    }

    seen.add(key);
    const local = info.exports.get(name);

    if (local !== undefined) {
      return bound(file, local, seen);
    }

    const reexport = info.reexports.get(name);

    if (reexport) {
      const target = resolveModule(file, reexport.module);

      return target ? exported(target, reexport.name, seen) : undefined;
    }

    if (name === 'default') {
      return undefined;
    }

    for (const star of info.stars) {
      const target = resolveModule(file, star);
      const binding = target ? exported(target, name, seen) : undefined;

      if (binding) {
        return binding;
      }
    }

    return undefined;
  };

  const bound = (file: string, local: string, seen: Set<string>): Binding | undefined => {
    const info = modules.get(file);
    const own = info?.locals.get(local);

    if (own) {
      return own;
    }

    const imported = info?.imports.get(local);
    const target = imported ? resolveModule(file, imported.module) : undefined;

    return target && imported ? exported(target, imported.name, seen) : undefined;
  };

  // A Drizzle reference names a table's variable as its own file sees it: one
  // of its own tables, else an import. A Mongoose ref names a registered model.
  for (const { file, model } of drizzleModels) {
    for (const { relation } of model.fields) {
      const binding = relation && bound(file, relation.model, new Set());

      if (relation && binding?.kind === 'model' && binding.ref.kind === 'table') {
        relation.to = binding.ref;
      }
    }
  }

  for (const model of mongooseModelsByName.values()) {
    for (const { relation } of model.fields) {
      const to = relation && mongooseModelsByName.get(relation.model)?.ref;

      if (relation && to) {
        relation.to = to;
      }
    }
  }

  const related = [...drizzleModels.map(({ model }) => model), ...mongooseModelsByName.values()];

  for (const model of related) {
    describeModel(model);
  }

  graphs.push({ ...emptyResourceGraph(), relationships: modelReferences(related) });

  // Second pass: accesses, in the files that can reach a model.
  for (const [file, info] of modules) {
    const bindings = new Map<string, Binding>();

    for (const local of new Set([...info.locals.keys(), ...info.imports.keys()])) {
      const binding = bound(file, local, new Set());

      if (binding) {
        bindings.set(local, binding);
      }
    }

    if (!bindings.size && !(info.queries && drizzleTables.size)) {
      continue;
    }

    const content = await read(file);

    if (content === undefined) {
      continue;
    }

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
      fields: Array<string> = [],
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
        const model = receiverBinding(receiver, bindings);

        const argument = node.arguments[0];

        const table =
          argument && ts.isIdentifier(argument) ? bindings.get(argument.text) : undefined;

        if (model?.kind === 'model' && model.ref.kind === 'collection') {
          const type = method === 'create' ? 'writes' : databaseAccess(method);

          if (type) {
            access(
              node,
              type,
              model.ref,
              model.inferred,
              type === 'reads' ? includedProjection(node.arguments[1]) : [],
            );
          }
        }

        if (table?.kind === 'model' && table.ref.kind === 'table') {
          const type = drizzleAccess(node, method);

          if (type) {
            access(node, type, table.ref, table.inferred);
          }
        }

        // Drizzle's relational queries: db.query.<table>.findMany()
        if (
          (method === 'findMany' || method === 'findFirst') &&
          ts.isPropertyAccessExpression(receiver) &&
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === 'query'
        ) {
          const ref = drizzleTables.get(receiver.name.text);

          if (ref) {
            access(node, 'reads', ref, false);
          }
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

          if (delegate && type) {
            access(node, type, delegate.ref, false, prismaSelection(argument, delegate.aliases));
          }
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

          if (client && ts.isIdentifier(client)) {
            clients.add(client.text);
          }
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
    const exports: Array<ModelExport> = modelExports.parse(
      (await readOptionalResourceJson(path.join(root, '.autocatalog', 'models.json'), { root })) ??
        [],
    );

    const exported = emptyResourceGraph();

    for (const definition of exports) {
      const ref: ResourceRef<'collection' | 'table'> = {
        kind: definition.kind,
        namespace: `${definition.datastore}/${definition.database}`,
        id: definition.id,
      };

      exported.resources.push(
        sourceResource(ref, definition, {
          file: '.autocatalog/models.json',
          symbol: definition.symbol ?? definition.id,
          line: 1,
        }),
      );

      const user = definition.service ?? service;

      for (const type of definition.access ?? []) {
        exported.resources.push(architectureService(user));
        exported.relationships.push({
          type,
          from: { kind: 'service', id: user },
          to: ref,
          provenance: 'declared',
          needsReview: false,
          source: { type: 'code', file: '.autocatalog/models.json' },
        });
      }
    }

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
