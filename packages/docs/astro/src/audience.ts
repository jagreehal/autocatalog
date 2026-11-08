import {
  analyzeDelivery,
  AUTOCATALOG_GRAPH_SPEC,
  isJsonObject,
  summarizeResourceGraph,
  type JsonObject,
  type JsonValue,
  type ResourceGraph,
} from 'autocatalog-core';
import type { Doc, DocsManifest, ReadDocsOptions } from 'autocatalog-docs-core';
import { z } from 'zod';
import type { DocsCatalog } from './catalog';

/**
 * How a site for `audience` reads documents: only those naming it. A document
 * that names nobody is the company's own, so outside it is left out.
 */
export const audienceReader = (
  audience: string | undefined,
): Pick<ReadDocsOptions, 'audience' | 'audienceRequired'> =>
  audience ? { audience: [audience], audienceRequired: true } : {};

/** A document as a reader outside gets it: without the team that keeps it. */
export function docForAudience({ data, ...doc }: Doc): Doc {
  const { owner: _owner, ...rest } = data;

  return { ...doc, data: rest };
}

/** Each document's record without its owner or the repository it is read from. */
const manifestForAudience = (manifest: DocsManifest): DocsManifest =>
  Object.fromEntries(
    Object.entries(manifest).map(([id, record]) => [
      id,
      { ...record, owner: '', source: null, edit: null },
    ]),
  );

/**
 * What a site for readers outside the company publishes: their documents and
 * the API references, each without what is marked `x-internal`. The graph,
 * events, services and owners are the company's own, so none of them is kept.
 */
export function catalogForAudience(catalog: DocsCatalog): DocsCatalog {
  const graph: ResourceGraph = { spec: AUTOCATALOG_GRAPH_SPEC, resources: [], relationships: [] };

  return {
    ...catalog,
    docs: catalog.docs.map(docForAudience),
    manifest: manifestForAudience(catalog.manifest),
    events: [],
    history: [],
    apis: catalog.apis.flatMap((api) => {
      const document = publicApiDocument(api.document);

      return document ? [{ ...api, document, services: [] }] : [];
    }),
    specifications: [],
    models: [],
    flows: [],
    flowNotes: [],
    flowEvidence: new Map(),
    designs: [],
    repositoryRoots: {},
    model: { glossaries: [], entities: [], dataProducts: [], people: [] },
    graph,
    summary: summarizeResourceGraph(graph),
    // Kept, so a quarantined repository is left out of the pages too. Only the
    // catalog's own page names them, and a site for readers outside has none.
    behind: [],
    snapshots: [],
    workflows: [],
    delivery: analyzeDelivery({ graph, events: [], consumers: [] }),
  };
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const internal = (value: JsonValue | undefined) =>
  isJsonObject(value) && value['x-internal'] === true;

/**
 * An OpenAPI document as a reader outside sees it: no path, webhook or
 * operation marked `x-internal: true`, no tag or component only they used, and
 * no `x-autocatalog`, which names the company's services. Undefined when the
 * whole document is internal or nothing in it is left.
 */
export function publicApiDocument(document: JsonObject): JsonObject | undefined {
  if (internal(document)) return undefined;

  const { paths, webhooks, components, ...rest } = objectWithoutAutocatalog(document);

  const group = (type: string) =>
    isJsonObject(components) && isJsonObject(components[type]) ? components[type] : {};

  // Path items and callbacks a $ref names, filtered once each, chains and all.
  // One met again while it is still being filtered is a cycle, and goes.
  const filtered = new Map<string, JsonObject | undefined>();

  const resolve = (type: Referable, name: string): JsonObject | undefined => {
    const key = `${type}/${name}`;

    if (filtered.has(key)) return filtered.get(key);

    filtered.set(key, undefined);

    const value = (type === 'pathItems' ? publicPathItem : publicCallback)(
      group(type)[name],
      lookup,
    );

    filtered.set(key, value);

    return value;
  };

  const lookup: Lookup = (pointer, type) => {
    const ref = componentRef(pointer);

    return ref?.[0] === type ? resolve(type, ref[1]) : undefined;
  };

  const publicGroup = (type: Referable) =>
    Object.fromEntries(
      Object.keys(group(type)).flatMap((name) => {
        const value = resolve(type, name);

        return value ? [[name, value]] : [];
      }),
    );

  const kept: JsonObject = {
    ...rest,
    ...(isJsonObject(components) && {
      components: {
        ...components,
        ...(components.pathItems !== undefined && { pathItems: publicGroup('pathItems') }),
        ...(components.callbacks !== undefined && { callbacks: publicGroup('callbacks') }),
      },
    }),
    ...(paths !== undefined && { paths: publicItems(paths, lookup) }),
    ...(webhooks !== undefined && { webhooks: publicItems(webhooks, lookup) }),
  };

  const published = [kept.paths, kept.webhooks].flatMap((items) =>
    isJsonObject(items) ? Object.values(items) : [],
  );

  if (published.length === 0) return undefined;

  // Tags last: a component pruned here may be the only user of one.
  return withoutUnusedTags(withoutUnusedComponents(kept));
}

function withoutAutocatalog(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withoutAutocatalog);

  return isJsonObject(value) ? objectWithoutAutocatalog(value) : value;
}

/** {@link withoutAutocatalog} for an object, which stays one. */
function objectWithoutAutocatalog(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      key === 'x-autocatalog' ? [] : [[key, withoutAutocatalog(item)]],
    ),
  );
}

/** The components a $ref can name in place of a path item or a callback. */
type Referable = 'pathItems' | 'callbacks';

/** The published path item or callback a $ref names, if there is one. */
type Lookup = (pointer: string, type: Referable) => JsonObject | undefined;

/** Paths, webhooks or a callback's expressions: each with an operation left. */
function publicItems(items: JsonValue, lookup: Lookup): JsonObject {
  if (!isJsonObject(items)) return {};

  return Object.fromEntries(
    Object.entries(items).flatMap(([key, item]) => {
      const kept = publicPathItem(item, lookup);

      return kept && operates(kept, lookup) ? [[key, kept]] : [];
    }),
  );
}

/**
 * A path item without its internal operations. Its $ref stays while what it
 * names is published; one this cannot follow goes, and its own fields stay.
 */
function publicPathItem(item: JsonValue | undefined, lookup: Lookup): JsonObject | undefined {
  if (!isJsonObject(item) || internal(item)) return undefined;

  return Object.fromEntries(
    Object.entries(item).flatMap(([field, value]) => {
      if (field === '$ref') {
        const pointer = z.string().safeParse(value).data;

        return pointer !== undefined && lookup(pointer, 'pathItems') ? [[field, value]] : [];
      }

      if (!METHODS.has(field)) return [[field, value]];

      return isJsonObject(value) && !internal(value)
        ? [[field, publicOperation(value, lookup)]]
        : [];
    }),
  );
}

/**
 * Whether a path item has an operation of its own or through its $ref, as one
 * that only shares parameters does not. A cycle was cut when it was filtered.
 */
function operates(item: JsonObject, lookup: Lookup): boolean {
  if (Object.keys(item).some((field) => METHODS.has(field))) return true;

  const pointer = z.string().safeParse(item.$ref).data;
  const target = pointer === undefined ? undefined : lookup(pointer, 'pathItems');

  return target !== undefined && operates(target, lookup);
}

/** An operation whose callbacks are filtered as paths are. */
function publicOperation(operation: JsonObject, lookup: Lookup): JsonObject {
  const { callbacks, ...rest } = operation;

  if (!isJsonObject(callbacks)) return operation;

  const kept = Object.fromEntries(
    Object.entries(callbacks).flatMap(([name, callback]) => {
      const value = publicCallback(callback, lookup);

      return value ? [[name, value]] : [];
    }),
  );

  return Object.keys(kept).length > 0 ? { ...rest, callbacks: kept } : rest;
}

/** A callback: path items by expression, or a $ref to one in components. */
function publicCallback(callback: JsonValue | undefined, lookup: Lookup): JsonObject | undefined {
  if (!isJsonObject(callback) || internal(callback)) return undefined;

  const pointer = z.string().safeParse(callback.$ref).data;

  if (pointer !== undefined) return lookup(pointer, 'callbacks') ? callback : undefined;

  const kept = publicItems(callback, lookup);

  return Object.keys(kept).length > 0 ? kept : undefined;
}

function operationsOf(document: JsonObject): JsonObject[] {
  const pathItems = isJsonObject(document.components) ? document.components.pathItems : undefined;

  return [document.paths, document.webhooks, pathItems].flatMap((items) =>
    isJsonObject(items)
      ? Object.values(items).flatMap((item) =>
          isJsonObject(item)
            ? Object.entries(item).flatMap(([field, value]) =>
                METHODS.has(field) && isJsonObject(value) ? [value] : [],
              )
            : [],
        )
      : [],
  );
}

function withoutUnusedTags(document: JsonObject): JsonObject {
  if (!Array.isArray(document.tags)) return document;

  const used = new Set(
    operationsOf(document).flatMap((operation) =>
      Array.isArray(operation.tags) ? operation.tags : [],
    ),
  );

  return {
    ...document,
    tags: document.tags.filter((tag) => isJsonObject(tag) && used.has(tag.name ?? '')),
  };
}

/** `#/components/schemas/Order` as `['schemas', 'Order']`. */
export function componentRef(ref: string): [string, string] | undefined {
  const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);

  if (!match) return undefined;

  const unescape = (part: string) =>
    decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~');

  return [unescape(match[1]!), unescape(match[2]!)];
}

/**
 * Components nothing left refers to, directly or through another component,
 * are dropped: an internal operation's schemas would otherwise still publish.
 * Security schemes are named by `security`, not by $ref, so they all stay.
 */
function withoutUnusedComponents(document: JsonObject): JsonObject {
  const { components, ...rest } = document;

  if (!isJsonObject(components)) return document;

  const used = new Set<string>();

  const visit = (value: JsonValue | undefined): void => {
    if (Array.isArray(value)) value.forEach(visit);

    if (!isJsonObject(value)) return;

    const pointer = z.string().safeParse(value.$ref).data;
    const ref = pointer === undefined ? undefined : componentRef(pointer);

    const use = ([type, name]: [string, string]) => {
      if (used.has(`${type}/${name}`)) return;

      used.add(`${type}/${name}`);

      const group = components[type];

      if (isJsonObject(group)) visit(group[name]);
    };

    if (ref) use(ref);

    // A discriminator names its schemas by $ref or by bare name, outside any $ref.
    const mapping = z
      .record(z.string(), z.string())
      .safeParse(isJsonObject(value.discriminator) ? value.discriminator.mapping : undefined).data;

    if (mapping) {
      for (const target of Object.values(mapping)) {
        const named = target.startsWith('#') ? componentRef(target) : undefined;

        if (named) use(named);
        else if (!target.includes('/')) use(['schemas', target]);
      }
    }

    Object.values(value).forEach(visit);
  };

  visit(rest);

  return {
    ...rest,
    components: Object.fromEntries(
      Object.entries(components).map(([type, group]) => [
        type,
        type === 'securitySchemes' || !isJsonObject(group)
          ? group
          : Object.fromEntries(
              Object.entries(group).filter(([name]) => used.has(`${type}/${name}`)),
            ),
      ]),
    ),
  };
}
