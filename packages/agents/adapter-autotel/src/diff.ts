// Type-only: the browser entry re-exports this module, and the core runtime reads node:fs.
import type { Catalog } from 'autocatalog-agents-core';
import type { Observations } from './parse.js';

export type DriftKind =
  | 'unknown-agent'
  | 'undeclared-tool'
  | 'unknown-tool'
  | 'unused-declared-tool'
  | 'model-mismatch'
  | 'undeclared-model';

export type Drift = {
  kind: DriftKind;
  agentId: string;
  toolId?: string;
  expectedModel?: string;
  observedModels?: string[];
  message: string;
};

export type DriftReport = {
  observedAgents: number;
  observedSpans: number;
  driftCount: number;
  byKind: Record<DriftKind, number>;
  drifts: Drift[];
};

const EMPTY_COUNTS: Record<DriftKind, number> = {
  'unknown-agent': 0,
  'undeclared-tool': 0,
  'unknown-tool': 0,
  'unused-declared-tool': 0,
  'model-mismatch': 0,
  'undeclared-model': 0,
};

const declaredModelAliases = (cat: Catalog, modelId: string): Set<string> => {
  const aliases = new Set([modelId]);
  const model = cat.entities.get('model')?.get(modelId);

  if (model?.kind === 'model' && model.model_id) aliases.add(model.model_id);

  return aliases;
};

const hasDeclaredModelAlias = (cat: Catalog, observedModelId: string): boolean => {
  if (cat.entities.get('model')?.has(observedModelId)) return true;

  for (const model of cat.entities.get('model')?.values() ?? []) {
    if (model.kind === 'model' && model.model_id === observedModelId) return true;
  }

  return false;
};

export const computeDrift = (cat: Catalog, obs: Observations): DriftReport => {
  const drifts: Drift[] = [];

  for (const agentId of obs.agents) {
    const entity = cat.entities.get('agent')?.get(agentId);
    const agent = entity?.kind === 'agent' ? entity : undefined;

    if (!agent) {
      drifts.push({
        kind: 'unknown-agent',
        agentId,
        message: `Agent "${agentId}" observed in traces but not declared in the catalog. Add it, or stop the traffic.`,
      });
      continue;
    }

    const observedModels = obs.modelUsage.get(agentId);

    if (observedModels && observedModels.size > 0) {
      const observedList = [...observedModels];
      const acceptedModels = declaredModelAliases(cat, agent.model);

      if (!observedList.some((model) => acceptedModels.has(model))) {
        drifts.push({
          kind: 'model-mismatch',
          agentId,
          expectedModel: agent.model,
          observedModels: observedList,
          message: `Agent "${agentId}" declared model "${agent.model}" but observed [${observedList.join(', ')}]. Update the declaration or revert the deploy.`,
        });
      }

      for (const m of observedList) {
        if (!hasDeclaredModelAlias(cat, m)) {
          drifts.push({
            kind: 'undeclared-model',
            agentId,
            observedModels: [m],
            message: `Model "${m}" observed for agent "${agentId}" but not declared as a Model entity.`,
          });
        }
      }
    }

    const observedTools = obs.toolUsage.get(agentId) ?? new Set<string>();
    const declaredTools = new Set(agent.tools);

    for (const tool of observedTools) {
      if (!declaredTools.has(tool)) {
        drifts.push({
          kind: 'undeclared-tool',
          agentId,
          toolId: tool,
          message: `Agent "${agentId}" called tool "${tool}" in production but doesn't declare it in the catalog.`,
        });
      }

      if (!cat.entities.get('tool')?.has(tool)) {
        drifts.push({
          kind: 'unknown-tool',
          agentId,
          toolId: tool,
          message: `Tool "${tool}" was called by agent "${agentId}" in production but has no Tool entity in the catalog.`,
        });
      }
    }

    if (observedTools.size > 0) {
      for (const tool of declaredTools) {
        if (!observedTools.has(tool)) {
          drifts.push({
            kind: 'unused-declared-tool',
            agentId,
            toolId: tool,
            message: `Agent "${agentId}" declares tool "${tool}" but never called it in this trace window. Confirm intent or remove.`,
          });
        }
      }
    }
  }

  const byKind = { ...EMPTY_COUNTS };

  for (const d of drifts) byKind[d.kind] += 1;

  return {
    observedAgents: obs.agents.size,
    observedSpans: obs.spanCount,
    driftCount: drifts.length,
    byKind,
    drifts,
  };
};
