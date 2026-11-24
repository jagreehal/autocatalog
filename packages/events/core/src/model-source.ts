import ts from 'typescript';
import { z } from 'zod';
import { architectureResource } from './architecture';
import { jsonValueSchema } from './json';
import type { JsonObject, JsonValue } from './json';
import { resourceKey } from './resource-graph';
import type { CatalogRelationship, CatalogResource, ResourceRef } from './resource-graph';

/** The relation a model's field points at, beside the column it may hold. */
export interface ModelRelation {
  /** The related model, as the code names it. */
  model: string;
  /** The related resource, once the scan found it. */
  to?: ResourceRef;
  /** A list of related records rather than one. */
  many: boolean;
  /** Prisma's relation name, which pairs the two sides of one relation. */
  name?: string;
  /** This model's columns that hold the related key: present on the side that owns the foreign key. */
  fields?: Array<string>;
  /** The related model's columns those hold. */
  references?: Array<string>;
}

/** One field of a model as its page shows it, beside the JSON Schema drift compares. */
export interface ModelField {
  /** As the code names it. */
  name: string;
  /** The database's own name, when it differs. */
  column?: string;
  /** As the schema declares it: `String`, `Currency`, `varchar`. */
  type: string;
  list?: boolean;
  optional?: boolean;
  id?: boolean;
  unique?: boolean;
  /** The default as written, such as `now()` or `"pending"`. */
  default?: string;
  /** Set by the ORM on every update. */
  updatedAt?: boolean;
  enum?: Array<string>;
  doc?: string;
  relation?: ModelRelation;
  /** An embedded type's own fields. */
  fields?: Array<ModelField>;
}

export interface ModelIndex {
  fields: Array<string>;
  unique: boolean;
  /** A composite primary key, as `@@id` declares one. */
  primary?: boolean;
  name?: string;
}

/** A model's fields, kept by reference so a relation found later can be resolved in place. */
export interface ParsedModel {
  resource: CatalogResource;
  ref: ResourceRef;
  fields: Array<ModelField>;
  file: string;
  line: number;
}

/** A model, table or Prisma client that a local name refers to. */
export type Binding =
  | { kind: 'model'; ref: ResourceRef<'collection' | 'table'>; inferred: boolean }
  /** An object of models: `const models = { Track: model('Track', schema) }`. */
  | { kind: 'models'; members: Map<string, Binding> }
  | { kind: 'prisma' };

export function propertyName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : undefined;
}

export function objectFields(node: ts.Node | undefined): Map<string, ts.Expression> {
  const fields = new Map<string, ts.Expression>();

  if (!node || !ts.isObjectLiteralExpression(node)) {
    return fields;
  }

  for (const item of node.properties) {
    if (ts.isPropertyAssignment(item)) {
      const name = propertyName(item.name);

      if (filled(name)) {
        fields.set(name, item.initializer);
      }
    }
  }

  return fields;
}

export function literal(node: ts.Node | undefined): JsonValue | undefined {
  if (!node) {
    return undefined;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }

  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(literal);

    return values.every((item) => item !== undefined) ? values : undefined;
  }

  return undefined;
}

export function textLiteral(node: ts.Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

/** Where a model is declared: its file, and the line and name there. */
export interface ModelSource {
  file: string;
  symbol: string;
  line: number;
}

export function sourceResource(
  ref: ResourceRef<'collection' | 'table'>,
  { adapter, schema }: { adapter: string; schema: JsonObject },
  { file, symbol, line }: ModelSource,
): CatalogResource {
  return {
    ...architectureResource(ref, { adapter, schema }),
    source: { type: 'code', file, symbol, line },
    provenance: { default: 'extracted', fields: {} },
    needsReview: false,
  };
}

export const filled = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

/** An object literal's properties, or undefined when a spread or computed name could add others. */
export function staticObject(node: ts.Node | undefined): Map<string, ts.Expression> | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return undefined;
  }

  if (
    !node.properties.every(
      (item) => ts.isPropertyAssignment(item) && propertyName(item.name) !== undefined,
    )
  ) {
    return undefined;
  }

  return objectFields(node);
}

/** Record a model's fields on its resource, once each relation's target is resolved. */
export function describeModel(
  { resource, fields }: ParsedModel,
  indexes: Array<ModelIndex> = [],
): void {
  resource.attributes = {
    ...resource.attributes,
    fields: jsonValueSchema.parse(fields),
    ...(indexes.length && { indexes: jsonValueSchema.parse(indexes) }),
  };
}

const sameRef = (a: ResourceRef, b: ResourceRef) => resourceKey(a) === resourceKey(b);

/** The other side of a model's relation, when the related model declares one. */
const oppositeOf = (
  relation: ModelRelation,
  model: ParsedModel,
  related: ParsedModel | undefined,
): ModelRelation | undefined =>
  related?.fields
    .flatMap((field) => field.relation ?? [])
    .find(({ to, name }) => to !== undefined && sameRef(to, model.ref) && name === relation.name);

/** Whether a relation's edge is its own side's: the side with the key, else the name that sorts first. */
const drawsEdge = (
  relation: ModelRelation,
  opposite: ModelRelation | undefined,
  sortsFirst: boolean,
) =>
  (relation.fields !== undefined && relation.fields.length > 0) ||
  (relation.many && opposite?.many === true && sortsFirst);

/** A model's fields that point at another model the scan found. */
const relationsOf = (model: ParsedModel) =>
  model.fields.flatMap(({ name, relation }) =>
    relation?.to && !sameRef(relation.to, model.ref) ? [{ name, relation, to: relation.to }] : [],
  );

/**
 * A `references` edge from each model to every other model it holds a key of,
 * so a map can join them. A many-to-many relation with no key on either side
 * is drawn once, from the model whose name sorts first. A model's relation to
 * itself is on its page rather than on the map.
 */
export function modelReferences(models: Array<ParsedModel>): Array<CatalogRelationship> {
  const edges = new Map<string, CatalogRelationship>();
  const byKey = new Map(models.map((model) => [resourceKey(model.ref), model]));

  for (const model of models) {
    const from = resourceKey(model.ref);

    for (const { name, relation, to } of relationsOf(model)) {
      const related = resourceKey(to);
      const opposite = oppositeOf(relation, model, byKey.get(related));

      if (!drawsEdge(relation, opposite, from < related)) {
        continue;
      }

      const key = `${from}->${related}`;
      const edge = edges.get(key);
      const names = z.array(z.string()).catch([]).parse(edge?.attributes?.fields);

      edges.set(key, {
        type: 'references',
        from: model.ref,
        to,
        provenance: 'extracted',
        needsReview: false,
        source: edge?.source ?? { type: 'code', file: model.file, line: model.line },
        attributes: { fields: [...names, name] },
      });
    }
  }

  return [...edges.values()];
}
