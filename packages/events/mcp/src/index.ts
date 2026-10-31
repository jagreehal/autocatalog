import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCatalog } from './tools.js';
import { createServer } from './server.js';

export { createServer } from './server.js';

function parseArgs(argv: string[]) {
  let root = '.';
  let eventsDir = 'events';
  // The company site's /catalog.json, and the variable holding its token when it is private.
  let site: string | undefined;
  let siteTokenEnv: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i] ?? '.';

    if (argv[i] === '--events-dir') eventsDir = argv[++i] ?? 'events';

    if (argv[i] === '--site') site = argv[++i];

    if (argv[i] === '--site-token-env') siteTokenEnv = argv[++i];
  }

  return { root, eventsDir, site, siteTokenEnv };
}

export async function startMcpServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { root, eventsDir, site, siteTokenEnv } = parseArgs(argv);
  const resolved = resolve(root);
  const eventsRoot = resolve(resolved, eventsDir);

  // --events-dir may sit anywhere below the root; the root is still the repository.
  const catalog = await loadCatalog(eventsRoot, resolved);

  process.stderr.write(
    `autocatalog mcp: loaded ${catalog.events.length} events from ${eventsRoot}\n`,
  );

  const server = createServer(
    catalog,
    site
      ? {
          // The site's address is enough; its graph is always at /catalog.json.
          index:
            /^https?:\/\//i.test(site) && !site.endsWith('.json')
              ? new URL('catalog.json', site.endsWith('/') ? site : `${site}/`).href
              : site,
          ...(siteTokenEnv && { tokenEnv: siteTokenEnv }),
        }
      : undefined,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isEntry =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mcp/src/index.ts');

if (isEntry) {
  startMcpServer().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
