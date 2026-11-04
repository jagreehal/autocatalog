// Type-only: the browser entry re-exports this module, and the core runtime reads node:fs.
import type { Catalog } from 'autocatalog-agents-core';
import type { Observations } from './parse.js';

export type DriftKind =
  | 'unknown-agent'
  | 'undeclared-tool'
  | 'unknown-tool'
  | 'unused-declared-tool'
  | 'model-mismatch'
  | 'undeclared-model'
  | 'unknown-mcp-server'
  | 'tool-not-in-snapshot';

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
  'unknown-mcp-server': 0,
  'tool-not-in-snapshot': 0,
};

/** Reported in place of an agent when a gateway made the call and did not say for whom. */
export const GATEWAY_CALLER = '(gateway)';

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

const hostOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};

/** The catalog's id for a server a trace named: by id, address, or configured name. */
const resolveServer = (cat: Catalog, observed: string): string | undefined => {
  const wanted = observed.toLowerCase();

  for (const entity of cat.entities.get('mcp-server')?.values() ?? []) {
    if (entity.kind !== 'mcp-server') continue;

    const names = [
      entity.id,
      hostOf(entity.url),
      entity.snapshot?.integration,
      ...(entity.discovery?.sources.map(({ symbol }) => symbol) ?? []),
    ];

    if (names.some((name) => name?.toLowerCase() === wanted)) return entity.id;
  }

  return undefined;
};

/** Whether the Tool entry with this id belongs to a server other than the one called. */
const belongsElsewhere = (cat: Catalog, tool: string, server: string | undefined): boolean => {
  const entity = cat.entities.get('tool')?.get(tool);

  return entity?.kind === 'tool' && !!server && !!entity.server && entity.server !== server;
};

/** The Tool entry a call reaches, when a trace uses the server's name for it. */
const resolveTool = (cat: Catalog, observed: string, server: string | undefined): string => {
  if (cat.entities.get('tool')?.has(observed) && !belongsElsewhere(cat, observed, server)) {
    return observed;
  }

  for (const entity of cat.entities.get('tool')?.values() ?? []) {
    if (
      entity.kind === 'tool' &&
      entity.mcp_name === observed &&
      (!server || entity.server === server)
    ) {
      return entity.id;
    }
  }

  return observed;
};

export const computeDrift = (cat: Catalog, obs: Observations): DriftReport => {
  const drifts: Drift[] = [];
  const seen = new Set<string>();

  for (const { agent, server, tool } of obs.mcpCalls) {
    const agentId = agent ?? GATEWAY_CALLER;
    const serverId = resolveServer(cat, server);

    if (!serverId) {
      if (!seen.has(`${agentId}/${server}`)) {
        drifts.push({
          kind: 'unknown-mcp-server',
          agentId,
          message: `MCP server "${server}" was called by ${agent ? `agent "${agent}"` : 'a gateway'} in production but is not in the catalog. Run ac agents discover --from mcp, or add it by hand.`,
        });
      }

      seen.add(`${agentId}/${server}`);
      continue;
    }

    const snapshots = cat.snapshots.get(serverId) ?? [];

    if (
      snapshots.length > 0 &&
      !snapshots.some(({ tools }) => tools.some((t) => t.name === tool))
    ) {
      drifts.push({
        kind: 'tool-not-in-snapshot',
        agentId,
        toolId: tool,
        message: `Tool "${tool}" was called on MCP server "${serverId}" but is not in its snapshot. The server changed since the last ac agents snapshot, or another identity sees different tools.`,
      });
    }
  }

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

    const declaredTools = new Set(agent.tools);
    const observedTools = new Set<string>();
    const checked = new Set<string>();

    for (const raw of obs.toolUsage.get(agentId) ?? []) {
      const called = obs.mcpCalls
        .filter((call) => call.agent === agentId && call.tool === raw)
        .map(({ server }) => resolveServer(cat, server) ?? server);

      // Permission is per server: a tool of this name elsewhere says nothing about this call.
      for (const server of called.length > 0 ? called : [undefined]) {
        const tool = resolveTool(cat, raw, server);
        const foreign = belongsElsewhere(cat, tool, server);
        const pair = JSON.stringify([tool, server]);

        if (!foreign) observedTools.add(tool);

        if (checked.has(pair) || (server && agent.servers.includes(server))) continue;

        checked.add(pair);

        const where = server ? ` on MCP server "${server}"` : '';

        if (foreign || !declaredTools.has(tool)) {
          drifts.push({
            kind: 'undeclared-tool',
            agentId,
            toolId: tool,
            message: `Agent "${agentId}" called tool "${tool}"${where} in production but doesn't declare it in the catalog.`,
          });
        }

        if (foreign || !cat.entities.get('tool')?.has(tool)) {
          drifts.push({
            kind: 'unknown-tool',
            agentId,
            toolId: tool,
            message: `Tool "${tool}" was called by agent "${agentId}"${where} in production but has no Tool entity in the catalog.`,
          });
        }
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
