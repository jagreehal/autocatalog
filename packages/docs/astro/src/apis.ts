import {
  apiOperations as operationsOf,
  buildServices,
  declaredApiService,
  isJsonObject,
  publishedApis,
  type JsonValue,
  type RepositoryApi,
  type ServiceSummary,
} from 'autocatalog-core';
import { z } from 'zod';
import type { CatalogEvent } from './catalog';
import type { ApiPageProps, ApisPageProps } from './ui/pages';

/** An OpenAPI document a repository commits, with the page it gets. */
export interface CatalogApi extends RepositoryApi {
  /**
   * The services that serve it, as the catalog settled them against the lock.
   * Pages read this once it is set, so they show what the graph holds.
   */
  services?: string[];
}

export const repositoryApis = publishedApis;

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Where an API's page lives on the site, relative to its base. */
export const apiPath = (api: CatalogApi) => `apis/${api.repository}/${api.name}/`;

const info = (api: CatalogApi) => (isJsonObject(api.document.info) ? api.document.info : {});

const text = (value: JsonValue | undefined) => z.string().min(1).safeParse(value).data;

/** The spec's own title, else its file. */
export const apiTitle = (api: CatalogApi) => text(info(api).title) ?? api.file;

export const apiDescription = (api: CatalogApi) => text(info(api).description);

/** The description's first line, for a card or a list. */
export const apiSummary = (api: CatalogApi) =>
  apiDescription(api)?.split('\n')[0]?.trim() || undefined;

/**
 * The APIs a service serves: one whose spec names it in `x-autocatalog.service`.
 * Failing that, one whose title names it ("Payments Service API" for
 * payments-service), or whose webhooks are events the service produces.
 */
export function apisForService(
  apis: CatalogApi[],
  events: CatalogEvent[],
  service: string,
): CatalogApi[] {
  return apis.filter((api) => {
    if (api.services) return api.services.includes(service);

    const declared = declaredApiService(api.document);

    if (declared) return declared === service;

    return (
      slug(apiTitle(api)).replace(/-api$/, '') === slug(service) ||
      events.some(
        ({ repository, event }) =>
          repository === api.repository &&
          event.frontmatter.source?.file === api.file &&
          event.frontmatter.producers.includes(service),
      )
    );
  });
}

/** Every service with a page: those the events name, then those only a spec names. */
export function catalogServices({
  events,
  apis,
}: {
  events: CatalogEvent[];
  apis: CatalogApi[];
}): Map<string, ServiceSummary> {
  const services = buildServices(events.map(({ event }) => event));

  for (const api of apis) {
    const declared = declaredApiService(api.document);

    for (const name of api.services ?? (declared ? [declared] : []))
      if (!services.has(name))
        services.set(name, { name, domains: [], produces: [], consumes: [] });
  }

  return services;
}

/** The services that serve one API, by the same rule. */
export function servicesForApi(api: CatalogApi, events: CatalogEvent[]): string[] {
  if (api.services) return api.services;

  const declared = declaredApiService(api.document);

  if (declared) return [declared];

  return [...buildServices(events.map(({ event }) => event)).keys()].filter(
    (name) => apisForService([api], events, name).length > 0,
  );
}

/** Each operation in path order, as the reference lists them. */
export function apiOperations(api: CatalogApi): ApiPageProps['operations'] {
  return operationsOf(api.document).map(({ method, path, summary, operationId, deprecated }) => ({
    method,
    path,
    summary: summary ?? operationId,
    deprecated,
  }));
}

export function apiPageProps(
  api: CatalogApi,
  services: string[],
  base: string,
  outside = false,
): ApiPageProps {
  return {
    outside,
    version: text(info(api).version),
    repository: api.repository,
    file: api.file,
    specHref: `${base}${apiPath(api)}openapi.json`,
    services: services.map((name) => ({ name, href: `${base}services/${name}/` })),
    operations: apiOperations(api),
  };
}

export function apisPageProps(apis: CatalogApi[], base: string, outside = false): ApisPageProps {
  return {
    outside,
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
