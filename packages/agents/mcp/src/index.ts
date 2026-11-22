import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadCatalog } from 'autocatalog-agents-core';
import { createServer } from './server.js';

export { createServer } from './server.js';

const parseArgs = (argv: Array<string>) => {
  let root = '.';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      root = argv[++i] ?? '.';
    }
  }

  return { root };
};

export const startMcpServer = async (
  argv: Array<string> = process.argv.slice(2),
): Promise<void> => {
  const { root } = parseArgs(argv);
  const catalog = await loadCatalog(resolve(root));

  process.stderr.write(
    `autocatalog-agents mcp: loaded ${[...catalog.entities.values()].reduce(
      (n, b) => n + b.size,
      0,
    )} entities from ${resolve(root)}\n`,
  );

  const server = createServer(catalog);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

// npm starts a bin through a symlink, so compare the real file.
const isEntry =
  (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) ||
  process.argv[1]?.endsWith('mcp/src/index.ts');

if (isEntry) {
  startMcpServer().catch((error) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
