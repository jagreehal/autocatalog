import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import kleur from 'kleur';
import {
  AUTOCATALOG_ENTITY_FILE,
  discoverFramework,
  type DiscoveredAgent,
  type DiscoveredModel,
  type DiscoveredTool,
  type DiscoveryAdapter,
  type DiscoveryResult,
} from 'autocatalog-agents-core';

type DiscoverArgs = {
  adapter: DiscoveryAdapter;
  source: string;
  root: string;
  dryRun: boolean;
};

const usage = (): string =>
  'usage: ac-agents discover --from pydantic-ai|ai-sdk <source-dir> [--root <catalog>] [--dry-run]\n';

const parseArgs = (args: string[]): DiscoverArgs | null => {
  let adapter: DiscoveryAdapter | null = null;
  let source: string | null = null;
  let root = '.';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--from') {
      const value = args[++i];

      if (value === 'pydantic-ai' || value === 'ai-sdk') adapter = value;
      else return null;
    } else if (arg === '--root') {
      root = args[++i] ?? '.';
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!source) {
      source = arg;
    } else {
      return null;
    }
  }

  if (!adapter || !source) return null;

  return { adapter, source, root, dryRun };
};

const discovery = (
  adapter: DiscoveryAdapter,
  source: { file: string; line: number; symbol?: string },
  needsReview: string[],
) => ({
  confidence: 'inferred',
  adapter,
  sources: [source],
  needs_review: needsReview,
});

const jsonFile = <T extends Record<string, unknown>>(data: T): string =>
  `${JSON.stringify(data, null, 2)}\n`;

const bodyFile = (body: string): string => `${body.trim()}\n`;

const agentData = (adapter: DiscoveryAdapter, agent: DiscoveredAgent) => ({
  name: agent.name,
  owner: 'review-needed',
  model: agent.model ?? 'review-needed-model',
  tools: agent.tools,
  policies: [],
  risk: 'medium',
  discovery: discovery(adapter, agent.source, ['owner', 'domain', 'risk', 'policies', 'evals']),
});

const toolData = (adapter: DiscoveryAdapter, tool: DiscoveredTool) => ({
  name: tool.name,
  owner: 'review-needed',
  side_effects: 'unknown',
  risk: 'low',
  discovery: discovery(adapter, tool.source, [
    'owner',
    'domain',
    'side_effects',
    'risk',
    'policies',
  ]),
});

const modelData = (adapter: DiscoveryAdapter, model: DiscoveredModel) => ({
  id: model.id,
  name: model.name,
  owner: 'review-needed',
  provider: model.provider,
  model_id: model.model_id,
  discovery: discovery(adapter, model.source, [
    'owner',
    'status',
    'cost_per_million_input_tokens',
    'cost_per_million_output_tokens',
  ]),
});

const writeDrafts = async (catalogRoot: string, result: DiscoveryResult): Promise<string[]> => {
  const written: string[] = [];

  for (const model of result.models) {
    const dir = join(catalogRoot, 'models', model.id);
    const path = join(dir, AUTOCATALOG_ENTITY_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(path, jsonFile(modelData(result.adapter, model)), 'utf8');
    written.push(path);
  }

  for (const tool of result.tools) {
    const dir = join(catalogRoot, 'tools', tool.id);
    const manifestPath = join(dir, AUTOCATALOG_ENTITY_FILE);
    const bodyPath = join(dir, 'index.mdx');
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, jsonFile(toolData(result.adapter, tool)), 'utf8');
    await writeFile(
      bodyPath,
      bodyFile(tool.description ?? `Inferred from ${tool.source.file}:${tool.source.line}.`),
      'utf8',
    );
    written.push(manifestPath);
  }

  for (const agent of result.agents) {
    if (!agent.model) continue;
    const dir = join(catalogRoot, 'agents', agent.id);
    const manifestPath = join(dir, AUTOCATALOG_ENTITY_FILE);
    const bodyPath = join(dir, 'index.mdx');
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, jsonFile(agentData(result.adapter, agent)), 'utf8');
    await writeFile(
      bodyPath,
      bodyFile(agent.instructions ?? `Inferred from ${agent.source.file}:${agent.source.line}.`),
      'utf8',
    );
    written.push(manifestPath);
  }

  return written;
};

export const runDiscover = async (args: string[]): Promise<number> => {
  const parsed = parseArgs(args);

  if (!parsed) {
    process.stderr.write(usage());

    return 2;
  }

  const sourceRoot = resolve(parsed.source);
  const catalogRoot = resolve(parsed.root);
  const result = await discoverFramework(parsed.adapter, sourceRoot);

  process.stdout.write(`${kleur.bold('discover:')} ${result.adapter} ${kleur.dim(sourceRoot)}\n`);
  process.stdout.write(`  agents ${result.agents.length}\n`);
  process.stdout.write(`  tools  ${result.tools.length}\n`);
  process.stdout.write(`  models ${result.models.length}\n`);

  for (const warning of result.warnings) {
    process.stdout.write(`  ${kleur.yellow('warning')} ${warning}\n`);
  }

  if (parsed.dryRun) {
    for (const agent of result.agents) {
      const suffix = agent.model
        ? ''
        : kleur.yellow(' (not writable: model was not statically proven)');

      process.stdout.write(
        `  ${kleur.cyan('agent')} ${agent.id} tools=[${agent.tools.join(', ')}]${suffix}\n`,
      );
    }

    for (const tool of result.tools) process.stdout.write(`  ${kleur.cyan('tool')}  ${tool.id}\n`);

    for (const model of result.models)
      process.stdout.write(
        `  ${kleur.cyan('model')} ${model.id} (${model.provider}:${model.model_id})\n`,
      );

    return 0;
  }

  const written = await writeDrafts(catalogRoot, result);

  for (const agent of result.agents.filter((item) => !item.model)) {
    process.stdout.write(
      `  ${kleur.yellow('skip')} agent/${agent.id} ${kleur.dim('model was not statically proven')}\n`,
    );
  }

  for (const path of written) process.stdout.write(`  ${kleur.green('write')} ${path}\n`);

  return 0;
};
