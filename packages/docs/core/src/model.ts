import fs from 'node:fs';
import path from 'node:path';
import {
  compareSemverish,
  fieldPaths,
  isEventCatalogResource,
  isJsonObject,
  isServiceCatalogResource,
  parseFrontmatter,
  AUTOCATALOG_GRAPH_SPEC,
  type CatalogRelationship,
  type CatalogResource,
  type JsonObject,
  resourceKey,
  type ResourceGraph,
  type ResourceRef,
} from 'autocatalog-core';
import { z } from 'zod';
import { resolveAbout } from './about';
import { DIAGRAM_NODE_TYPES, type Diagram, type DiagramNode } from './diagram';
import { inside } from './inside';
import {
  ODCS_FILE,
  type OdcsContract,
  readOdcs,
  readTrackRecord,
  type TrackRecord,
  trackRecordFile,
} from './odcs';
import { type Lifecycle, lifecyclesSchema } from './lifecycles';
import { ODPS_FILE, type OdpsProduct, readOdps } from './odps';

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
  /** Other words teams use for it: `onboarding`, `KYC`, `sign-up`. */
  aliases: z.array(z.string().min(1)).optional(),
  /** What implements it, named as a document's `about:` names a resource: `service/PaymentService`. */
  about: z.array(z.string().min(1)).optional(),
});

/** A term, with what its `about:` resolved to in the composed catalog. */
export type Term = z.output<typeof term> & { refs: ResourceRef[] };

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
    lifecycles: lifecyclesSchema.default({}),
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
  /** The states each lifecycle field moves through, by field. */
  lifecycles: Record<string, Lifecycle>;
}

const portSchema = z.union([
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
    inputs: z.array(portSchema).default([]),
    outputs: z.array(portSchema).default([]),
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
  /**
   * Relative to the repository. On an output, the contract it keeps; on an
   * input, what this product expects of it (a consumer-driven contract).
   */
  contract?: string | undefined;
  /** The repository `contract` is in, when it is not the product's own: an ODPS input names its provider's. */
  contractRepository?: string | undefined;
  /** The contract an ODPS port names, as written: its id may hold any character, `@` included. */
  pin?: { contractId: string; version?: string | undefined } | undefined;
  /** An ODPS port's name; `rawtransactions`. */
  name?: string | undefined;
  /** The contract, read, when it is an ODCS file (`*.odcs.yaml`). */
  odcs?: OdcsContract | undefined;
  /** An output's track record, from the results file beside its ODCS contract. */
  trackRecord?: TrackRecord | undefined;
}

/** Data a team publishes for others to use: `data-products/<id>.md`, or `<id>.odps.yaml` in ODPS. */
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
export function readFolder<T extends z.ZodType>(
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

export interface ReadDomainModelOptions {
  /**
   * Keep references the catalog does not have, unresolved: `ac docs check`
   * reads one repository's documents without every event they name.
   */
  deferMissing?: boolean;
  /**
   * Keep a pinned input no data product publishes, and the product that reads
   * it. Follows `deferMissing` unless set: consumer CI reads every checkout, so
   * it drops such products and resolves inputs the way the site does.
   */
  deferUnpublished?: boolean;
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
    glossaries.push({
      ...where,
      domain: where.id,
      terms: data.dictionary.map((entry) => ({
        ...entry,
        refs: (entry.about ?? []).flatMap((reference) => {
          const resolved = resolveAbout(reference, catalog.resources, where.repository);

          if ('ref' in resolved) return [resolved.ref];
          warnings.push(`${at}: term '${entry.id}' ${resolved.failure}`);

          return [];
        }),
      })),
    });
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
        lifecycles: data.lifecycles,
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

  const odpsReads = readOdpsFolder(repositories, failures);
  const productIds = new Set([...productReads, ...odpsReads].map(({ where }) => where.id));
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
      const port = (reference: string, contract?: string, output = false): DataProductPort => {
        const contractFacts = contract ? readContract(dir, contract, output) : {};

        if (reference.startsWith('data-product/')) {
          const id = reference.slice('data-product/'.length);

          if (!productIds.has(id)) throw new Error(`no data product '${id}' under data-products/`);

          if (id === where.id) throw new Error('a data product cannot feed itself');

          return { reference, contract, ...contractFacts };
        }

        const resolution = resolveAbout(reference, catalog.resources, where.repository);

        if ('failure' in resolution) {
          if (options.deferMissing && resolution.failure.includes('does not resolve')) {
            return { reference, contract, ...contractFacts };
          }

          throw new Error(resolution.failure.replace(/^about /, ''));
        }

        return { reference, ref: resolution.ref, contract, ...contractFacts };
      };

      if (data.domain) unknownDomain(where, data.domain);

      candidates.push({
        ...where,
        name: data.name,
        summary: data.summary,
        domain: data.domain,
        inputs: data.inputs.map(({ ref, contract }) => port(ref, contract)),
        outputs: data.outputs.map(({ ref, contract }) => port(ref, contract, true)),
      });
    } catch (error) {
      failures.push(
        `${where.repository}/${where.file}: ${problem(error instanceof Error ? error : String(error))}`,
      );
    }
  }

  const contracts = odpsReads.length
    ? contractIndex(repositories)
    : new Map<string, IndexedContract[]>();

  for (const { data, where } of odpsReads) {
    const at = `${where.repository}/${where.file}`;
    const first = definedIn.get(where.id);

    if (first) {
      failures.push(`${at}: data product '${where.id}' is already defined in ${first}`);
      continue;
    }

    definedIn.set(where.id, at);

    try {
      const port = (
        { name, version, contractId }: OdpsProduct['outputPorts'][number],
        output: boolean,
      ): DataProductPort => {
        const at = version ? `@${version}` : '';

        if (!contractId) return { reference: `port/${name}${at}`, name };

        const reference = `contract/${contractId}${at}`;
        const pin = { contractId, version };

        const found = findContract(
          contracts,
          contractId,
          version,
          output ? where.repository : undefined,
        );

        if (!found) {
          if (!output && options.deferMissing) return { reference, name, pin };

          throw new Error(
            `${output ? 'output' : 'input'} port '${name}' names contract ${contractId}${version ? ` ${version}` : ''}, which no *.odcs.yaml in ${output ? 'this repository' : 'the repositories read'} declares`,
          );
        }

        return {
          reference,
          name,
          pin,
          contract: found.file,
          ...(found.repository !== where.repository && { contractRepository: found.repository }),
          ...(output ? readContract(found.dir, found.file, true) : { odcs: found.odcs }),
        };
      };

      if (data.domain) unknownDomain(where, data.domain);

      candidates.push({
        ...where,
        name: data.name ?? where.id,
        summary: data.description?.purpose,
        domain: data.domain,
        inputs: data.inputPorts.map((p) => port(p, false)),
        outputs: data.outputPorts.map((p) => port(p, true)),
      });
    } catch (error) {
      failures.push(`${at}: ${problem(error instanceof Error ? error : String(error))}`);
    }
  }

  // An ODPS input reads what a data product publishes: that exact version when
  // pinned, else the newest. A raw file no output keeps, a draft or a copy in
  // another checkout, is not what it consumes, whichever repository is read first.
  const bare = (v: string) => v.replace(/^v/, '');

  const pinned = candidates.flatMap((consumer) =>
    consumer.inputs.flatMap((input) =>
      input.pin ? [{ consumer, input, read: { ...input } }] : [],
    ),
  );

  const valid = new Set(candidates.map((product) => product.id));

  // Resolve against the products still standing, drop those that fail on their
  // own, and resolve again: a dropped provider must not hide a version another keeps.
  for (let changed = true; changed;) {
    const published = candidates.flatMap((product) =>
      valid.has(product.id)
        ? product.outputs.flatMap((output) =>
            output.odcs && output.contract && !output.contractRepository
              ? [{ product, output, odcs: output.odcs }]
              : [],
          )
        : [],
    );

    for (const { consumer, input, read } of pinned) {
      const { contractId: id, version } = read.pin!;

      const match = published
        .filter(
          (p) =>
            p.product !== consumer &&
            p.odcs.id === id &&
            (version === undefined || bare(p.odcs.version) === bare(version)),
        )
        .sort((a, b) => compareSemverish(b.odcs.version, a.odcs.version))[0];

      Object.assign(
        input,
        match
          ? {
              reference: `data-product/${match.product.id}`,
              contract: match.output.contract,
              odcs: match.odcs,
              contractRepository:
                match.product.repository === consumer.repository
                  ? undefined
                  : match.product.repository,
            }
          : read,
      );
    }

    const failing: string[] = [];

    for (const product of candidates) {
      if (!valid.has(product.id)) continue;

      // A pinned input no data product publishes promises nothing; `ac docs check`
      // reads one repository, so it defers what the others may publish.
      const unpublished =
        (options.deferUnpublished ?? options.deferMissing)
          ? undefined
          : product.inputs.find((port) => port.pin && !port.reference.startsWith('data-product/'));

      // A product fed by one that failed its checks would link to a page the site
      // does not publish, so it fails too, until every remaining link holds.
      const broken = [...product.inputs, ...product.outputs]
        .flatMap(({ reference }) =>
          reference.startsWith('data-product/') ? [reference.slice('data-product/'.length)] : [],
        )
        .find((id) => !valid.has(id));

      if (unpublished?.pin) {
        const { contractId, version } = unpublished.pin;

        failures.push(
          `${product.repository}/${product.file}: input port '${unpublished.name}' reads contract ${contractId}${version ? ` ${version}` : ''}, which no data product publishes`,
        );
      } else if (broken) {
        failures.push(
          `${product.repository}/${product.file}: data product '${broken}' fails its own checks`,
        );
      } else continue;

      failing.push(product.id);
    }

    for (const id of failing) valid.delete(id);
    changed = failing.length > 0;
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

/**
 * A port's contract file: checked to be inside the repository, and read when
 * it is ODCS. An output's track record comes from the results file beside it,
 * when there is one; a results file that does not read is ignored line by line.
 */
function readContract(
  dir: string,
  contract: string,
  output: boolean,
): Pick<DataProductPort, 'odcs' | 'trackRecord'> {
  const full = inside(dir, contract);

  if (!ODCS_FILE.test(contract)) return {};
  const odcs = readOdcs(fs.readFileSync(full, 'utf8'));
  const results = trackRecordFile(full);

  if (!output || !fs.lstatSync(results, { throwIfNoEntry: false })?.isFile()) return { odcs };

  const { unreadable: _unreadable, ...trackRecord } = readTrackRecord(
    fs.readFileSync(inside(dir, path.relative(dir, results)), 'utf8'),
    odcs,
  );

  return { odcs, trackRecord };
}

/** `*.odps.yaml` at each repository's root and in `data-products/`; the file name is the product's id. */
function readOdpsFolder(
  repositories: Array<{ repository: string; dir: string }>,
  failures: string[],
): Array<{ data: OdpsProduct; where: Authored; dir: string }> {
  const found: Array<{ data: OdpsProduct; where: Authored; dir: string }> = [];

  for (const { repository, dir } of repositories)
    for (const folder of ['', MODEL_DIRS.dataProducts]) {
      const full = path.join(dir, folder);

      if (!fs.lstatSync(full, { throwIfNoEntry: false })?.isDirectory()) continue;

      for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
        if (!entry.isFile() || !ODPS_FILE.test(entry.name)) continue;

        const file = folder ? `${folder}/${entry.name}` : entry.name;
        const id = entry.name.replace(ODPS_FILE, '');

        try {
          if (!ID.test(id)) {
            throw new Error(
              `'${id}' cannot be a page's address; use letters, digits, '.', '-' and '_'`,
            );
          }

          found.push({
            data: readOdps(fs.readFileSync(path.join(full, entry.name), 'utf8')),
            where: { repository, id, file, body: '' },
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

interface IndexedContract {
  repository: string;
  dir: string;
  /** Relative to the repository. */
  file: string;
  odcs: OdcsContract;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', 'coverage']);

/** Every ODCS contract each repository keeps, by contract id. A file that does not read is left out. */
function contractIndex(
  repositories: Array<{ repository: string; dir: string }>,
): Map<string, IndexedContract[]> {
  const index = new Map<string, IndexedContract[]>();

  for (const { repository, dir } of repositories) {
    const walk = (at: string) => {
      for (const entry of fs.readdirSync(path.join(dir, at), { withFileTypes: true })) {
        const file = at ? `${at}/${entry.name}` : entry.name;

        if (entry.isDirectory() && !SKIP.has(entry.name)) walk(file);

        if (!entry.isFile() || !ODCS_FILE.test(entry.name)) continue;

        try {
          const odcs = readOdcs(fs.readFileSync(path.join(dir, file), 'utf8'));
          index.set(odcs.id, [...(index.get(odcs.id) ?? []), { repository, dir, file, odcs }]);
        } catch {
          // `ac from-odcs` lints every contract; here it is only not found.
        }
      }
    };

    if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk('');
  }

  return index;
}

/** The contract a port names: exactly its version when it gives one, else the newest. */
function findContract(
  index: Map<string, IndexedContract[]>,
  id: string,
  version: string | undefined,
  repository: string | undefined,
): IndexedContract | undefined {
  const bare = (v: string) => v.replace(/^v/, '');

  const candidates = (index.get(id) ?? []).filter(
    (c) => repository === undefined || c.repository === repository,
  );

  if (version !== undefined) return candidates.find((c) => bare(c.odcs.version) === bare(version));

  return candidates.sort((a, b) => compareSemverish(b.odcs.version, a.odcs.version))[0];
}

/** What a data product's port is called on its page: the resource's own name when it has one. */
export function portName(port: DataProductPort, catalog: { resources: CatalogResource[] }): string {
  const key = port.ref ? resourceKey(port.ref) : undefined;

  const found = key
    ? catalog.resources.find((resource) => resourceKey(resource.ref) === key)
    : undefined;

  return found?.title ?? port.name ?? port.reference.split('/').at(-1)!;
}

/** Every term a reader might look up, by id, name or alias, with the domain that defines it. */
export function lookupTerm(
  glossaries: Glossary[],
  query: string,
): Array<Term & { domain: string; repository: string }> {
  const wanted = query.trim().toLowerCase();

  return glossaries.flatMap((glossary) =>
    glossary.terms
      .filter(
        (entry) =>
          entry.id.toLowerCase() === wanted ||
          entry.name.toLowerCase().includes(wanted) ||
          (entry.aliases ?? []).some((alias) => alias.toLowerCase() === wanted),
      )
      .map((entry) => ({ ...entry, domain: glossary.domain, repository: glossary.repository })),
  );
}

/**
 * Each term as a `term` resource, with a `describes` edge to what implements
 * it, so an agent reading `/catalog.json` can go from the words a team uses
 * to the services and events behind them.
 */
export function glossaryGraph(
  glossaries: Glossary[],
  /** Where a term is defined on the site, when there is one. */
  urlOf?: (domain: string, term: string) => string,
): ResourceGraph {
  const resources: CatalogResource[] = [];
  const relationships: CatalogRelationship[] = [];

  for (const glossary of glossaries) {
    for (const entry of glossary.terms) {
      const ref: ResourceRef<'term'> = {
        kind: 'term',
        namespace: `${glossary.repository}/${glossary.domain}`,
        id: entry.id,
      };

      const source = { repo: glossary.repository, file: glossary.file };

      resources.push({
        ref,
        title: entry.name,
        ...(entry.summary && { summary: entry.summary }),
        ...(urlOf && { url: urlOf(glossary.domain, entry.id) }),
        tags: [],
        provenance: { default: 'declared', fields: {} },
        needsReview: false,
        source,
        attributes: { domain: glossary.domain, aliases: entry.aliases ?? [] },
      });

      for (const to of entry.refs) {
        relationships.push({
          type: 'describes',
          from: ref,
          to,
          provenance: 'declared',
          needsReview: false,
          source,
        });
      }
    }
  }

  return { spec: AUTOCATALOG_GRAPH_SPEC, resources, relationships };
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
