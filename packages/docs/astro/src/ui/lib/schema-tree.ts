import { z } from 'zod';
import type { JsonValue } from './json';

// Builds the tree SchemaTree draws. It runs where the page is built, so zod
// never reaches the browser; the island gets plain nodes.

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

// The keywords this tree renders. A keyword of the wrong type is dropped rather
// than failing the page: a rendering is no place to enforce a contract.
const optional = <T extends z.ZodType>(type: T) => type.optional().catch(undefined);

const schemaNode = z
  .object({
    const: optional(jsonValueSchema),
    enum: optional(z.array(jsonValueSchema)),
    type: optional(z.union([z.string(), z.array(z.string())])),
    // An object, or the older tuple form, which renders as `any[]`.
    items: optional(z.union([jsonObjectSchema, z.array(jsonValueSchema)])),
    oneOf: optional(z.array(jsonValueSchema)),
    anyOf: optional(z.array(jsonValueSchema)),
    $ref: optional(z.string()),
    format: optional(z.string()),
    minimum: optional(z.number()),
    exclusiveMinimum: optional(z.number()),
    maximum: optional(z.number()),
    exclusiveMaximum: optional(z.number()),
    minLength: optional(z.number()),
    maxLength: optional(z.number()),
    pattern: optional(z.string()),
    default: optional(jsonValueSchema),
    title: optional(z.string()),
    description: optional(z.string()),
    properties: optional(jsonObjectSchema),
    required: optional(z.array(z.string())),
  })
  // Anything that is not an object, such as the boolean schema `true`, says
  // nothing this tree shows.
  .catch({});

type SchemaNode = z.infer<typeof schemaNode>;

function typeOf(s: SchemaNode): string {
  if (s.const !== undefined) return `const ${JSON.stringify(s.const)}`;

  if (s.enum) return 'enum';

  const type = Array.isArray(s.type) ? s.type.join(' | ') : (s.type ?? '');

  if (type === 'array' && s.items) {
    return `${typeOf(schemaNode.parse(s.items))}[]`;
  }

  if (s.oneOf || s.anyOf) return 'one of';

  if (s.$ref) return s.$ref.split('/').pop() ?? 'ref';

  return type || 'any';
}

// Zod writes the safe-integer range onto every int. It is true of every
// JavaScript integer, so showing it is noise a reader has to skip past.
const SAFE = Number.MAX_SAFE_INTEGER;

function constraints(s: SchemaNode): string[] {
  const out: string[] = [];

  if (s.format !== undefined) out.push(s.format);

  if (s.minimum !== undefined && s.minimum !== -SAFE) out.push(`≥ ${s.minimum}`);

  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);

  if (s.maximum !== undefined && s.maximum !== SAFE) out.push(`≤ ${s.maximum}`);

  if (s.exclusiveMaximum !== undefined) out.push(`< ${s.exclusiveMaximum}`);

  if (s.minLength !== undefined && s.minLength === s.maxLength) out.push(`length ${s.minLength}`);
  else {
    if (s.minLength !== undefined) out.push(`min length ${s.minLength}`);

    if (s.maxLength !== undefined) out.push(`max length ${s.maxLength}`);
  }

  if (s.pattern !== undefined && s.format === undefined) out.push(`pattern ${s.pattern}`);

  if (s.enum) out.push(s.enum.map((value) => JSON.stringify(value)).join(' | '));

  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`);

  return out;
}

// What tells one variant from another: its title, else the first `const`
// property, which is the discriminator Zod writes into every branch.
function variantLabel(variant: SchemaNode, index: number): string {
  if (variant.title) return variant.title;

  for (const [key, value] of Object.entries(variant.properties ?? {})) {
    const fixed = schemaNode.parse(value).const;

    if (fixed !== undefined) return `${key} = ${JSON.stringify(fixed)}`;
  }

  return `option ${index + 1}`;
}

interface Children {
  entries: Array<[string, SchemaNode]>;
  required: string[];
}

// A variant usually leans on the fields declared beside `oneOf`, so each one is
// shown whole: the shared fields first, then its own.
function childrenOf(s: SchemaNode): Children | null {
  const variants = s.oneOf ?? s.anyOf;

  if (variants) {
    return {
      entries: variants.map((raw, index): [string, SchemaNode] => {
        const variant = schemaNode.parse(raw);

        const merged: SchemaNode =
          s.properties || variant.properties
            ? {
                ...variant,
                type: variant.type ?? 'object',
                properties: { ...s.properties, ...variant.properties },
                required: [...new Set([...(s.required ?? []), ...(variant.required ?? [])])],
              }
            : variant;

        return [variantLabel(variant, index), merged];
      }),
      required: [],
    };
  }

  return s.properties
    ? {
        entries: Object.entries(s.properties).map(([key, value]): [string, SchemaNode] => [
          key,
          schemaNode.parse(value),
        ]),
        required: s.required ?? [],
      }
    : null;
}

/** One property as the tree draws it. `id` is its position, `0.2.1`: a descendant's id starts with its ancestor's. */
export interface PropNode {
  id: string;
  name: string;
  /** Dotted path as the field index names it (`items[].sku`). */
  path: string;
  type: string;
  required: boolean;
  description: string | null;
  facts: string[];
  depth: number;
  children: PropNode[] | null;
  /** Who carries and consumes this field, when the page joined the field index. */
  lineage?: {
    carriers: number;
    consumers: string[];
    producers: string[];
    conflict?: string | undefined;
  };
}

function buildChildren(
  node: SchemaNode,
  idPrefix: string,
  depth: number,
  pathPrefix: string,
  underArray: boolean,
): PropNode[] | null {
  const items = node.type === 'array' && node.items ? schemaNode.parse(node.items) : null;

  const own = childrenOf(node) ?? (items ? childrenOf(items) : null);

  if (!own) return null;

  const required = new Set(own.required);
  const childPrefix = underArray ? (pathPrefix ? `${pathPrefix}[]` : '') : pathPrefix;

  return own.entries.map(([key, child], index) =>
    buildNode(key, child, required.has(key), `${idPrefix}${index}`, depth, childPrefix),
  );
}

function buildNode(
  name: string,
  node: SchemaNode,
  required: boolean,
  id: string,
  depth: number,
  pathPrefix: string,
): PropNode {
  const path = pathPrefix ? `${pathPrefix}.${name}` : name;
  const array = node.type === 'array';

  return {
    id,
    name,
    path,
    type: typeOf(node),
    required,
    description: node.description ?? null,
    facts: constraints(node),
    depth,
    children: buildChildren(node, `${id}.`, depth + 1, path, array),
  };
}

/** A JSON Schema's properties as the tree draws them, nested and numbered. */
export function schemaTree(schema: JsonValue): PropNode[] {
  return buildChildren(schemaNode.parse(schema), '', 1, '', false) ?? [];
}
