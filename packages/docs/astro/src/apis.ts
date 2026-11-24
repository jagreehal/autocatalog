import {
  apiOperations as operationsOf,
  buildServices,
  declaredApiService,
  isJsonObject,
  isServiceCatalogResource,
  publishedApis,
  servicesServing,
} from 'autocatalog-core';
import type { JsonValue, RepositoryApi, ResourceGraph, ServiceSummary } from 'autocatalog-core';
import { z } from 'zod';
import type { CatalogEvent } from './catalog';
import type { ApiPageProps, ApisPageProps } from './ui/pages';

/** An OpenAPI document a repository commits, with the page it gets. */
export interface CatalogApi extends RepositoryApi {
  /**
   * The services that serve it, as the catalog settled them against the lock.
   * Pages read this once it is set, so they show what the graph holds.
   */
  services?: Array<string>;
}

export const repositoryApis = publishedApis;

const slug = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

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
  apis: Array<CatalogApi>,
  events: Array<CatalogEvent>,
  service: string,
): Array<CatalogApi> {
  return apis.filter((api) => {
    if (api.services) {
      return api.services.includes(service);
    }

    const declared = declaredApiService(api.document);

    if (declared) {
      return declared === service;
    }

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
  graph,
}: {
  events: Array<CatalogEvent>;
  apis: Array<CatalogApi>;
  /** Services the resource graph declares: a command's handler, a datastore's reader. */
  graph?: ResourceGraph | undefined;
}): Map<string, ServiceSummary> {
  const services = buildServices(events.map(({ event }) => event));

  for (const api of apis) {
    const declared = declaredApiService(api.document);

    for (const name of api.services ?? (declared ? [declared] : [])) {
      if (!services.has(name)) {
        services.set(name, { name, domains: [], produces: [], consumes: [] });
      }
    }
  }

  for (const resource of graph?.resources.filter(isServiceCatalogResource) ?? []) {
    const name = resource.ref.id;

    if (!services.has(name)) {
      services.set(name, {
        name,
        domains: [...resource.attributes.domains].sort(),
        produces: [],
        consumes: [],
      });
    }
  }

  return services;
}

/** The services that serve one API, as {@link servicesServing} settles them, with the lock's owners. */
export function servicesForApi(
  api: CatalogApi,
  events: Array<CatalogEvent>,
  owners?: ReadonlyMap<string, string>,
): Array<string> {
  if (api.services) {
    return api.services;
  }

  const matched = [...buildServices(events.map(({ event }) => event)).keys()].filter(
    (name) => apisForService([api], events, name).length > 0,
  );

  return servicesServing(api, matched, owners);
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
  services: Array<string>,
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

export function apisPageProps(
  apis: Array<CatalogApi>,
  base: string,
  outside = false,
): ApisPageProps {
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
