// The site as an MCP server: what a reader opens, an agent can search and read,
// and an API's operations come back as the exact shapes a request needs. Built
// from the catalog the page was rendered from, so an audience or `access` that
// narrows the site narrows this too.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pagesSource, rankPages } from 'autocatalog-chatbot';
import { isJsonObject, type JsonObject, type JsonValue } from 'autocatalog-core';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { apiTitle, type CatalogApi } from './apis';
import { componentRef } from './audience';
import type { DocsCatalog } from './catalog';
import { chatPages } from './chat';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export interface DocsMcpSite {
  title: string;
  description: string;
  /** Where the site is served, such as `https://developers.example.com`. */
  origin: string;
  /** The path the site is deployed under, ending in `/`. */
  base: string;
}

export interface McpOperation {
  /** The API's title, as its spec names it. */
  api: string;
  /** Which API, unique on the site: `<repository>/<name>`, as its page's address has it. */
  apiId: string;
  method: string;
  path: string;
  operationId?: string | undefined;
  summary?: string | undefined;
  tags: string[];
  deprecated: boolean;
}

const text = (value: JsonValue | undefined) => z.string().min(1).safeParse(value).data;

const strings = (value: JsonValue | undefined) => z.array(z.string()).catch([]).parse(value);

const objectOf = (value: JsonValue | undefined): JsonObject => (isJsonObject(value) ? value : {});

const listOf = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);

const apiIdOf = (api: CatalogApi) => `${api.repository}/${api.name}`;

/** The first non-empty `servers`: an operation's overrides its path's, which overrides the document's. */
const serversOf = (...levels: Array<JsonValue | undefined>) =>
  levels.map(listOf).find((servers) => servers.length > 0) ?? [];

/**
 * A path item with its `$ref` to `components.pathItems` followed, as OpenAPI 3.1
 * allows. Its own fields win over the target's; a cycle stops where it repeats.
 */
function pathItemOf(
  document: JsonObject,
  item: JsonValue | undefined,
  seen = new Set<string>(),
): JsonObject {
  const { $ref, ...own } = objectOf(item);
  const pointer = text($ref);
  const [kind, name] = componentRef(pointer ?? '') ?? [];

  if (!pointer || kind !== 'pathItems' || !name || seen.has(pointer)) return own;

  const target = objectOf(objectOf(document.components).pathItems)[name];

  return { ...pathItemOf(document, target, new Set([...seen, pointer])), ...own };
}

/** Every operation of every API on the site, in the order each spec lists them. */
export function listOperations(catalog: Pick<DocsCatalog, 'apis'>): McpOperation[] {
  return catalog.apis.flatMap((api) =>
    Object.entries(objectOf(api.document.paths)).flatMap(([path, item]) =>
      METHODS.flatMap((method) => {
        const operation = pathItemOf(api.document, item)[method];

        if (!isJsonObject(operation)) return [];

        return [
          {
            api: apiTitle(api),
            apiId: apiIdOf(api),
            method: method.toUpperCase(),
            path,
            operationId: text(operation.operationId),
            summary: text(operation.summary),
            tags: strings(operation.tags),
            deprecated: operation.deprecated === true,
          },
        ];
      }),
    ),
  );
}

/** The components a value points at with `$ref`, and the ones those point at, once each. */
export function referencedComponents(value: JsonValue, document: JsonObject) {
  const components: Record<string, JsonObject> = {};

  const visit = (node: JsonValue) => {
    if (Array.isArray(node)) return node.forEach(visit);

    if (!isJsonObject(node)) return;

    const [kind, name] = componentRef(text(node.$ref) ?? '') ?? [];

    if (kind && name) {
      const target = objectOf(objectOf(document.components)[kind])[name];

      if (target !== undefined && components[kind]?.[name] === undefined) {
        (components[kind] ??= {})[name] = target;
        visit(target);
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(value);

  return components;
}

/**
 * One operation, by its operationId or by method and path, with what a request
 * needs beside it: the servers, the security it takes and how, the parameters
 * its path shares, and every component it refers to.
 */
export function getOperation(
  catalog: Pick<DocsCatalog, 'apis'>,
  query: {
    api?: string | undefined;
    operationId?: string | undefined;
    method?: string | undefined;
    path?: string | undefined;
  },
) {
  const method = query.method?.toLowerCase();

  const found = catalog.apis.flatMap((api) => {
    if (query.api && apiIdOf(api) !== query.api) return [];

    const { document } = api;

    return Object.entries(objectOf(document.paths)).flatMap(([path, item]) => {
      const pathItem = pathItemOf(document, item);

      return METHODS.flatMap((candidate) => {
        const operation = pathItem[candidate];

        if (!isJsonObject(operation)) return [];

        const matches = query.operationId
          ? operation.operationId === query.operationId
          : candidate === method && path === query.path;

        if (!matches) return [];

        const shared = listOf(pathItem.parameters);

        const security = listOf(operation.security ?? document.security);

        const used = new Set(security.flatMap((entry) => Object.keys(objectOf(entry))));

        const schemes = objectOf(objectOf(document.components).securitySchemes);

        return [
          {
            api: apiTitle(api),
            apiId: apiIdOf(api),
            method: candidate.toUpperCase(),
            path,
            servers: serversOf(operation.servers, pathItem.servers, document.servers),
            security,
            securitySchemes: Object.fromEntries(
              Object.entries(schemes).filter(([name]) => used.has(name)),
            ),
            ...(shared.length > 0 && { pathParameters: shared }),
            operation,
            components: referencedComponents([operation, shared], document),
          },
        ];
      });
    });
  });

  // Two APIs can share an operationId or a method and path; guessing would answer for the wrong one.
  if (found.length > 1) {
    throw new Error(
      `${found.length} APIs have this operation: ${found.map((each) => each.apiId).join(', ')}. Name one as api.`,
    );
  }

  return found[0];
}

/** How many lines a list answers with, so a large site does not fill an agent's context. */
const PAGE_SIZE = 50;

const MAX_PAGE_SIZE = 100;

const paging = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Most to list (default ${PAGE_SIZE}, max ${MAX_PAGE_SIZE})`),
  cursor: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe('The cursor the previous answer gave, for the next page'),
};

/** One page of a list, and the line that says how to get the next. */
export function pageOf<T>(items: T[], cursor?: string, limit = PAGE_SIZE) {
  const start = Math.max(0, Number(cursor) || 0);
  const end = start + limit;
  const page = items.slice(start, end);

  return {
    items: page,
    more:
      end < items.length
        ? [`${items.length - end} more. Call again with cursor "${end}".`]
        : page.length === 0 && items.length > 0
          ? [`Nothing past cursor "${start}": ${items.length} in all.`]
          : [],
  };
}

const reply = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });

/** An MCP server over this site's pages and API references, for one request. */
export function docsMcpServer(catalog: DocsCatalog, site: DocsMcpSite): McpServer {
  const pages = chatPages(catalog, site.base);
  const source = pagesSource(pages);
  const absolute = (href: string) => new URL(href, site.origin).href;
  const hasApis = catalog.apis.length > 0;

  const server = new McpServer(
    { name: site.title, version: pkg.version },
    {
      instructions: [
        `${site.title}: ${site.description}`,
        'Use search_docs to find guides, then read_page to read one in full. list_pages shows every page, to browse without a question or when a search finds nothing.',
        ...(hasApis
          ? [
              'For the API, list_operations names every endpoint and get_operation returns one with its parameters, bodies, responses, auth and servers.',
              'Answer from these pages and specs, and link the pages you used.',
            ]
          : []),
      ].join(' '),
    },
  );

  server.registerTool(
    'search_docs',
    {
      title: 'Search the docs',
      description: `Search ${site.title}'s guides and API references. Returns each match's title, URL and the passage that matched.`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Words to look for, such as "refresh token" or "export payees"'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ query }) => {
      const found = rankPages(pages, query, 10);

      return reply(
        found.length === 0
          ? `Nothing on ${site.title} matches "${query}".`
          : found
              .map((page) => `## ${page.title}\n${absolute(page.href)}\n\n${page.excerpt}`)
              .join('\n\n'),
      );
    },
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List the pages',
      description: `Every page of ${site.title}: title, URL and what it covers. Pass under to list one section, such as "/guides/".`,
      inputSchema: {
        under: z
          .string()
          .optional()
          .describe('Only pages whose path starts with this, such as "/guides/"'),
        ...paging,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ under, limit, cursor }) => {
      const prefix = under && `${site.base}${under.replace(/^\/+/, '')}`;

      const listed = pages.filter(
        (page) => !prefix || page.href.startsWith(prefix) || page.href.startsWith(under),
      );

      const { items, more } = pageOf(listed, cursor, limit);

      return reply(
        listed.length === 0
          ? `No pages under ${under}. Call list_pages without arguments to see them all.`
          : [
              ...items.map(
                (page) =>
                  `- ${page.title}: ${absolute(page.href)}${page.summary ? `: ${page.summary}` : ''}`,
              ),
              ...more,
            ].join('\n'),
      );
    },
  );

  server.registerTool(
    'read_page',
    {
      title: 'Read a page',
      description:
        'Read one page of the docs in full, by the URL or path search_docs or list_pages gave. A miss names the closest pages.',
      inputSchema: {
        url: z.string().min(1).describe('The page, such as a URL from search_docs or its path'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ url }) => {
      const path = URL.canParse(url)
        ? new URL(url).pathname
        : url.startsWith('/')
          ? url
          : `${site.base}${url}`;

      const page = await source.read(path);

      if (page) return reply(`# ${page.title}\n${absolute(page.href)}\n\n${page.text}`);

      // The last part of the address names the page; its words, cut to their first
      // letters so `authentication` still finds `Authenticating`, are the best guess.
      const slug = path.split('/').filter(Boolean).at(-1) ?? '';
      const guess = slug.split(/[^\p{L}\p{N}]+/u).map((word) => word.slice(0, 5));
      const near = rankPages(pages, guess.join(' '), 5);

      return reply(
        [
          `No page at ${url}.`,
          ...(near.length > 0
            ? ['Closest:', ...near.map((found) => `- ${found.title}: ${absolute(found.href)}`)]
            : []),
          'Use search_docs or list_pages to find one.',
        ].join('\n'),
      );
    },
  );

  if (hasApis) {
    server.registerTool(
      'list_operations',
      {
        title: 'List API operations',
        description:
          'Every API operation: method, path, operationId, summary and tags, and which API it belongs to when the site has several. Narrow it by API, by tag or by words in the path or summary.',
        inputSchema: {
          api: z
            .string()
            .optional()
            .describe('Only this API, by the id the listing gives, such as "payments/openapi"'),
          tag: z.string().optional().describe('Only operations with this tag, such as "Payees"'),
          match: z
            .string()
            .optional()
            .describe('Only operations whose path or summary contains this'),
          ...paging,
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ api, tag, match, limit, cursor }) => {
        const wanted = match?.toLowerCase();

        const several = catalog.apis.length > 1;

        const operations = listOperations(catalog).filter(
          (operation) =>
            (!api || operation.apiId === api) &&
            (!tag || operation.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) &&
            (!wanted ||
              `${operation.path} ${operation.summary ?? ''}`.toLowerCase().includes(wanted)),
        );

        const { items, more } = pageOf(operations, cursor, limit);

        return reply(
          operations.length === 0
            ? 'No operation matches. Call list_operations without arguments to see them all.'
            : [
                ...items.map(
                  (operation) =>
                    `${several ? `${operation.apiId}: ` : ''}${operation.method} ${operation.path}${operation.operationId ? ` (${operation.operationId})` : ''}` +
                    `${operation.summary ? `: ${operation.summary}` : ''}${operation.deprecated ? ' [deprecated]' : ''}` +
                    `${operation.tags.length > 0 ? ` [${operation.tags.join(', ')}]` : ''}`,
                ),
                ...more,
              ].join('\n'),
        );
      },
    );

    server.registerTool(
      'get_operation',
      {
        title: 'Get an API operation',
        description:
          'One operation in full, as JSON: parameters, request body, responses, the auth it takes, the servers it is called on, and every schema it refers to. Name it by operationId, or by method and path; add api when list_operations shows several APIs.',
        inputSchema: {
          api: z.string().optional().describe('Which API, by the id list_operations gives'),
          operationId: z.string().optional(),
          method: z.string().optional().describe('Such as GET or POST, with path'),
          path: z.string().optional().describe('As the spec writes it, such as /payees/{id}'),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ api, operationId, method, path }) => {
        if (!operationId && !(method && path)) {
          return reply('Name the operation by operationId, or by method and path.');
        }

        try {
          const found = getOperation(catalog, { api, operationId, method, path });

          return reply(
            found
              ? JSON.stringify(found, null, 2)
              : `No operation ${operationId ?? `${method} ${path}`}${api ? ` in ${api}` : ''}. Use list_operations to find it.`,
          );
        } catch (error) {
          return reply(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }

  return server;
}
