import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type CallToolRequest, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
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

const client = new Client({ name: 'smoke-cost', version: '0.0.0' });

const callJson = async (name: string, args: CallToolRequest['params']['arguments']) => {
  const res = await client.callTool({ name, arguments: args });

  const text = toolText(res);

  return JSON.parse(text);
};

const main = async () => {
  await client.connect(transport);

  const single = await callJson('cost', { agent: 'agent/refund-agent' });
  console.log('cost(agent/refund-agent):');
  console.log(`  monthly = $${single.monthly?.total}`);
  console.log(`  per call = $${single.perInvocation?.total}`);

  const byModel = await callJson('cost', { by: 'model' });
  console.log('\ncost(by=model):');

  for (const row of byModel.rollup) {
    console.log(
      `  ${row.bucket.padEnd(20)} $${row.monthlyTotal} (${row.estimatedCount}/${row.agentCount})`,
    );
  }

  console.log(
    `  total = $${byModel.total.total} across ${byModel.total.estimatedAgents}/${byModel.total.totalAgents} agents`,
  );

  const summary = await callJson('cost', {});
  console.log('\ncost():');
  console.log('  total =', JSON.stringify(summary.total));

  await client.close();
};

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
