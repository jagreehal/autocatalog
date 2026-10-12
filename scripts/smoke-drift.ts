import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const repoRoot = resolve(here, '..');

const transport = new StdioClientTransport({
  command: 'npx',
  args: [
    'tsx',
    resolve(repoRoot, 'packages/agents/mcp/src/index.ts'),
    '--root',
    'starters/agent-default',
  ],
  cwd: repoRoot,
});

/** The text blocks of a tool result, joined; the SDK schema decodes the reply. */
const toolText = (result: Awaited<ReturnType<Client['callTool']>>) =>
  CallToolResultSchema.parse(result)
    .content.map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n');

const client = new Client({ name: 'smoke-drift', version: '0.0.0' });

const main = async () => {
  await client.connect(transport);

  const res = await client.callTool({
    name: 'drift',
    arguments: { file: resolve(repoRoot, 'scripts/sample-otlp.json') },
  });

  const text = toolText(res);

  const report = JSON.parse(text);
  console.log(`observedAgents: ${report.observedAgents}, observedSpans: ${report.observedSpans}`);
  console.log('byKind:', JSON.stringify(report.byKind));
  console.log(`drift findings (${report.driftCount}):`);

  for (const d of report.drifts) {
    console.log(`  - [${d.kind}] agent/${d.agentId}${d.toolId ? ' → tool/' + d.toolId : ''}`);
  }

  await client.close();
};

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
