import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

export type DiscoveryAdapter = 'pydantic-ai' | 'ai-sdk';

export type DiscoveredSource = {
  file: string;
  line: number;
  symbol?: string;
};

export type DiscoveredModel = {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  source: DiscoveredSource;
};

export type DiscoveredTool = {
  id: string;
  name: string;
  description?: string;
  source: DiscoveredSource;
};

export type DiscoveredAgent = {
  id: string;
  name: string;
  model?: string;
  tools: string[];
  instructions?: string;
  source: DiscoveredSource;
};

export type DiscoveryResult = {
  adapter: DiscoveryAdapter;
  root: string;
  agents: DiscoveredAgent[];
  tools: DiscoveredTool[];
  models: DiscoveredModel[];
  warnings: string[];
};

type ScanFile = {
  absPath: string;
  relPath: string;
  text: string;
};

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const toId = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const toName = (id: string): string =>
  id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

const listFiles = async (root: string, exts: Set<string>): Promise<ScanFile[]> => {
  const out: ScanFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
        continue;
      }

      if (!entry.isFile() || !exts.has(extname(entry.name))) continue;
      const absPath = join(dir, entry.name);
      out.push({
        absPath,
        relPath: relative(root, absPath),
        text: await readFile(absPath, 'utf8'),
      });
    }
  };

  await walk(root);

  return out;
};

const readBalancedCall = (text: string, openParen: number): string | undefined => {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let triple: '"""' | "'''" | null = null;
  let escaped = false;

  for (let i = openParen; i < text.length; i++) {
    const ch = text[i]!;
    const next3 = text.slice(i, i + 3);

    if (triple) {
      if (next3 === triple) {
        triple = null;
        i += 2;
      }

      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (ch === quote) quote = null;
      continue;
    }

    if (next3 === '"""' || next3 === "'''") {
      triple = next3;
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') depth += 1;

    if (ch === ')') {
      depth -= 1;

      if (depth === 0) return text.slice(openParen + 1, i);
    }
  }

  return undefined;
};

const stringLiterals = (text: string): string[] => {
  const values: string[] = [];

  const pattern =
    /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`\\]*(?:\\.[^`\\]*)*`)/g;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0]!;
    values.push(
      raw.slice(
        raw.startsWith('"""') || raw.startsWith("'''") ? 3 : 1,
        raw.endsWith('"""') || raw.endsWith("'''") ? -3 : -1,
      ),
    );
  }

  return values;
};

const firstStringAfter = (text: string, key: string): string | undefined => {
  const idx = text.indexOf(key);

  if (idx === -1) return undefined;

  return stringLiterals(text.slice(idx, Math.min(text.length, idx + 1500)))[0];
};

const modelFromLiteral = (literal: string | undefined): DiscoveredModel | undefined => {
  if (!literal) return undefined;

  const [provider, modelId] = literal.includes(':')
    ? literal.split(/:(.+)/)
    : literal.includes('/')
      ? literal.split(/\/(.+)/)
      : ['unknown', literal];

  if (!modelId) return undefined;

  return {
    id: toId(modelId),
    name: modelId,
    provider: provider || 'unknown',
    model_id: modelId,
    source: { file: '', line: 1 },
  };
};

const firstPositionalStringLiteral = (args: string): string | undefined => {
  const trimmed = args.trimStart();

  return trimmed.startsWith('"') || trimmed.startsWith("'")
    ? stringLiterals(trimmed)[0]
    : undefined;
};

export const discoverPydanticAi = async (root: string): Promise<DiscoveryResult> => {
  const files = await listFiles(root, new Set(['.py']));
  const agents = new Map<string, DiscoveredAgent>();
  const tools = new Map<string, DiscoveredTool>();
  const models = new Map<string, DiscoveredModel>();
  const warnings: string[] = [];

  for (const file of files) {
    const agentPattern = /(\w+)\s*=\s*Agent\s*\(/g;

    for (const match of file.text.matchAll(agentPattern)) {
      const symbol = match[1]!;
      const openParen = (match.index ?? 0) + match[0]!.lastIndexOf('(');
      const args = readBalancedCall(file.text, openParen);

      if (!args) {
        warnings.push(
          `Could not parse Agent(...) call in ${file.relPath}:${lineAt(file.text, match.index ?? 0)}`,
        );
        continue;
      }

      const literalModel = firstPositionalStringLiteral(args);
      const model = modelFromLiteral(literalModel);

      if (model) {
        model.source = { file: file.relPath, line: lineAt(file.text, match.index ?? 0), symbol };
        models.set(model.id, model);
      } else {
        warnings.push(
          `Skipped model inference for ${symbol} in ${file.relPath}:${lineAt(file.text, match.index ?? 0)} because the Agent model is not a string literal.`,
        );
      }

      const id = toId(symbol === 'agent' ? file.relPath.replace(/\.[^.]+$/, '') : symbol);

      const agent: DiscoveredAgent = {
        id,
        name: toName(id),
        tools: [],
        instructions: firstStringAfter(args, 'instructions='),
        source: { file: file.relPath, line: lineAt(file.text, match.index ?? 0), symbol },
      };

      if (model) agent.model = model.id;
      agents.set(symbol, agent);
    }

    const toolPattern =
      /@(\w+)\.tool(?:_plain)?(?:\([^)]*\))?\s+(?:async\s+)?def\s+(\w+)\s*\([^)]*\)[^\n]*:\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)')?/g;

    for (const match of file.text.matchAll(toolPattern)) {
      const agentSymbol = match[1]!;
      const toolSymbol = match[2]!;
      const agent = agents.get(agentSymbol);
      const id = toId(toolSymbol);
      const description = match[3] ?? match[4] ?? match[5] ?? match[6];

      const tool: DiscoveredTool = {
        id,
        name: toName(id),
        source: {
          file: file.relPath,
          line: lineAt(file.text, match.index ?? 0),
          symbol: toolSymbol,
        },
      };

      if (description) tool.description = description.trim();
      tools.set(id, tool);

      if (agent && !agent.tools.includes(id)) agent.tools.push(id);
    }
  }

  return {
    adapter: 'pydantic-ai',
    root,
    agents: [...agents.values()],
    tools: [...tools.values()],
    models: [...models.values()],
    warnings,
  };
};

export const discoverAiSdk = async (root: string): Promise<DiscoveryResult> => {
  const files = await listFiles(root, new Set(['.ts', '.tsx', '.mts', '.cts']));
  const agents = new Map<string, DiscoveredAgent>();
  const agentsUsingToolsIdentifier = new Set<string>();
  const tools = new Map<string, DiscoveredTool>();
  const models = new Map<string, DiscoveredModel>();
  const warnings: string[] = [];

  for (const file of files) {
    const toolPattern = /(?:export\s+)?const\s+(\w+)\s*=\s*tool\s*\(/g;

    for (const match of file.text.matchAll(toolPattern)) {
      const symbol = match[1]!;
      const openParen = (match.index ?? 0) + match[0]!.lastIndexOf('(');
      const args = readBalancedCall(file.text, openParen);
      const id = toId(symbol);

      const tool: DiscoveredTool = {
        id,
        name: toName(id),
        source: { file: file.relPath, line: lineAt(file.text, match.index ?? 0), symbol },
      };

      if (args) tool.description = firstStringAfter(args, 'description');
      tools.set(id, tool);
    }

    const callPattern = /(generateText|streamText)\s*\(/g;

    for (const match of file.text.matchAll(callPattern)) {
      const openParen = (match.index ?? 0) + match[0]!.lastIndexOf('(');
      const args = readBalancedCall(file.text, openParen);

      if (!args) {
        warnings.push(
          `Could not parse ${match[1]}(...) call in ${file.relPath}:${lineAt(file.text, match.index ?? 0)}`,
        );
        continue;
      }

      const modelLiteral = firstStringAfter(args, 'model');
      const model = modelFromLiteral(modelLiteral);

      if (model) {
        model.source = {
          file: file.relPath,
          line: lineAt(file.text, match.index ?? 0),
          symbol: match[1],
        };
        models.set(model.id, model);
      } else {
        warnings.push(
          `Skipped model inference for ${match[1]} in ${file.relPath}:${lineAt(file.text, match.index ?? 0)} because the model is not a string literal.`,
        );
      }

      const localTools = [...tools.values()].filter((tool) => tool.source.file === file.relPath);
      const id = toId(file.relPath.replace(/\.[^.]+$/, ''));

      const agent: DiscoveredAgent = {
        id,
        name: toName(id),
        tools: localTools.map((tool) => tool.id),
        instructions: firstStringAfter(args, 'system'),
        source: { file: file.relPath, line: lineAt(file.text, match.index ?? 0), symbol: match[1] },
      };

      if (model) agent.model = model.id;
      agents.set(id, agent);

      if (/\btools\b/.test(args)) agentsUsingToolsIdentifier.add(id);
    }

    const exportedTools = /export\s+const\s+tools\s*=\s*{([\s\S]*?)}\s*;/m.exec(file.text);

    if (exportedTools) {
      const ids = [...exportedTools[1]!.matchAll(/\b(\w+)\b/g)].flatMap((m) => {
        const id = toId(m[1]!);

        return tools.has(id) ? [id] : [];
      });

      const maybeAgent = [...agents.values()].find((agent) => agent.source.file === file.relPath);

      if (maybeAgent) maybeAgent.tools = [...new Set([...maybeAgent.tools, ...ids])];
    }
  }

  for (const agentId of agentsUsingToolsIdentifier) {
    const agent = agents.get(agentId);

    if (agent && agent.tools.length === 0) {
      agent.tools = [...tools.keys()];
    }
  }

  return {
    adapter: 'ai-sdk',
    root,
    agents: [...agents.values()],
    tools: [...tools.values()],
    models: [...models.values()],
    warnings,
  };
};

export const discoverFramework = async (
  adapter: DiscoveryAdapter,
  root: string,
): Promise<DiscoveryResult> => {
  if (adapter === 'pydantic-ai') return discoverPydanticAi(root);

  return discoverAiSdk(root);
};
