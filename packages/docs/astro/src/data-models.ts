import path from 'node:path';
import {
  buildServices,
  datastoreOwnership,
  isArchitectureCatalogResource,
  isJsonObject,
  modelFields,
  modelIndexes,
  resourceKey,
  type ArchitectureCatalogResource,
  type JsonObject,
  type JsonValue,
  type ModelField,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import { sourceUrl } from 'autocatalog-docs-core';
import { z } from 'zod';
import type { CatalogEvent, DocsCatalog } from './catalog';
import { docsSiteConfig } from './config';
import { graphOwners, ownerFor, ownerHref } from './owners';
import type { DataModelPageProps, DataModelsPageProps } from './ui/pages';
import { catalogAnchor } from './view';

/** A table or collection a repository's scan found, with the page it gets. */
export interface CatalogModel {
  repository: string;
  /** Its page's segment: the model's name, as one slug. */
  name: string;
  /** The repository's checkout, for a link to the file that defines it. */
  repositoryRoot: string;
  resource: ArchitectureCatalogResource;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The `datastore/database` a model lives in, when the code names one. Prisma
 * without a database in its schema scans as `default/default`, which tells a
 * reader nothing, so the page leaves it out.
 */
const namedDatastore = (namespace: string | undefined) =>
  namespace && !/^default(\/default)?$/.test(namespace) ? { datastore: namespace } : {};

/** The name the code gives it (`User`), else the database's (`users`). */
export const modelTitle = (resource: ArchitectureCatalogResource) =>
  resource.source?.symbol ?? resource.ref.id;

/**
 * Every table and collection, each under the repository whose scan found it.
 * Models in one repository whose names share a page take turns by the name the
 * code gives them, then by identity, so which one keeps the bare address
 * does not hang on database names or scan order. The others get the
 * database's name and a number.
 */
export function catalogModels(
  graph: ResourceGraph,
  repositories: Map<string, { repository: string; repositoryRoot: string }>,
): CatalogModel[] {
  const taken = new Set<string>();

  return graph.resources
    .filter(isArchitectureCatalogResource)
    .flatMap((resource) => {
      const found = repositories.get(resourceKey(resource.ref));

      if (!found || (resource.ref.kind !== 'table' && resource.ref.kind !== 'collection'))
        return [];

      return [{ ...found, resource }];
    })
    .sort((a, b) => {
      const order = (x: string, y: string) => Number(x > y) - Number(x < y);

      return (
        order(modelTitle(a.resource), modelTitle(b.resource)) ||
        order(resourceKey(a.resource.ref), resourceKey(b.resource.ref))
      );
    })
    .map((model) => {
      const own = slug(modelTitle(model.resource)) || 'model';
      let name = own;

      for (let n = 2; taken.has(`${model.repository}/${name}`); n += 1)
        name = `${slug(model.resource.ref.id)}-${n}`;
      taken.add(`${model.repository}/${name}`);

      return { ...model, name };
    });
}

/** Where a model's page lives on the site, relative to its base. */
export const modelPath = (model: Pick<CatalogModel, 'repository' | 'name'>) =>
  `data/${model.repository}/${model.name}/`;

/** The fields the scan described, else the columns its JSON Schema lists. */
export function fieldsOf(resource: ArchitectureCatalogResource): ModelField[] {
  const described = modelFields.safeParse(resource.attributes.fields);

  if (described.success) return described.data;

  const schema = isJsonObject(resource.attributes.schema) ? resource.attributes.schema : {};
  const properties = isJsonObject(schema.properties) ? schema.properties : {};

  return Object.entries(properties).map(([name, value]) => {
    const nullable =
      isJsonObject(value) &&
      Array.isArray(value.anyOf) &&
      value.anyOf.some((option) => isJsonObject(option) && option.type === 'null');

    return { name, type: typeOf(value), ...(nullable && { optional: true }) };
  });
}

/** A JSON Schema's type as one word: `string`, `integer[]`. */
function typeOf(value: JsonValue | undefined): string {
  if (!isJsonObject(value)) return 'unknown';

  if (Array.isArray(value.anyOf)) {
    const [first] = value.anyOf.filter(
      (option) => !(isJsonObject(option) && option.type === 'null'),
    );

    return typeOf(first);
  }

  if (value.type === 'array') return `${typeOf(value.items)}[]`;

  return text(value.format) ?? text(value.type) ?? 'json';
}

const text = (value: JsonValue | undefined) => z.string().min(1).safeParse(value).data;

/**
 * Prisma's side of a relation that names the model rather than holding a
 * column; a Drizzle or Mongoose key column carries its relation and stays.
 */
const isRelationOnly = (field: ModelField) =>
  Boolean(field.relation && !field.relation.fields?.includes(field.name));

/** Fields of a model's primary key, `@@id([a, b])` included. */
const primaryKeys = (resource: ArchitectureCatalogResource) =>
  new Set(
    modelIndexes
      .catch([])
      .parse(resource.attributes.indexes)
      .flatMap((index) => (index.primary ? index.fields : [])),
  );

const isModel = (ref: ResourceRef, resource: ArchitectureCatalogResource) =>
  resourceKey(ref) === resourceKey(resource.ref);

/**
 * Who reads and writes each model, and the page of each service that does:
 * its own page when an event names it, else its row in the Catalog.
 */
function serviceLinks(events: CatalogEvent[], base: string) {
  const pages = new Set(buildServices(events.map(({ event }) => event)).keys());

  return (name: string) => ({
    name,
    href: pages.has(name)
      ? `${base}services/${name}/`
      : `${base}catalog/#${catalogAnchor({ kind: 'service', id: name })}`,
  });
}

const store = (resource: ArchitectureCatalogResource) =>
  resource.ref.kind === 'collection' ? 'collection' : 'table';

/** The library a model was read from, as its makers write it: Prisma, Drizzle, Mongoose. */
const library = (value: JsonValue | undefined) => {
  const name = text(value);

  return name && `${name[0]!.toUpperCase()}${name.slice(1)}`;
};

export function dataModelsPageProps(
  graph: ResourceGraph,
  models: CatalogModel[],
  events: CatalogEvent[],
  base: string,
): DataModelsPageProps {
  const access = new Map(datastoreOwnership(graph).map((row) => [resourceKey(row.ref), row]));
  const service = serviceLinks(events, base);

  return {
    models: models.map((model) => {
      const { resource } = model;
      const row = access.get(resourceKey(resource.ref));

      return {
        title: modelTitle(resource),
        href: `${base}${modelPath(model)}`,
        store: store(resource),
        name: resource.ref.id,
        ...namedDatastore(resource.ref.namespace),
        adapter: library(resource.attributes.adapter),
        repository: model.repository,
        owner: resource.owner?.team,
        fields: fieldsOf(resource).filter((field) => !isRelationOnly(field)).length,
        readers: (row?.readers ?? []).map(service),
        writers: (row?.writers ?? []).map(service),
      };
    }),
  };
}

export function dataModelPageProps(
  graph: ResourceGraph,
  model: CatalogModel,
  models: CatalogModel[],
  events: CatalogEvent[],
  context: { base: string; root: string },
): DataModelPageProps {
  const { base, root } = context;
  const { resource } = model;
  const fields = fieldsOf(resource);
  const primary = primaryKeys(resource);
  const service = serviceLinks(events, base);

  const row = datastoreOwnership(graph).find(({ ref }) => isModel(ref, resource));

  const pages = new Map(
    models.map((other) => [resourceKey(other.resource.ref), `${base}${modelPath(other)}`]),
  );

  // A column holding another model's key says which model, beside its name.
  const keys = new Map(
    fields.flatMap((field) =>
      (field.relation?.fields ?? []).map((name) => [name, field.relation!.model] as const),
    ),
  );

  const rows = (list: ModelField[], prefix = ''): DataModelPageProps['fields'] =>
    list.flatMap((field) => [
      {
        name: `${prefix}${field.name}`,
        type: `${field.type}${field.list ? '[]' : ''}`,
        required: !field.optional && !field.list,
        ...(field.column && { column: field.column }),
        ...((field.id || (!prefix && primary.has(field.name))) && { primary: true }),
        ...(field.unique && { unique: true }),
        ...(field.default !== undefined && { default: field.default }),
        ...(field.updatedAt && { updatedAt: true }),
        ...(field.enum && { values: field.enum }),
        ...(field.doc && { doc: field.doc }),
        ...(!prefix && keys.has(field.name) && { references: keys.get(field.name) }),
        ...(field.relation && {
          relation: {
            model: field.relation.model,
            href: field.relation.to && pages.get(resourceKey(field.relation.to)),
            many: field.relation.many,
            holdsKey: Boolean(field.relation.fields?.length),
            ...(field.relation.name && { name: field.relation.name }),
          },
        }),
      },
      ...rows(field.fields ?? [], `${prefix}${field.name}.`),
    ]);

  const owner = resource.owner && ownerFor(graphOwners(graph), resource.owner.team);
  const file = resource.source?.file;

  const repositoryPath = path
    .relative(root, model.repositoryRoot)
    .split(path.sep)
    .filter(Boolean)
    .join('/');

  const href = file && sourceUrl(root, repositoryPath ? `${repositoryPath}/${file}` : file, 'blob');

  return {
    store: store(resource),
    name: resource.ref.id,
    ...namedDatastore(resource.ref.namespace),
    adapter: library(resource.attributes.adapter),
    repository: model.repository,
    provenance: {
      method: resource.provenance.default,
      location: file ? `${file}${resource.source?.line ? `:${resource.source.line}` : ''}` : null,
      symbol: resource.source?.symbol ?? null,
      confidence: resource.confidence ?? null,
      needsReview: resource.needsReview,
    },
    ...(href && {
      sourceHref: `${href}${resource.source?.line ? `#L${resource.source.line}` : ''}`,
    }),
    ...(resource.owner && {
      owner: {
        team: owner?.name ?? resource.owner.team,
        href: owner ? ownerHref(owner) : undefined,
      },
    }),
    fields: rows(fields),
    indexes: modelIndexes.catch([]).parse(resource.attributes.indexes),
    readers: (row?.readers ?? []).map(service),
    writers: (row?.writers ?? []).map(service),
    diagram: entityDiagram(model, models),
  };
}

/** An entity's name, quoted so Mermaid's keywords (`One`, `to`, `u`) and leading digits read as names. */
const entity = (name: string) => `"${name.replace(/[^A-Za-z0-9_]/g, '_')}"`;

/**
 * A word Mermaid accepts as an attribute's type or name, which cannot be
 * quoted: it starts with a letter or `_` and is not a key mark (`pk`, `fk`, `uk`).
 */
const word = (value: string) => {
  const safe = value.replace(/[^A-Za-z0-9_]/g, '_') || 'unknown';
  const lead = /^[0-9]/.test(safe) ? `_${safe}` : safe;

  return /^[pfu]k$/i.test(lead) ? `${lead}_` : lead;
};

const attributeType = (field: ModelField) => `${word(field.type)}${field.list ? '[]' : ''}`;

interface Relation {
  /** The model whose field it is. */
  owner: CatalogModel | undefined;
  ownerName: string;
  field: ModelField;
}

/**
 * The model and the models one relation away, as a Mermaid entity-relationship
 * diagram. The model lists every column; each neighbour lists only its keys,
 * so a model with thirty relations still reads.
 */
export function entityDiagram(model: CatalogModel, models: CatalogModel[]): string | undefined {
  const key = resourceKey(model.resource.ref);
  const byKey = new Map(models.map((other) => [resourceKey(other.resource.ref), other]));
  const own = fieldsOf(model.resource);

  // Each relation once, from the side that holds the key: this model's own,
  // and every other model's that points here.
  const relations: Relation[] = [
    ...own.map((field) => ({ owner: model, ownerName: modelTitle(model.resource), field })),
    ...models
      .filter((other) => other !== model)
      .flatMap((other) =>
        fieldsOf(other.resource)
          .filter((field) => field.relation?.to && resourceKey(field.relation.to) === key)
          .map((field) => ({ owner: other, ownerName: modelTitle(other.resource), field })),
      ),
  ].filter(({ field }) => field.relation);

  if (relations.length === 0) return undefined;

  const opposite = ({ owner, field }: Relation) => {
    const target = field.relation!.to && byKey.get(resourceKey(field.relation!.to));

    return target && owner
      ? fieldsOf(target.resource).find(
          (other) =>
            other.relation?.to &&
            resourceKey(other.relation.to) === resourceKey(owner.resource.ref) &&
            other.relation.name === field.relation!.name &&
            // A relation to its own model pairs two fields of one model; each
            // read of the model is a fresh copy, so they are told apart by name.
            !(
              resourceKey(target.resource.ref) === resourceKey(owner.resource.ref) &&
              other.name === field.name
            ),
        )
      : undefined;
  };

  const lines = new Map<string, string>();
  const neighbours = new Map<string, CatalogModel | undefined>();

  for (const relation of relations) {
    const { field, ownerName } = relation;
    const target = field.relation!.to && byKey.get(resourceKey(field.relation!.to));
    const targetName = target ? modelTitle(target.resource) : field.relation!.model;
    const back = opposite(relation);
    // A label is quoted text, so a quote inside it reads as a single quote.
    const label = `"${field.name.replace(/"/g, "'")}"`;

    let line: string | undefined;

    if (field.relation!.fields?.length) {
      // The key holder: many (or one) of these to one of the target.
      const one = field.optional ? '|o' : '||';
      const many = back && !back.relation!.many ? 'o|' : 'o{';

      line = `${entity(targetName)} ${one}--${many} ${entity(ownerName)} : ${label}`;
    } else if (field.relation!.many && back?.relation!.many && !back.relation!.fields) {
      line = `${entity(ownerName)} }o--o{ ${entity(targetName)} : ${label}`;
    } else if (!back) {
      // A side without a key whose other side the scan did not see.
      line = `${entity(ownerName)} ||--${field.relation!.many ? 'o{' : 'o|'} ${entity(targetName)} : ${label}`;
    }

    if (!line) continue;
    const pair = [ownerName, targetName].sort().join(' ');
    const name = field.relation!.name ?? field.name;

    lines.set(`${pair} ${name}`, line);

    for (const [name, other] of [
      [ownerName, relation.owner],
      [targetName, target],
    ] as const)
      if (name !== modelTitle(model.resource)) neighbours.set(name, other);
  }

  const keyColumns = (other: CatalogModel | undefined) => {
    const fields = other ? fieldsOf(other.resource) : [];
    const primary = other ? primaryKeys(other.resource) : new Set<string>();
    const foreign = new Set(fields.flatMap((field) => field.relation?.fields ?? []));

    return fields
      .filter((field) => !isRelationOnly(field) && !field.fields)
      .flatMap((field) => {
        const marks = [
          ...(field.id || primary.has(field.name) ? ['PK'] : []),
          ...(foreign.has(field.name) ? ['FK'] : []),
          ...(field.unique ? ['UK'] : []),
        ];

        return [{ field, marks }];
      });
  };

  const block = (name: string, columns: ReturnType<typeof keyColumns>) => [
    `  ${entity(name)} {`,
    ...columns.map(
      ({ field, marks }) =>
        `    ${attributeType(field)} ${word(field.name)}${marks.length ? ` ${marks.join(', ')}` : ''}`,
    ),
    '  }',
  ];

  return [
    'erDiagram',
    // Neighbours stack in a column beside the model, so thirty of them still fit the page.
    '  direction LR',
    ...block(modelTitle(model.resource), keyColumns(model)),
    ...[...neighbours].flatMap(([name, other]) =>
      block(
        name,
        keyColumns(other).filter(({ marks }) => marks.length),
      ),
    ),
    ...[...lines.values()].map((line) => `  ${line}`),
  ].join('\n');
}

/** A model page's description when the code gives the model no summary. */
export const modelDescription = (
  page: Pick<DataModelPageProps, 'store' | 'datastore' | 'repository'>,
) =>
  `A ${page.store}${page.datastore ? ` in ${page.datastore}` : ''}, read from the ${page.repository} repository's code.`;

/** A model as Markdown: what it stores, each field, and who reads and writes it. */
export function modelTwin(
  page: DataModelPageProps,
  meta: { title: string; summary?: string | undefined; url?: string | undefined },
): string {
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const notes = (field: DataModelPageProps['fields'][number]) =>
    [
      field.primary && 'primary key',
      field.unique && 'unique',
      field.references && `references ${field.references}`,
      field.relation &&
        `relation to ${field.relation.many ? 'many' : 'one'} ${field.relation.model}`,
      field.default !== undefined && `default \`${field.default}\``,
      field.column && `stored as \`${field.column}\``,
      field.values && `one of ${field.values.map((value) => `\`${value}\``).join(', ')}`,
      field.doc,
    ]
      .filter(Boolean)
      .join('; ');

  const services = (heading: string, list: Array<{ name: string }>) =>
    list.length ? [`## ${heading}`, '', ...list.map(({ name }) => `- ${name}`), ''] : [];

  const frontmatter: JsonObject = {
    name: meta.title,
    kind: page.store,
    id: page.name,
    ...(page.datastore && { datastore: page.datastore }),
    repository: page.repository,
    ...(page.adapter && { adapter: page.adapter }),
    ...(page.owner && { owner: page.owner.team }),
    ...(page.provenance.location && { source: page.provenance.location }),
    ...(meta.url && { url: meta.url }),
  };

  return [
    '---',
    ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    '---',
    '',
    `# ${meta.title}`,
    '',
    meta.summary ??
      `The \`${page.name}\` ${page.store}${page.datastore ? ` in ${page.datastore}` : ''}.`,
    '',
    '## Fields',
    '',
    '| Field | Type | Required | Notes |',
    '| --- | --- | --- | --- |',
    ...page.fields.map(
      (field) =>
        `| \`${field.name}\` | \`${field.type}\` | ${field.required ? 'yes' : 'no'} | ${cell(notes(field))} |`,
    ),
    '',
    ...(page.indexes.length
      ? [
          '## Indexes',
          '',
          ...page.indexes.map(
            (index) =>
              `- ${index.primary ? 'primary key' : index.unique ? 'unique' : 'index'} on ${index.fields.map((name) => `\`${name}\``).join(', ')}${index.name ? ` (${index.name})` : ''}`,
          ),
          '',
        ]
      : []),
    ...services('Read by', page.readers),
    ...services('Written by', page.writers),
  ].join('\n');
}

/** A model's Markdown twin, as its `.md` route and llms-full.txt publish it. */
export function modelMarkdown(
  catalog: DocsCatalog,
  model: CatalogModel,
  links: { base: string; url: (page: string) => string | undefined },
): string {
  const page = dataModelPageProps(catalog.graph, model, catalog.models, catalog.events, {
    base: links.base,
    root: docsSiteConfig().root,
  });

  return modelTwin(page, {
    title: modelTitle(model.resource),
    summary: model.resource.summary,
    url: links.url(modelPath(model)),
  });
}
