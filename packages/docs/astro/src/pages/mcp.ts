// The site's MCP endpoint, over Streamable HTTP, for Claude and other agents to
// connect to by URL. Stateless: each request builds the server from the catalog
// this reader may open, so `access` and the audience hold here as on the pages.
import type { APIRoute } from 'astro';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { docsCatalog } from '../catalog';
import { docsSiteConfig } from '../config';
import { docsMcpServer } from '../mcp';

export const prerender = false;

// Browser-based clients, such as the MCP Inspector, send these across origins.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'content-type, authorization, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

/** One MCP request, answered from the catalog this reader may open. */
export async function serveMcp(request: Request): Promise<Response> {
  const site = docsSiteConfig();
  const url = new URL(request.url);

  const server = docsMcpServer(await docsCatalog(), {
    title: site.title,
    description: site.description,
    origin: url.origin,
    base: import.meta.env.BASE_URL.replace(/\/?$/, '/'),
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  for (const [name, value] of Object.entries(CORS)) response.headers.set(name, value);

  return response;
}

export const POST: APIRoute = ({ request }) => serveMcp(request);

// Stateless: no session to stream to or end, so only POST is served.
export const notAllowed = () =>
  new Response(null, { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });

export const GET = notAllowed;

export const DELETE = notAllowed;

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
