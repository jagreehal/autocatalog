import fs from 'node:fs';
import path from 'node:path';
import {
  buildServices,
  findOpenApiDocuments,
  isJsonObject,
  METHODS,
  type JsonObject,
  type JsonValue,
} from 'autocatalog-core';
import { z } from 'zod';
import type { CatalogEvent } from './catalog';
import type { ApiPageProps, ApisPageProps } from './ui/pages';

/** An OpenAPI document a repository commits, with the page it gets. */
export interface CatalogApi {
  repository: string;
  /** Its page's segment: the spec's path under contracts/, as one slug. */
  name: string;
  /** Where the repository keeps it, from the repository's root. */
  file: string;
  document: JsonObject;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Where the scan looks for contracts, and so where a published spec lives. */
const CONTRACTS = 'contracts';

/**
 * The OpenAPI 3 documents a repository commits under contracts/, read by the
 * same scan that turns their webhooks into events. A spec that fails to parse
 * becomes a build warning, and the rest of the repository still publishes.
 */
export async function repositoryApis(
  repository: string,
  repositoryRoot: string,
  warn: (message: string) => void,
): Promise<CatalogApi[]> {
  const root = path.join(repositoryRoot, CONTRACTS);

  // A real directory only: a symlink could point anywhere on the build machine,
  // and the spec gets published.
  if (!fs.lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];

  const { documents, errors } = await findOpenApiDocuments({ root });

  for (const error of errors) warn(`${repository}: ${CONTRACTS}/${error}`);

  // Named from the path without its extension; specs that share that name keep
  // the extension, then a number, so each one gets its own page.
  const bare = (relFile: string) => slug(relFile.replace(/\.(ya?ml|json)$/i, ''));

  const shared = new Set(
    documents.map(({ relFile }) => bare(relFile)).filter((name, i, all) => all.indexOf(name) !== i),
  );

  const taken = new Set<string>();

  return [...documents]
    .sort((a, b) => a.relFile.localeCompare(b.relFile))
    .map(({ relFile, doc }) => {
      let name = shared.has(bare(relFile)) ? slug(relFile) : bare(relFile);

      for (let n = 2; taken.has(name); n += 1) name = `${slug(relFile)}-${n}`;
      taken.add(name);

      return { repository, name, file: `${CONTRACTS}/${relFile}`, document: doc };
    });
}

/** Where an API's page lives on the site, relative to its base. */
export const apiPath = (api: CatalogApi) => `apis/${api.repository}/${api.name}/`;

const info = (api: CatalogApi) => (isJsonObject(api.document.info) ? api.document.info : {});

const text = (value: JsonValue | undefined) => z.string().min(1).safeParse(value).data;

/** The spec's own title, else its file. */
export const apiTitle = (api: CatalogApi) => text(info(api).title) ?? api.file;

export const apiDescription = (api: CatalogApi) => text(info(api).description);

/**
 * The APIs a service serves: one whose title names it ("Payments Service API"
 * for payments-service), or one whose webhooks are events the service produces.
 */
export function apisForService(
  apis: CatalogApi[],
  events: CatalogEvent[],
  service: string,
): CatalogApi[] {
  return apis.filter(
    (api) =>
      slug(apiTitle(api)).replace(/-api$/, '') === slug(service) ||
      events.some(
        ({ repository, event }) =>
          repository === api.repository &&
          event.frontmatter.source?.file === api.file &&
          event.frontmatter.producers.includes(service),
      ),
  );
}

/** The services that serve one API, by the same rule. */
export function servicesForApi(api: CatalogApi, events: CatalogEvent[]): string[] {
  return [...buildServices(events.map(({ event }) => event)).keys()].filter(
    (name) => apisForService([api], events, name).length > 0,
  );
}

/** Each operation in path order, as the reference lists them. */
export function apiOperations(api: CatalogApi): ApiPageProps['operations'] {
  const paths = isJsonObject(api.document.paths) ? api.document.paths : {};

  return Object.entries(paths).flatMap(([route, item]) =>
    METHODS.flatMap((method) => {
      const operation = isJsonObject(item) ? item[method] : undefined;

      if (!isJsonObject(operation)) return [];

      return [
        {
          method: method.toUpperCase(),
          path: route,
          summary: text(operation.summary) ?? text(operation.operationId),
          deprecated: operation.deprecated === true,
        },
      ];
    }),
  );
}

export function apiPageProps(api: CatalogApi, services: string[], base: string): ApiPageProps {
  return {
    version: text(info(api).version),
    repository: api.repository,
    file: api.file,
    specHref: `${base}${apiPath(api)}openapi.json`,
    services: services.map((name) => ({ name, href: `${base}services/${name}/` })),
    operations: apiOperations(api),
  };
}

export function apisPageProps(apis: CatalogApi[], base: string): ApisPageProps {
  return {
    apis: apis.map((api) => ({
      title: apiTitle(api),
      version: text(info(api).version),
      repository: api.repository,
      file: api.file,
      href: `${base}${apiPath(api)}`,
      operations: apiOperations(api).length,
    })),
  };
}
