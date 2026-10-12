import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { auditCatalog } from './audit.js';
import { estimateAgentCost } from './cost.js';
import { discoverAiSdk, discoverPydanticAi } from './discovery.js';
import { computeImpact } from './impact.js';
import { loadCatalog } from './loader.js';
import { validateEdges } from './validator.js';

const roots: string[] = [];

const write = async (path: string, content: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const createCatalogFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'autocatalog-agents-'));
  roots.push(root);

  await write(
    join(root, 'models', 'fast-model.yaml'),
    [
      'id: fast-model',
      'name: Fast Model',
      'owner: platform',
      'provider: openai',
      'model_id: fast-model-api',
      'cost_per_million_input_tokens: 2',
      'cost_per_million_output_tokens: 8',
    ].join('\n'),
  );

  await write(
    join(root, 'domains', 'support', 'index.mdx'),
    ['---', 'name: Support', 'owner: support-ops', '---', 'Customer support domain.'].join('\n'),
  );

  await write(
    join(root, 'tools', 'lookup-order', 'index.mdx'),
    [
      '---',
      'name: Lookup Order',
      'owner: support-ops',
      'side_effects: read-only',
      'protocol: function',
      'domain: support',
      '---',
      'Looks up an order.',
    ].join('\n'),
  );

  await write(
    join(root, 'agents', 'triage-agent', 'index.mdx'),
    [
      '---',
      'name: Triage Agent',
      'owner: support-ops',
      'model: fast-model',
      'tools:',
      '  - lookup-order',
      'policies: []',
      'domain: support',
      'expected_traffic:',
      '  invocations_per_day: 100',
      '  avg_input_tokens: 1000',
      '  avg_output_tokens: 500',
      '---',
      'Routes customer requests.',
    ].join('\n'),
  );

  await write(
    join(root, 'workflows', 'support-triage', 'index.mdx'),
    [
      '---',
      'name: Support Triage',
      'owner: support-ops',
      'agents:',
      '  - triage-agent',
      'flow: []',
      'domain: support',
      '---',
      'Handles support triage.',
    ].join('\n'),
  );

  return root;
};

const createUnsafeCatalogFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'autocatalog-agents-unsafe-'));
  roots.push(root);

  await write(
    join(root, 'models', 'retired-model.yaml'),
    [
      'id: retired-model',
      'name: Retired Model',
      'owner: platform',
      'status: retired',
      'provider: openai',
      'model_id: retired-model-api',
      'cost_per_million_input_tokens: 10',
      'cost_per_million_output_tokens: 30',
    ].join('\n'),
  );

  await write(
    join(root, 'domains', 'support', 'index.mdx'),
    ['---', 'name: Support', 'owner: support-ops', '---', 'Customer support domain.'].join('\n'),
  );

  await write(
    join(root, 'tools', 'issue-refund', 'index.mdx'),
    [
      '---',
      'name: Issue Refund',
      'owner: finance',
      'side_effects: external-write',
      'protocol: function',
      'domain: support',
      '---',
      'Issues a refund.',
    ].join('\n'),
  );

  await write(
    join(root, 'agents', 'refund-agent', 'index.mdx'),
    [
      '---',
      'name: Refund Agent',
      'owner: support-ops',
      'version: 1.2.0',
      'model: retired-model',
      'tools:',
      '  - issue-refund',
      'policies: []',
      'domain: support',
      'risk: high',
      'prompts:',
      '  system: prompts/system.md',
      'expected_traffic:',
      '  invocations_per_day: 250000',
      '  avg_input_tokens: 2000',
      '  avg_output_tokens: 1000',
      '---',
      'Handles refunds.',
    ].join('\n'),
  );

  await write(
    join(root, 'workflows', 'refund-flow', 'index.mdx'),
    [
      '---',
      'name: Refund Flow',
      'owner: support-ops',
      'agents:',
      '  - refund-agent',
      'flow:',
      '  - from: refund-agent',
      '    to: refund-agent',
      '    on: retry',
      'domain: support',
      '---',
      'Refund flow.',
    ].join('\n'),
  );

  return root;
};

const createCatalogWithBrokenEvalFixture = async (): Promise<string> => {
  const root = await createCatalogFixture();

  await write(
    join(root, 'evals', 'triage-correctness', 'index.mdx'),
    [
      '---',
      'name: Triage Correctness',
      'owner: support-ops',
      'target: triage-agent',
      'cases: cases.yaml',
      '---',
      'Regression cases for support triage.',
    ].join('\n'),
  );

  return root;
};

const createInferredCatalogFixture = async (): Promise<string> => {
  const root = await createCatalogFixture();

  await write(
    join(root, 'tools', 'draft-tool', 'index.mdx'),
    [
      '---',
      'name: Draft Tool',
      'owner: review-needed',
      'side_effects: unknown',
      'discovery:',
      '  confidence: inferred',
      '  adapter: ai-sdk',
      '  sources:',
      '    - file: src/agent.ts',
      '      line: 12',
      '      symbol: draftTool',
      '  needs_review:',
      '    - owner',
      '    - side_effects',
      '---',
      'Inferred tool.',
    ].join('\n'),
  );

  return root;
};

const createPydanticAiSourceFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'autocatalog-agents-pydantic-source-'));
  roots.push(root);

  await write(
    join(root, 'travel.py'),
    [
      'from pydantic_ai import Agent',
      '',
      'trip_agent = Agent(',
      '    "openai:gpt-4.1-mini",',
      '    instructions="Plan trips with grounded facts.",',
      ')',
      '',
      '@trip_agent.tool_plain',
      'async def lookup_weather(city: str) -> str:',
      '    """Look up weather for a city."""',
      '    return "sunny"',
    ].join('\n'),
  );

  return root;
};

const createAiSdkSourceFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'autocatalog-agents-ai-sdk-source-'));
  roots.push(root);

  await write(
    join(root, 'ai-tools.ts'),
    [
      'import { tool } from "ai";',
      'import { z } from "zod";',
      '',
      'export const lookupTraveler = tool({',
      '  description: "Look up the authenticated traveler profile.",',
      '  inputSchema: z.object({}),',
      '  execute: async () => ({ name: "Ada" }),',
      '});',
      '',
      'export const tools = { lookupTraveler };',
    ].join('\n'),
  );

  await write(
    join(root, 'route.ts'),
    [
      'import { streamText } from "ai";',
      'import { tools } from "./ai-tools";',
      '',
      'export async function POST() {',
      '  return streamText({',
      '    model: "openai/gpt-4.1-mini",',
      '    tools,',
      '    system: "You are a travel assistant.",',
      '    prompt: "hello",',
      '  });',
      '}',
    ].join('\n'),
  );

  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Catalog production contract', () => {
  it('loads a real catalog, validates edges, and estimates agent cost', async ({ task }) => {
    story.init(task);
    story.given('a catalog with an agent, model, tool, domain, and workflow on disk');

    const root = await createCatalogFixture();

    story.when('the catalog is loaded through the public API');

    const catalog = await loadCatalog(root);
    const agent = catalog.entities.get('agent')?.get('triage-agent');
    const workflow = catalog.entities.get('workflow')?.get('support-triage');
    const edgeIssues = validateEdges(catalog);
    const cost = estimateAgentCost(catalog, 'triage-agent');

    story.then('the graph is valid and derived cost data is stable');

    expect(catalog.issues).toEqual([]);
    expect(agent).toMatchObject({
      id: 'triage-agent',
      name: 'Triage Agent',
      model: 'fast-model',
      tools: ['lookup-order'],
      domain: 'support',
    });
    expect(workflow).toMatchObject({ id: 'support-triage', agents: ['triage-agent'] });
    expect(edgeIssues).toEqual([]);
    expect(cost).toMatchObject({
      agentId: 'triage-agent',
      modelId: 'fast-model',
      invocationsPerDay: 100,
      perInvocation: { input: 0.002, output: 0.004, total: 0.006 },
      daily: { input: 0.2, output: 0.4, total: 0.6 },
      monthly: { input: 6, output: 12, total: 18 },
    });
  });

  it('surfaces AI-agent governance risks that generic catalog CRUD misses', async ({ task }) => {
    story.init(task);
    story.given('a high-risk refund agent declares its model, tool, prompt, traffic, and workflow');

    const root = await createUnsafeCatalogFixture();

    story.when('the catalog is audited and impact analysis is computed');

    const catalog = await loadCatalog(root);
    const findings = auditCatalog(catalog);
    const rules = findings.map((finding) => finding.rule);
    const toolImpact = computeImpact(catalog, { kind: 'tool', id: 'issue-refund' });
    const agentImpact = computeImpact(catalog, { kind: 'agent', id: 'refund-agent' });

    story.then('autocatalog-agents reports release blockers and exact blast radius');

    expect(catalog.issues).toEqual([]);
    expect(rules).toEqual(
      expect.arrayContaining([
        'high-risk-no-eval',
        'external-write-no-policy',
        'deprecated-model-in-use',
        'prompt-file-missing',
        'cost-ceiling-exceeded',
        'workflow-cycle',
      ]),
    );
    expect(toolImpact.dependents).toEqual([{ kind: 'agent', id: 'refund-agent' }]);
    expect(agentImpact.dependencies).toEqual(
      expect.arrayContaining([
        { kind: 'model', id: 'retired-model' },
        { kind: 'tool', id: 'issue-refund' },
        { kind: 'domain', id: 'support' },
      ]),
    );
    expect(agentImpact.dependents).toEqual([{ kind: 'workflow', id: 'refund-flow' }]);
  });

  it('fails production readiness when an Eval references missing executable cases', async ({
    task,
  }) => {
    story.init(task);
    story.given('an agent has an Eval entry that points to a cases file');

    const root = await createCatalogWithBrokenEvalFixture();

    story.when('the catalog is loaded and audited through the public API');

    const catalog = await loadCatalog(root);
    const findings = auditCatalog(catalog);

    story.then('the missing cases file is reported as an audit finding');

    expect(catalog.issues).toEqual([]);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'eval-cases-file-missing',
          severity: 'P1',
          ref: { kind: 'eval', id: 'triage-correctness' },
        }),
      ]),
    );
  });

  it('keeps discovered framework entities as review-required drafts', async ({ task }) => {
    story.init(task);
    story.given('a catalog contains an entity inferred from framework source code');

    const root = await createInferredCatalogFixture();

    story.when('production readiness is audited');

    const catalog = await loadCatalog(root);
    const findings = auditCatalog(catalog);

    story.then('the inferred entity cannot pass as reviewed production truth');

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'inferred-entity-needs-review',
          severity: 'P1',
          ref: { kind: 'tool', id: 'draft-tool' },
        }),
        expect.objectContaining({
          rule: 'tool-side-effects-unknown',
          severity: 'P1',
          ref: { kind: 'tool', id: 'draft-tool' },
        }),
      ]),
    );
  });

  it('discovers Pydantic AI agents and tools with source evidence', async ({ task }) => {
    story.init(task);
    story.given('a Pydantic AI codebase declares an Agent and registers a tool');

    const root = await createPydanticAiSourceFixture();

    story.when('autocatalog-agents discovers framework declarations');

    const result = await discoverPydanticAi(root);

    story.then('the draft graph contains only evidence-backed entities');

    expect(result.agents).toEqual([
      expect.objectContaining({
        id: 'trip-agent',
        model: 'gpt-4-1-mini',
        tools: ['lookup-weather'],
        source: expect.objectContaining({ file: 'travel.py', symbol: 'trip_agent' }),
      }),
    ]);
    expect(result.tools).toEqual([
      expect.objectContaining({
        id: 'lookup-weather',
        description: 'Look up weather for a city.',
        source: expect.objectContaining({ file: 'travel.py', symbol: 'lookup_weather' }),
      }),
    ]);
    expect(result.models).toEqual([
      expect.objectContaining({ id: 'gpt-4-1-mini', provider: 'openai', model_id: 'gpt-4.1-mini' }),
    ]);
  });

  it('discovers AI SDK tools passed into streamText across modules', async ({ task }) => {
    story.init(task);
    story.given('an AI SDK route imports a tools object from a separate module');

    const root = await createAiSdkSourceFixture();

    story.when('autocatalog-agents scans the route and tool module');

    const result = await discoverAiSdk(root);

    story.then('the route draft is connected to the discovered tool and model');

    expect(result.tools).toEqual([
      expect.objectContaining({
        id: 'lookup-traveler',
        description: 'Look up the authenticated traveler profile.',
      }),
    ]);
    expect(result.agents).toEqual([
      expect.objectContaining({
        id: 'route',
        model: 'gpt-4-1-mini',
        tools: ['lookup-traveler'],
      }),
    ]);
  });
});
