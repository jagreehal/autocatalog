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

const client = new Client({ name: 'smoke-mcp', version: '0.0.0' });

const main = async () => {
  await client.connect(transport);

  const tools = await client.listTools();
  process.stdout.write(`tools (${tools.tools.length}):\n`);

  for (const t of tools.tools) {
    process.stdout.write(`  • ${t.name} — ${t.description ?? ''}\n`);
  }

  process.stdout.write('\ncall impact(agent/refund-agent):\n');

  const impact = await client.callTool({
    name: 'impact',
    arguments: { ref: 'agent/refund-agent' },
  });

  const text = toolText(impact);

  process.stdout.write(text + '\n');

  process.stdout.write('\ncall find_by(attribute=tools, value=issue-refund):\n');

  const finders = await client.callTool({
    name: 'find_by',
    arguments: { attribute: 'tools', value: 'issue-refund' },
  });

  const ftext = toolText(finders);

  process.stdout.write(ftext + '\n');

  await client.close();
};

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
