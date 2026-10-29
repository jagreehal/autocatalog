import fs from 'node:fs';
import path from 'node:path';
import {
  fieldPaths,
  isEventCatalogResource,
  isJsonObject,
  isServiceCatalogResource,
  parseFrontmatter,
  type CatalogResource,
  type JsonObject,
  resourceKey,
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { resolveAbout } from './about';
import { DIAGRAM_NODE_TYPES, type Diagram, type DiagramNode } from './diagram';

/**
 * The rest of a domain model, one Markdown file per resource in the repository
 * that owns it. Field names follow EventCatalog's, so a file reads the same in
 * either tool.
 */
export const MODEL_DIRS = {
  glossary: 'glossary',
  entities: 'entities',
  dataProducts: 'data-products',
  teams: 'teams',
  users: 'users',
} as const;

/** Where one authored file came from. */
export interface Authored {
  repository: string;
  /** The file name without `.md`: the resource's id and its page's segment. */
  id: string;
  /** Path relative to the repository. */
  file: string;
  /** The Markdown under the frontmatter. */
  body: string;
}

const pointer = z.union([
  z.string().min(1),
  z.object({ id: z.string().min(1) }).transform((value) => value.id),
]);

const term = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
});

export type Term = z.output<typeof term>;

const glossarySchema = z.object({ dictionary: z.array(term).min(1) });

/** One domain's ubiquitous language: `glossary/<domain>.md`. */
export interface Glossary extends Authored {
  domain: string;
  terms: Term[];
}

export interface EntityProperty {
  name: string;
  type: string;
  required?: boolean | undefined;
  description?: string | undefined;
  /** Another entity's id. */
  references?: string | undefined;
  relationType?: string | undefined;
  enum?: string[] | undefined;
  properties?: EntityProperty[] | undefined;
}

const entityProperty: z.ZodType<EntityProperty> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    required: z.boolean().optional(),
    description: z.string().optional(),
    references: z.string().optional(),
    relationType: z.string().optional(),
    enum: z.array(z.string()).optional(),
    properties: z.array(entityProperty).optional(),
  }),
);

const entitySchema = z
  .object({
    name: z.string().min(1),
    summary: z.string().optional(),
    domains: z.array(pointer).default([]),
    services: z.array(pointer).default([]),
    aggregateRoot: z.boolean().default(false),
    identifier: z.string().optional(),
    properties: z.array(entityProperty).optional(),
    /** A JSON Schema in the repository the properties come from, instead of listing them. */
    schema: z.string().optional(),
  })
  .refine((entity) => !(entity.properties && entity.schema), {
    message: 'give properties or a schema to read them from, not both',
  });

/** A thing the domain talks about: `entities/<id>.md`. */
export interface Entity extends Authored {
  name: string;
  summary?: string | undefined;
  domains: string[];
  /** The services that hold it, resolved where the catalog has them. */
  services: Array<{ name: string; ref?: ResourceRef }>;
  aggregateRoot: boolean;
  identifier?: string | undefined;
  properties: EntityProperty[];
  /** The events whose schema carries the identifier, so a reader sees where it travels. */
  carriedBy: ResourceRef[];
}

const output = z.union([
  z
    .string()
    .min(1)
    .transform((ref) => ({ ref, contract: undefined })),
  z.object({ ref: z.string().min(1), contract: z.string().optional() }),
]);

const dataProductSchema = z
  .object({
    name: z.string().min(1),
    summary: z.string().optional(),
    domain: z.string().optional(),
    inputs: z.array(z.string().min(1)).default([]),
    outputs: z.array(output).default([]),
  })
  .refine((product) => product.inputs.length + product.outputs.length > 0, {
    message: 'a data product names at least one input or output',
  });

/** One end of a data product: a catalog resource, or another data product. */
export interface DataProductPort {
  /** As written: `event/payments/payment.captured`, `table/ledger`, `data-product/revenue`. */
  reference: string;
  /** The catalog's resource; absent for another data product, or one `ac docs check` defers. */
  ref?: ResourceRef;
  /** An output's contract, relative to the repository. */
  contract?: string | undefined;
}

/** Data a team publishes for others to use: `data-products/<id>.md`. */
export interface DataProduct extends Authored {
  name: string;
  summary?: string | undefined;
  domain?: string | undefined;
  inputs: DataProductPort[];
  outputs: DataProductPort[];
}

const contactFields = {
  email: z.string().optional(),
  slackDirectMessageUrl: z.string().optional(),
  msTeamsDirectMessageUrl: z.string().optional(),
};

const teamSchema = z.object({
  name: z.string().min(1),
  summary: z.string().optional(),
  members: z.array(pointer).default([]),
  ...contactFields,
});

const userSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  avatarUrl: z.string().optional(),
  ...contactFields,
});

/** A team or a person as the directory describes them: `teams/<id>.md`, `users/<id>.md`. */
export interface Person extends Authored {
  kind: 'team' | 'user';
  name: string;
  summary?: string | undefined;
  role?: string | undefined;
  avatarUrl?: string | undefined;
  email?: string | undefined;
  slackDirectMessageUrl?: string | undefined;
  msTeamsDirectMessageUrl?: string | undefined;
  /** A team's members, by user id. */
  members: string[];
}

export interface DomainModel {
  glossaries: Glossary[];
  entities: Entity[];
  dataProducts: DataProduct[];
  people: Person[];
}

export interface ReadDomainModelResult extends DomainModel {
  /** One line per file left out, naming it and the check it fails. */
  failures: string[];
  /** One line per file kept that reads as a mistake. */
  warnings: string[];
}

const ID = /^[a-z0-9][a-z0-9._-]*$/i;

const problem = (error: Error | string) => (error instanceof Error ? error.message : error);

/** Every Markdown file in one folder of each repository, parsed against its schema. */
function readFolder<T extends z.ZodType>(
  repositories: Array<{ repository: string; dir: string }>,
  folder: string,
  schema: T,
  failures: string[],
): Array<{ data: z.output<T>; where: Authored; dir: string }> {
  const found: Array<{ data: z.output<T>; where: Authored; dir: string }> = [];

  for (const { repository, dir } of repositories) {
    const full = path.join(dir, folder);

    // A real directory only: a symlink could point anywhere on the build machine.
    if (!fs.lstatSync(full, { throwIfNoEntry: false })?.isDirectory()) continue;

    const entries = fs
      .readdirSync(full, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const file = `${folder}/${entry.name}`;
      const id = entry.name.slice(0, -'.md'.length);

      try {
        if (!ID.test(id)) {
          throw new Error(
            `'${id}' cannot be a page's address; use letters, digits, '.', '-' and '_'`,
          );
        }

        const { data, content } = parseFrontmatter(
          fs.readFileSync(path.join(full, entry.name), 'utf8'),
        );

        const parsed = schema.safeParse(data);

        if (!parsed.success) throw new Error(z.prettifyError(parsed.error).replace(/\n+/g, '; '));

        found.push({
          data: parsed.data,
          where: { repository, id, file, body: content.trim() },
          dir,
        });
      } catch (error) {
        failures.push(
          `${repository}/${file}: ${problem(error instanceof Error ? error : String(error))}`,
        );
      }
    }
  }

  return found.sort(
    (a, b) =>
      a.where.repository.localeCompare(b.where.repository) || a.where.id.localeCompare(b.where.id),
  );
}

/** The domains events, services and agents name. */
function knownDomains(resources: CatalogResource[]): Set<string> {
  const domains = new Set<string>();

  for (const resource of resources) {
    if (isEventCatalogResource(resource)) domains.add(resource.attributes.domain);

    if (isServiceCatalogResource(resource)) {
      for (const domain of resource.attributes.domains) domains.add(domain);
    }

    if (resource.ref.kind === 'domain') domains.add(resource.ref.id);
  }

  return domains;
}

/** The parts of a JSON Schema property an entity shows. */
const schemaField = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  $ref: z.string().optional(),
  description: z.string().optional(),
  enum: z.array(z.json()).optional(),
});

/** A JSON Schema's properties, as an entity lists them. */
function schemaProperties(schema: JsonObject): EntityProperty[] {
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  return Object.entries(properties).flatMap(([name, value]): EntityProperty[] => {
    const parsed = schemaField.safeParse(value);

    if (!parsed.success || !isJsonObject(value)) return [];

    const field = parsed.data;

    return [
      {
        name,
        type:
          (Array.isArray(field.type) ? field.type.join(' | ') : field.type) ?? field.$ref ?? 'any',
        ...(required.has(name) && { required: true }),
        ...(field.description && { description: field.description }),
        ...(field.enum && { enum: field.enum.map(String) }),
        ...(field.type === 'object' && { properties: schemaProperties(value) }),
      },
    ];
  });
}

const jsonValue = z.json();

/** The properties of the JSON Schema an entity names. */
function readSchema(dir: string, file: string): EntityProperty[] {
  const schema = jsonValue.parse(JSON.parse(fs.readFileSync(inside(dir, file), 'utf8')));

  if (!isJsonObject(schema)) throw new Error(`'${file}' is not a JSON Schema object`);

  return schemaProperties(schema);
}

/**
 * A file a resource names inside its own repository, refused when it would
 * leave it. Symlinks are resolved first: a repository could commit one that
 * points anywhere on the build machine.
 */
function inside(dir: string, file: string): string {
  const full = path.resolve(dir, file);

  if (!fs.existsSync(full)) throw new Error(`'${file}' does not exist`);

  const relative = path.relative(fs.realpathSync(dir), fs.realpathSync(full));

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`'${file}' is outside the repository`);
  }

  return full;
}

export interface ReadDomainModelOptions {
  /**
   * Keep references the catalog does not have, unresolved: `ac docs check`
   * reads one repository's documents without every event they name.
   */
  deferMissing?: boolean;
  /**
   * An event's JSON Schema, where the catalog's resource does not carry it: a
   * site reads each event's schema file beside its manifest.
   */
  schemaOf?: (event: CatalogResource) => JsonObject | undefined;
}

/**
 * The glossaries, entities, data products, teams and users each repository
 * keeps, resolved against the composed catalog.
 */
export function readDomainModel(
  repositories: Array<{ repository: string; dir: string }>,
  catalog: { resources: CatalogResource[] },
  options: ReadDomainModelOptions = {},
): ReadDomainModelResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const domains = knownDomains(catalog.resources);

  const unknownDomain = (where: Authored, domain: string) => {
    if (!domains.has(domain)) {
      warnings.push(
        `${where.repository}/${where.file}: no event or service names domain '${domain}'`,
      );
    }
  };

  const glossaries: Glossary[] = [];
  const termOwners = new Map<string, string>();

  for (const { data, where } of readFolder(
    repositories,
    MODEL_DIRS.glossary,
    glossarySchema,
    failures,
  )) {
    const at = `${where.repository}/${where.file}`;

    const repeated = data.dictionary.find(
      (entry, index) => data.dictionary.findIndex((other) => other.id === entry.id) !== index,
    );

    if (repeated) {
      failures.push(`${at}: term '${repeated.id}' is defined twice`);
      continue;
    }

    // Two repositories may share a domain; one term has one definition in it.
    const clash = data.dictionary.find((entry) => termOwners.has(`${where.id}/${entry.id}`));

    if (clash) {
      failures.push(
        `${at}: term '${clash.id}' is already defined in ${termOwners.get(`${where.id}/${clash.id}`)}`,
      );
      continue;
    }

    for (const entry of data.dictionary) termOwners.set(`${where.id}/${entry.id}`, at);

    unknownDomain(where, where.id);
    glossaries.push({ ...where, domain: where.id, terms: data.dictionary });
  }

  const services = catalog.resources.filter(isServiceCatalogResource);
  const events = catalog.resources.filter(isEventCatalogResource);
  const entities: Entity[] = [];

  const entityDefinedIn = new Map<string, string>();

  for (const { data, where, dir } of readFolder(
    repositories,
    MODEL_DIRS.entities,
    entitySchema,
    failures,
  )) {
    const at = `${where.repository}/${where.file}`;
    const first = entityDefinedIn.get(where.id);

    // References and diagrams name an entity by id alone, across repositories.
    if (first) {
      failures.push(`${at}: entity '${where.id}' is already defined in ${first}`);
      continue;
    }

    entityDefinedIn.set(where.id, at);

    try {
      const properties = data.schema ? readSchema(dir, data.schema) : (data.properties ?? []);

      if (data.identifier && !properties.some((property) => property.name === data.identifier)) {
        throw new Error(`identifier '${data.identifier}' is not one of its properties`);
      }

      const held = data.services.map((name) => {
        const service = services.find((candidate) => candidate.ref.id === name);

        if (!service && !options.deferMissing) {
          throw new Error(`service '${name}' is not in the catalog`);
        }

        return { name, ...(service && { ref: service.ref }) };
      });

      const identifier = data.identifier;

      for (const domain of data.domains) unknownDomain(where, domain);

      entities.push({
        ...where,
        name: data.name,
        summary: data.summary,
        domains: data.domains,
        services: held,
        aggregateRoot: data.aggregateRoot,
        identifier,
        properties,
        carriedBy: identifier
          ? events
              .filter((event) => {
                const schema = event.attributes.payloadSchema ?? options.schemaOf?.(event);

                return (
                  schema !== undefined &&
                  [...fieldPaths(schema)].some((field) => field.split('.').at(-1) === identifier)
                );
              })
              .map((event) => event.ref)
          : [],
      });
    } catch (error) {
      failures.push(`${at}: ${problem(error instanceof Error ? error : String(error))}`);
    }
  }

  const entityIds = new Set(entities.map((entity) => entity.id));

  for (const entity of entities) {
    for (const missing of entityReferences(entity).filter((id) => !entityIds.has(id))) {
      warnings.push(
        `${entity.repository}/${entity.file}: references '${missing}', which no entities/ file defines`,
      );
    }
  }

  const productReads = readFolder(
    repositories,
    MODEL_DIRS.dataProducts,
    dataProductSchema,
    failures,
  );

  const productIds = new Set(productReads.map(({ where }) => where.id));
  const candidates: DataProduct[] = [];
  const definedIn = new Map<string, string>();

  for (const { data, where, dir } of productReads) {
    const at = `${where.repository}/${where.file}`;
    const first = definedIn.get(where.id);

    // `data-product/<id>` names one product across every repository.
    if (first) {
      failures.push(`${at}: data product '${where.id}' is already defined in ${first}`);
      continue;
    }

    definedIn.set(where.id, at);

    try {
      const port = (reference: string, contract?: string): DataProductPort => {
        if (contract) inside(dir, contract);

        if (reference.startsWith('data-product/')) {
          const id = reference.slice('data-product/'.length);

          if (!productIds.has(id)) throw new Error(`no data product '${id}' under data-products/`);

          if (id === where.id) throw new Error('a data product cannot feed itself');

          return { reference, contract };
        }

        const resolution = resolveAbout(reference, catalog.resources, where.repository);

        if ('failure' in resolution) {
          if (options.deferMissing && resolution.failure.includes('does not resolve')) {
            return { reference, contract };
          }

          throw new Error(resolution.failure.replace(/^about /, ''));
        }

        return { reference, ref: resolution.ref, contract };
      };

      if (data.domain) unknownDomain(where, data.domain);

      candidates.push({
        ...where,
        name: data.name,
        summary: data.summary,
        domain: data.domain,
        inputs: data.inputs.map((reference) => port(reference)),
        outputs: data.outputs.map(({ ref, contract }) => port(ref, contract)),
      });
    } catch (error) {
      failures.push(
        `${where.repository}/${where.file}: ${problem(error instanceof Error ? error : String(error))}`,
      );
    }
  }

  // A product fed by one that failed its checks would link to a page the site
  // does not publish, so it fails too, until every remaining link holds.
  const valid = new Set(candidates.map((product) => product.id));

  for (let changed = true; changed;) {
    changed = false;

    for (const product of candidates) {
      if (!valid.has(product.id)) continue;

      const broken = [...product.inputs, ...product.outputs]
        .flatMap(({ reference }) =>
          reference.startsWith('data-product/') ? [reference.slice('data-product/'.length)] : [],
        )
        .find((id) => !valid.has(id));

      if (broken) {
        valid.delete(product.id);
        failures.push(
          `${product.repository}/${product.file}: data product '${broken}' fails its own checks`,
        );
        changed = true;
      }
    }
  }

  const dataProducts = candidates.filter((product) => valid.has(product.id));

  const people: Person[] = [];
  const seen = new Map<string, string>();

  const directory = [
    ...readFolder(repositories, MODEL_DIRS.teams, teamSchema, failures).map((read) => ({
      ...read,
      kind: 'team' as const,
    })),
    ...readFolder(repositories, MODEL_DIRS.users, userSchema, failures).map((read) => ({
      ...read,
      kind: 'user' as const,
    })),
  ];

  for (const { data, where, kind } of directory) {
    const at = `${where.repository}/${where.file}`;
    const key = `${kind}/${where.id}`;
    const first = seen.get(key);

    // The directory is the organisation's, so one person is described once.
    if (first) {
      failures.push(`${at}: ${kind} '${where.id}' is already described in ${first}`);
      continue;
    }

    seen.set(key, at);
    people.push({
      ...where,
      kind,
      name: data.name,
      summary: 'summary' in data ? data.summary : undefined,
      role: 'role' in data ? data.role : undefined,
      avatarUrl: 'avatarUrl' in data ? data.avatarUrl : undefined,
      email: data.email,
      slackDirectMessageUrl: data.slackDirectMessageUrl,
      msTeamsDirectMessageUrl: data.msTeamsDirectMessageUrl,
      members: 'members' in data ? data.members : [],
    });
  }

  const users = new Set(people.flatMap((person) => (person.kind === 'user' ? [person.id] : [])));

  for (const team of people) {
    for (const member of team.members) {
      if (!users.has(member)) {
        warnings.push(
          `${team.repository}/${team.file}: member '${member}' has no users/${member}.md`,
        );
      }
    }
  }

  return { glossaries, entities, dataProducts, people, failures, warnings };
}

/** What a data product's port is called on its page: the resource's own name when it has one. */
export function portName(port: DataProductPort, catalog: { resources: CatalogResource[] }): string {
  const key = port.ref ? resourceKey(port.ref) : undefined;

  const found = key
    ? catalog.resources.find((resource) => resourceKey(resource.ref) === key)
    : undefined;

  return found?.title ?? port.reference.split('/').at(-1)!;
}

/** Every term a reader might look up, with the domain that defines it. */
export function lookupTerm(
  glossaries: Glossary[],
  query: string,
): Array<Term & { domain: string; repository: string }> {
  const wanted = query.trim().toLowerCase();

  return glossaries.flatMap((glossary) =>
    glossary.terms
      .filter(
        (entry) => entry.id.toLowerCase() === wanted || entry.name.toLowerCase().includes(wanted),
      )
      .map((entry) => ({ ...entry, domain: glossary.domain, repository: glossary.repository })),
  );
}

/** The entity ids an entity's properties reference, nested ones included. */
export function entityReferences(entity: Pick<Entity, 'properties'>): string[] {
  const walk = (properties: EntityProperty[]): string[] =>
    properties.flatMap((property) => [
      ...(property.references ? [property.references] : []),
      ...walk(property.properties ?? []),
    ]);

  return walk(entity.properties);
}

/** An entity's relationships as a Mermaid ER diagram: what references what. */
export function entityDiagram(entities: Entity[]): string | null {
  const ids = new Set(entities.map((entity) => entity.id));
  const name = (id: string) => id.replace(/[^\w-]/g, '_');
  const lines: string[] = [];
  const drawn = new Set<string>();

  for (const entity of entities) {
    const walk = (properties: EntityProperty[]) => {
      for (const property of properties) {
        if (property.references && ids.has(property.references)) {
          const many = property.type === 'array' || /many/i.test(property.relationType ?? '');

          lines.push(
            `  ${name(entity.id)} ${many ? '||--o{' : '}o--||'} ${name(property.references)} : "${property.name}"`,
          );
          drawn.add(entity.id).add(property.references);
        }

        walk(property.properties ?? []);
      }
    };

    walk(entity.properties);
  }

  if (lines.length === 0) return null;

  // Each entity under its own name, which may hold spaces an id cannot.
  const labels = entities.flatMap((entity) =>
    drawn.has(entity.id) ? [`  ${name(entity.id)}["${entity.name.replace(/"/g, "'")}"]`] : [],
  );

  return ['erDiagram', ...labels, ...lines].join('\n');
}

/**
 * A data product as a map: what feeds it on the left, what it publishes on the
 * right. Another data product on either side is drawn as one, keyed
 * `data-product/<id>`, so the site can link it.
 */
export function dataProductDiagram(
  product: DataProduct,
  catalog: { resources: CatalogResource[] },
): Pick<Diagram, 'nodes' | 'edges'> {
  const self = `data-product/${product.id}`;

  const nodes = new Map<string, DiagramNode>([
    [
      self,
      {
        id: self,
        type: 'data-product',
        label: product.name,
        metadata: { ...(product.summary && { summary: product.summary }) },
      },
    ],
  ]);

  const node = (port: DataProductPort): string => {
    const id = port.ref ? resourceKey(port.ref) : port.reference;

    const type = port.ref
      ? (DIAGRAM_NODE_TYPES.get(port.ref.kind) ?? 'external-system')
      : port.reference.startsWith('data-product/')
        ? 'data-product'
        : 'external-system';

    nodes.set(id, { id, type, label: portName(port, catalog), metadata: {} });

    return id;
  };

  const edges = [
    ...product.inputs.map((port) => {
      const source = node(port);

      return {
        id: `${source}->${self}`,
        source,
        target: self,
        type: 'reads-from' as const,
        label: 'feeds',
      };
    }),
    ...product.outputs.map((port) => {
      const target = node(port);

      return {
        id: `${self}->${target}`,
        source: self,
        target,
        type: 'writes-to' as const,
        label: 'publishes',
      };
    }),
  ];

  return { nodes: [...nodes.values()], edges };
}
