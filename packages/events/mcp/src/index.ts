import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCatalog } from './tools.js';
import { createServer } from './server.js';

export { createServer, type ServerOptions } from './server.js';

function parseArgs(argv: string[]) {
  let root = '.';
  let eventsDir = 'events';
  // The company site's /catalog.json, and the variable holding its token when it is private.
  let site: string | undefined;
  let siteTokenEnv: string | undefined;
  // A folder of checked-out repositories, for a server that answers for the company.
  let company: string | undefined;
  let allowWrites = false;
  let audience: string[] = [];
  let writeAudience: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i] ?? '.';

    if (argv[i] === '--events-dir') eventsDir = argv[++i] ?? 'events';

    if (argv[i] === '--site') site = argv[++i];

    if (argv[i] === '--site-token-env') siteTokenEnv = argv[++i];

    if (argv[i] === '--company') company = argv[++i];

    if (argv[i] === '--allow-writes') allowWrites = true;

    if (argv[i] === '--audience') audience = (argv[++i] ?? '').split(',').filter(Boolean);

    if (argv[i] === '--write-audience') writeAudience = argv[++i];
  }

  return { root, eventsDir, site, siteTokenEnv, company, allowWrites, audience, writeAudience };
}

export async function startMcpServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { root, eventsDir, site, siteTokenEnv, company, allowWrites, audience, writeAudience } =
    parseArgs(argv);

  const resolved = resolve(root);
  const eventsRoot = resolve(resolved, eventsDir);

  // A company server can root in a handbook, which has no events of its own.
  const events =
    company && !existsSync(eventsRoot) ? mkdtempSync(join(tmpdir(), 'autocatalog-')) : eventsRoot;

  // --events-dir may sit anywhere below the root; the root is still the repository.
  const catalog = await loadCatalog(events, resolved);

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
    { company: company && resolve(company), allowWrites, audience, writeAudience },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// npm starts a bin through a symlink, so compare the real file.
const isEntry =
  (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) ||
  process.argv[1]?.endsWith('mcp/src/index.ts');

if (isEntry) {
  startMcpServer().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
