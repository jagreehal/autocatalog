// The site's MCP endpoint, over Streamable HTTP, for Claude and other agents to
// connect to by URL. Stateless: each request builds the server from the catalog
// this reader may open, so `access` and the audience hold here as on the pages.
import type { APIRoute } from 'astro';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { docsCatalog } from '../catalog';
import { docsSiteConfig } from '../config';
import { docsMcpServer } from '../mcp';

export const prerender = false;

// A site for an audience is public, so a browser-based client such as the MCP
// Inspector may call it from any origin. Any other site may sit behind a network
// a reader's browser can reach, so only the site's own pages may call it there.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-protocol-version',
};

const isPublic = () => docsSiteConfig().audience !== undefined;

const corsHeaders = (): Record<string, string> => (isPublic() ? CORS : {});

/** A browser sends `Origin` across origins; a server-side client sends none. */
const crossOrigin = (request: Request, site: string | undefined) => {
  const origin = request.headers.get('origin');

  // Behind a proxy that ends TLS the request arrives as http, so the site's
  // configured address counts as its own too.
  const own = [
    new URL(request.url).origin,
    ...(site && URL.canParse(site) ? [new URL(site).origin] : []),
  ];

  return origin !== null && !own.includes(origin);
};

/** What one reader is answered is not for a shared cache to hand the next. */
const PRIVATE = { 'cache-control': 'private, no-store' };

/** One MCP request, answered from the catalog this reader may open. */
export async function serveMcp(
  request: Request,
  site: string | undefined = import.meta.env.SITE,
): Promise<Response> {
  if (!isPublic() && crossOrigin(request, site)) return new Response(null, { status: 403 });

  let server: McpServer | undefined;

  try {
    const site = docsSiteConfig();
    const url = new URL(request.url);

    server = docsMcpServer(await docsCatalog(), {
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

    for (const [name, value] of Object.entries({ ...corsHeaders(), ...PRIVATE })) {
      response.headers.set(name, value);
    }

    return response;
  } catch (error) {
    // The client gets a JSON-RPC error it can read; the cause stays in the server's log.
    console.error('autocatalog mcp:', error);
    await server?.close().catch(() => undefined);

    return Response.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      { status: 500, headers: { ...corsHeaders(), ...PRIVATE } },
    );
  }
}

export const POST: APIRoute = ({ request }) => serveMcp(request);

// Stateless: no session to stream to or end, so only POST is served.
export const notAllowed = () =>
  new Response(null, { status: 405, headers: { ...corsHeaders(), allow: 'POST, OPTIONS' } });

export const GET = notAllowed;

export const DELETE = notAllowed;

export const OPTIONS: APIRoute = () =>
  new Response(null, { status: isPublic() ? 204 : 403, headers: corsHeaders() });
