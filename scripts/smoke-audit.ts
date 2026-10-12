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

const client = new Client({ name: 'smoke-audit', version: '0.0.0' });

const callJson = async (name: string, args: CallToolRequest['params']['arguments']) => {
  const res = await client.callTool({ name, arguments: args });

  const text = toolText(res);

  return JSON.parse(text);
};

const main = async () => {
  await client.connect(transport);
  const all = await callJson('audit', {});
  console.log('audit(): counts =', JSON.stringify(all.counts), `(${all.findings.length} findings)`);
  const p0only = await callJson('audit', { minSeverity: 'P0' });
  console.log('audit({minSeverity: P0}): counts =', JSON.stringify(p0only.counts));
  await client.close();
};

main().catch((err) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
