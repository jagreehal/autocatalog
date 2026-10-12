import { entitiesOf, entityOf, type Catalog } from './loader.js';

const DAYS_PER_MONTH = 30;

export type CostBreakdown = {
  input: number;
  output: number;
  total: number;
};

export type AgentCost = {
  agentId: string;
  modelId: string;
  reason?: string;
  invocationsPerDay: number | null;
  perInvocation: CostBreakdown | null;
  daily: CostBreakdown | null;
  monthly: CostBreakdown | null;
};

const breakdown = (input: number, output: number): CostBreakdown => ({
  input: round(input),
  output: round(output),
  total: round(input + output),
});

const round = (n: number): number => Math.round(n * 10000) / 10000;

export const estimateAgentCost = (cat: Catalog, agentId: string): AgentCost => {
  const agent = entityOf(cat, 'agent', agentId);

  if (!agent) throw new Error(`Unknown agent: ${agentId}`);
  const model = entityOf(cat, 'model', agent.model);
  const traffic = agent.expected_traffic;

  const empty = (reason: string): AgentCost => ({
    agentId,
    modelId: agent.model,
    reason,
    invocationsPerDay: traffic?.invocations_per_day ?? null,
    perInvocation: null,
    daily: null,
    monthly: null,
  });

  if (!model) return empty(`Model "${agent.model}" not found`);
  const inputRate = model.cost_per_million_input_tokens;
  const outputRate = model.cost_per_million_output_tokens;

  if (inputRate === undefined || outputRate === undefined) {
    return empty(`Model "${agent.model}" has no cost data`);
  }

  if (!traffic) return empty('Agent has no expected_traffic declared');

  const inputCostPerInvocation = (traffic.avg_input_tokens * inputRate) / 1_000_000;
  const outputCostPerInvocation = (traffic.avg_output_tokens * outputRate) / 1_000_000;
  const perInvocation = breakdown(inputCostPerInvocation, outputCostPerInvocation);

  const daily = breakdown(
    inputCostPerInvocation * traffic.invocations_per_day,
    outputCostPerInvocation * traffic.invocations_per_day,
  );

  const monthly = breakdown(daily.input * DAYS_PER_MONTH, daily.output * DAYS_PER_MONTH);

  return {
    agentId,
    modelId: agent.model,
    invocationsPerDay: traffic.invocations_per_day,
    perInvocation,
    daily,
    monthly,
  };
};

export type RollupKey = 'domain' | 'owner' | 'model';

export type RollupRow = {
  bucket: string;
  monthlyTotal: number;
  agentCount: number;
  estimatedCount: number;
  unestimatedAgents: string[];
};

export const rollupCost = (cat: Catalog, by: RollupKey): RollupRow[] => {
  type Acc = { monthly: number; agents: number; estimated: number; unestimated: string[] };

  const buckets = new Map<string, Acc>();

  for (const a of entitiesOf(cat, 'agent')) {
    const bucket =
      by === 'domain' ? (a.domain ?? '(no domain)') : by === 'owner' ? a.owner : a.model;

    const acc = buckets.get(bucket) ?? { monthly: 0, agents: 0, estimated: 0, unestimated: [] };
    acc.agents += 1;
    const cost = estimateAgentCost(cat, a.id);

    if (cost.monthly) {
      acc.monthly += cost.monthly.total;
      acc.estimated += 1;
    } else {
      acc.unestimated.push(a.id);
    }

    buckets.set(bucket, acc);
  }

  return [...buckets.entries()]
    .map(([bucket, v]) => ({
      bucket,
      monthlyTotal: round(v.monthly),
      agentCount: v.agents,
      estimatedCount: v.estimated,
      unestimatedAgents: v.unestimated,
    }))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);
};

export type WorkflowCost = {
  workflowId: string;
  agentCount: number;
  estimatedCount: number;
  unestimatedAgents: string[];
  monthlyTotal: number;
  perAgent: Array<{ agentId: string; monthly: number | null; reason?: string }>;
};

export const estimateWorkflowCost = (cat: Catalog, workflowId: string): WorkflowCost => {
  const workflow = entityOf(cat, 'workflow', workflowId);

  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  const perAgent: WorkflowCost['perAgent'] = [];
  const unestimated: string[] = [];
  let total = 0;
  let estimated = 0;

  for (const agentId of workflow.agents) {
    if (!cat.entities.get('agent')?.has(agentId)) {
      perAgent.push({ agentId, monthly: null, reason: 'agent not found' });
      unestimated.push(agentId);
      continue;
    }

    const cost = estimateAgentCost(cat, agentId);

    if (cost.monthly) {
      perAgent.push({ agentId, monthly: cost.monthly.total });
      total += cost.monthly.total;
      estimated += 1;
    } else {
      perAgent.push({ agentId, monthly: null, reason: cost.reason });
      unestimated.push(agentId);
    }
  }

  return {
    workflowId,
    agentCount: workflow.agents.length,
    estimatedCount: estimated,
    unestimatedAgents: unestimated,
    monthlyTotal: round(total),
    perAgent,
  };
};

export type CatalogMonthlyCost = { total: number; estimatedAgents: number; totalAgents: number };

export const totalMonthlyCost = (cat: Catalog): CatalogMonthlyCost => {
  let total = 0;
  let estimated = 0;
  let agents = 0;

  for (const agent of cat.entities.get('agent')?.values() ?? []) {
    agents += 1;
    const cost = estimateAgentCost(cat, agent.id);

    if (cost.monthly) {
      total += cost.monthly.total;
      estimated += 1;
    }
  }

  return { total: round(total), estimatedAgents: estimated, totalAgents: agents };
};
