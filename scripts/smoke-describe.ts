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

const client = new Client({ name: 'smoke-describe', version: '0.0.0' });

const main = async () => {
  await client.connect(transport);

  const res = await client.callTool({
    name: 'describe',
    arguments: { ref: 'agent/refund-agent' },
  });

  const text = toolText(res);

  const parsed = JSON.parse(text);
  console.log('keys:', Object.keys(parsed).sort().join(', '));
  console.log('\nbody (agent-filtered):\n' + (parsed.body ?? '(no body)'));
  console.log(
    '\nbody includes for:agent block?  ',
    String(parsed.body || '').includes('Notes for AI assistants'),
  );
  console.log('body excludes for:human block?  ', !String(parsed.body || '').includes('PagerDuty'));
  await client.close();
};

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
