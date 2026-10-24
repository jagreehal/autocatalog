import fs from 'node:fs';
import path from 'node:path';
import { buildServices, isJsonObject, type JsonValue } from 'autocatalog-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { CatalogEvent } from './catalog';
import type { SpecificationPageProps, SpecificationsPageProps } from './ui/pages';

/**
 * A specification a repository commits that is neither an event contract nor
 * an OpenAPI document, such as a WSDL, an XML Schema or an AsyncAPI document,
 * published as written.
 */
export interface CatalogSpecification {
  repository: string;
  /** Its page's segment: the file's path under contracts/, as one slug. */
  name: string;
  /** Where the repository keeps it, from the repository's root. */
  file: string;
  format: string;
  /** A microlighter grammar for its source, or `text`. */
  language: string;
  title: string;
  summary?: string | undefined;
  /** The services its sidecar says it belongs to. */
  services: string[];
  source: string;
}

/** Formats known by extension: a file with one of these is a specification. */
const BY_EXTENSION = new Map([
  ['.wsdl', { format: 'WSDL', language: 'html' }],
  ['.xsd', { format: 'XML Schema', language: 'html' }],
  ['.xml', { format: 'XML', language: 'html' }],
  ['.graphql', { format: 'GraphQL', language: 'graphql' }],
  ['.gql', { format: 'GraphQL', language: 'graphql' }],
  ['.raml', { format: 'RAML', language: 'yaml' }],
]);

/** JSON and YAML say nothing by their extension: one is a specification when it declares AsyncAPI, or its sidecar declares it. */
const BY_CONTENT = new Map([
  ['.json', { format: 'JSON', language: 'json' }],
  ['.yaml', { format: 'YAML', language: 'yaml' }],
  ['.yml', { format: 'YAML', language: 'yaml' }],
]);

/** A specification larger than this is left out, with a warning: a page of it would be unreadable. */
const MAX_BYTES = 1024 * 1024;

const CONTRACTS = 'contracts';

/** `<name>.autocatalog.json` beside the file, as for a JSON Schema: `{ "specification": { … } }`. */
const sidecarSchema = z.object({
  specification: z
    .object({
      name: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      service: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    })
    .strict(),
});

type Sidecar = z.infer<typeof sidecarSchema>['specification'];

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Regular files under a directory, skipping symlinks: one could name any file
 * on the build machine. A folder that cannot be read is named and skipped.
 */
function files(dir: string, root: string, warn: (message: string) => void): string[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    warn(
      `${path.relative(root, dir) || '.'}: not searched for specifications — ${error instanceof Error ? error.message : String(error)}`,
    );

    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : files(full, root, warn);

    return entry.isFile() ? [full] : [];
  });
}

function readSidecar(file: string, warn: (message: string) => void, where: string) {
  const sidecar = path.join(
    path.dirname(file),
    `${path.basename(file, path.extname(file))}.autocatalog.json`,
  );

  if (!fs.lstatSync(sidecar, { throwIfNoEntry: false })?.isFile()) return undefined;

  let raw: JsonValue;

  try {
    raw = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  } catch (error) {
    warn(`${where}: ${error instanceof Error ? error.message : String(error)}`);

    return undefined;
  }

  // A JSON Schema's sidecar describes an event, not a specification.
  if (!isJsonObject(raw) || !('specification' in raw)) return undefined;

  const parsed = sidecarSchema.safeParse(raw);

  if (!parsed.success) {
    warn(`${where}: ${z.prettifyError(parsed.error)}`);

    return undefined;
  }

  return parsed.data.specification;
}

const asyncApiSchema = z.object({
  asyncapi: z.string().regex(/^[23]\./),
  info: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
    })
    .optional(),
});

/**
 * The document as AsyncAPI, by its top-level `asyncapi` field, whatever its
 * layout: YAML reads JSON too. Undefined for anything else.
 */
function asAsyncApi(source: string) {
  try {
    return asyncApiSchema.safeParse(parseYaml(source)).data;
  } catch {
    return undefined;
  }
}

/**
 * The specifications a repository commits under contracts/. A WSDL, XML
 * Schema, XML, GraphQL or RAML file is one by its extension, a JSON or YAML file
 * when it declares AsyncAPI or its sidecar declares a specification. One that
 * cannot be read becomes a build warning, and the rest still publish.
 */
export function repositorySpecifications(
  repository: string,
  repositoryRoot: string,
  warn: (message: string) => void,
): CatalogSpecification[] {
  const root = path.join(repositoryRoot, CONTRACTS);

  if (!fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];

  const found = files(root, repositoryRoot, (message) => warn(`${repository}: ${message}`)).flatMap(
    (full) => {
      const file = `${CONTRACTS}/${path.relative(root, full).split(path.sep).join('/')}`;
      const where = `${repository}: ${file}`;
      const extension = path.extname(full).toLowerCase();
      const known = BY_EXTENSION.get(extension);
      const ambiguous = BY_CONTENT.get(extension);

      if ((!known && !ambiguous) || full.endsWith('.autocatalog.json')) return [];

      const sidecar: Sidecar | undefined = readSidecar(full, warn, where);

      let source: string;

      // One file that cannot be read leaves out that file, not its neighbours.
      try {
        if (fs.statSync(full).size > MAX_BYTES) {
          if (known || sidecar) warn(`${where}: larger than 1 MB, so it is not published`);

          return [];
        }

        source = fs.readFileSync(full, 'utf8');
      } catch (error) {
        if (known || sidecar)
          warn(
            `${where}: not read, so it is not published — ${error instanceof Error ? error.message : String(error)}`,
          );

        return [];
      }

      const asyncApi = ambiguous && asAsyncApi(source);

      if (!known && !asyncApi && !sidecar) return [];

      if (source.includes('\0')) {
        warn(`${where}: not a text file, so it is not published`);

        return [];
      }

      const info = asyncApi ? asyncApi.info : undefined;
      const { format, language } = known ?? ambiguous!;

      return [
        {
          repository,
          file,
          format: asyncApi ? 'AsyncAPI' : format,
          language,
          title: sidecar?.name ?? info?.title ?? path.basename(file),
          summary: sidecar?.summary ?? info?.description,
          services: [sidecar?.service ?? []].flat(),
          source,
        },
      ];
    },
  );

  // Named from the path without its extension; files that share that name
  // keep the extension, then a number, so each one gets its own page.
  const full = (file: string) => slug(file.slice(CONTRACTS.length + 1));
  const bare = (file: string) => slug(file.slice(CONTRACTS.length + 1).replace(/\.[^.]+$/, ''));

  const shared = new Set(
    found.map(({ file }) => bare(file)).filter((name, i, all) => all.indexOf(name) !== i),
  );

  const taken = new Set<string>();

  return found
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((spec) => {
      let name = shared.has(bare(spec.file)) ? full(spec.file) : bare(spec.file);

      for (let n = 2; taken.has(name); n += 1) name = `${full(spec.file)}-${n}`;
      taken.add(name);

      return { ...spec, name };
    });
}

/** Where a specification's page lives on the site, relative to its base. */
export const specificationPath = (spec: CatalogSpecification) =>
  `specs/${spec.repository}/${spec.name}/`;

/** The file itself, under its own name, beside its page. */
export const specificationFilePath = (spec: CatalogSpecification) =>
  `${specificationPath(spec)}${path.posix.basename(spec.file)}`;

/**
 * The services a specification belongs to: the ones its sidecar names, and
 * one its title names ("Shipping Service" for shipping-service), as for an API.
 */
export function servicesForSpecification(
  spec: CatalogSpecification,
  events: CatalogEvent[],
): string[] {
  // Only services with a page: one the sidecar names that no event mentions is
  // reported by the build, not linked to.
  return [...buildServices(events.map(({ event }) => event)).keys()]
    .filter(
      (name) =>
        spec.services.includes(name) || slug(spec.title).replace(/-api$/, '') === slug(name),
    )
    .sort();
}

export function specificationsForService(
  specs: CatalogSpecification[],
  events: CatalogEvent[],
  service: string,
): CatalogSpecification[] {
  return specs.filter((spec) => servicesForSpecification(spec, events).includes(service));
}

export function specificationPageProps(
  spec: CatalogSpecification,
  events: CatalogEvent[],
  base: string,
): SpecificationPageProps {
  return {
    format: spec.format,
    language: spec.language,
    repository: spec.repository,
    file: spec.file,
    source: spec.source,
    downloadHref: `${base}${specificationFilePath(spec)}`,
    services: servicesForSpecification(spec, events).map((name) => ({
      name,
      href: `${base}services/${name}/`,
    })),
  };
}

export function specificationsPageProps(
  specs: CatalogSpecification[],
  base: string,
): SpecificationsPageProps {
  return {
    specifications: specs.map((spec) => ({
      title: spec.title,
      format: spec.format,
      repository: spec.repository,
      file: spec.file,
      href: `${base}${specificationPath(spec)}`,
    })),
  };
}
