import { computeImpact } from './impact.js';
import { estimateAgentCost } from './cost.js';
import { entitiesOf, entityOf, refKey, type Catalog } from './loader.js';

const COST_CEILING_USD = (() => {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.AGENTCATALOG_COST_CEILING_USD : undefined;

  const parsed = fromEnv ? Number(fromEnv) : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
})();

const DOMAIN_COST_CEILING_USD = (() => {
  const fromEnv =
    typeof process !== 'undefined' ? process.env?.AGENTCATALOG_DOMAIN_COST_CEILING_USD : undefined;

  const parsed = fromEnv ? Number(fromEnv) : NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
})();

import type { Entity, EntityKind, Model } from './schemas.js';

export type Severity = 'P0' | 'P1' | 'P2';

export type Finding = {
  rule: string;
  severity: Severity;
  ref: { kind: EntityKind; id: string } | null;
  message: string;
  details?: FindingDetails;
};

/** Rule-specific evidence attached to a finding. Each rule sets only its own fields. */
export type FindingDetails = {
  adapter?: string;
  sources?: NonNullable<Entity['discovery']>['sources'];
  needsReview?: string[];
  dangerousTools?: string[];
  reason?: string;
  model?: string;
  modelStatus?: Model['status'];
  monthly?: number;
  ceiling?: number;
  missingFiles?: string[];
  cycle?: string[];
};

type CycleCheck = { cycle: boolean; path?: string[] };

export type AuditOptions = {
  /** Skip rules with these ids. */
  skip?: string[];
};

const isDestructive = (s?: string): boolean => s === 'external-write' || s === 'destructive';

const dependents = (cat: Catalog, kind: EntityKind, id: string) =>
  computeImpact(cat, { kind, id }).dependents;

const hasCycle = (steps: Array<{ from: string; to: string }>): CycleCheck => {
  const adj = new Map<string, string[]>();

  for (const s of steps) {
    const list = adj.get(s.from) ?? [];
    list.push(s.to);
    adj.set(s.from, list);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;

  const color = new Map<string, number>();
  let cyclePath: string[] | undefined;

  const visit = (n: string, stack: string[]): boolean => {
    color.set(n, GRAY);
    stack.push(n);

    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? WHITE;

      if (c === GRAY) {
        const idx = stack.indexOf(m);
        cyclePath = stack.slice(idx).concat(m);

        return true;
      }

      if (c === WHITE && visit(m, stack)) return true;
    }

    color.set(n, BLACK);
    stack.pop();

    return false;
  };

  for (const n of adj.keys()) {
    if ((color.get(n) ?? WHITE) === WHITE) {
      if (visit(n, [])) return { cycle: true, path: cyclePath };
    }
  }

  return { cycle: false };
};

const RULES: Array<(cat: Catalog) => Finding[]> = [
  // P1: Inferred entities are useful drafts, but not production-ready declarations
  (cat) => {
    const out: Finding[] = [];

    for (const [kind, entities] of cat.entities.entries()) {
      for (const entity of entities.values()) {
        const discovery = entity.discovery;

        if (!discovery || discovery.confidence !== 'inferred') continue;
        out.push({
          rule: 'inferred-entity-needs-review',
          severity: 'P1',
          ref: { kind, id: entity.id },
          message: `${kind}/${entity.id} was inferred from ${discovery.adapter} source and still needs human review before production use.`,
          details: {
            adapter: discovery.adapter,
            sources: discovery.sources,
            needsReview: discovery.needs_review,
          },
        });
      }
    }

    return out;
  },

  // P0: any Agent with risk=high but no Eval targeting it
  (cat) => {
    const out: Finding[] = [];
    const evalsByTarget = new Map<string, string[]>();

    for (const e of entitiesOf(cat, 'eval')) {
      const list = evalsByTarget.get(e.target) ?? [];
      list.push(e.id);
      evalsByTarget.set(e.target, list);
    }

    for (const a of entitiesOf(cat, 'agent')) {
      if (a.risk !== 'high') continue;
      const evs = evalsByTarget.get(a.id) ?? [];

      if (evs.length === 0) {
        out.push({
          rule: 'high-risk-no-eval',
          severity: 'P0',
          ref: { kind: 'agent', id: a.id },
          message: `High-risk Agent "${a.id}" has no Eval targeting it. Risk changes ship blind.`,
        });
      }
    }

    return out;
  },

  // P0: Agent uses an external-write/destructive Tool but declares no Policies
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      if (a.policies.length > 0) continue;

      const dangerous = a.tools.filter((tid) => {
        const t = entityOf(cat, 'tool', tid);

        return t && isDestructive(t.side_effects);
      });

      if (dangerous.length > 0) {
        out.push({
          rule: 'external-write-no-policy',
          severity: 'P0',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" uses externally-visible Tools (${dangerous.join(', ')}) but references no Policy. Add a Policy or downgrade the Tool.`,
          details: { dangerousTools: dangerous },
        });
      }
    }

    return out;
  },

  // P1: Agent has no expected_traffic, so cost cannot be estimated
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      const cost = estimateAgentCost(cat, a.id);

      if (!cost.monthly) {
        out.push({
          rule: 'unestimated-cost',
          severity: 'P1',
          ref: { kind: 'agent', id: a.id },
          message: `Cost not estimated: ${cost.reason ?? 'missing data'}.`,
          details: { reason: cost.reason },
        });
      }
    }

    return out;
  },

  // P1: Tool side effects must be reviewed before the tool can be treated as production-ready
  (cat) => {
    const out: Finding[] = [];

    for (const t of entitiesOf(cat, 'tool')) {
      if (t.side_effects !== 'unknown') continue;
      out.push({
        rule: 'tool-side-effects-unknown',
        severity: 'P1',
        ref: { kind: 'tool', id: t.id },
        message: `Tool "${t.id}" has unknown side effects. Classify it as read-only, mutating, external-write, or destructive before production use.`,
      });
    }

    return out;
  },

  // P1: Agent missing prompts.system reference
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      if (!a.prompts?.system) {
        out.push({
          rule: 'agent-without-prompt',
          severity: 'P1',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" has no system prompt reference. Prompts should be versioned files, not inlined or implicit.`,
        });
      }
    }

    return out;
  },

  // P2: Tool with no consuming Agent
  (cat) => {
    const out: Finding[] = [];

    for (const tool of cat.entities.get('tool')?.values() ?? []) {
      const deps = dependents(cat, 'tool', tool.id);

      if (deps.length === 0) {
        out.push({
          rule: 'orphan-tool',
          severity: 'P2',
          ref: { kind: 'tool', id: tool.id },
          message: `Tool "${tool.id}" is not used by any Agent. Remove it or wire it up.`,
        });
      }
    }

    return out;
  },

  // P2: Model with no consuming Agent
  (cat) => {
    const out: Finding[] = [];

    for (const model of cat.entities.get('model')?.values() ?? []) {
      const deps = dependents(cat, 'model', model.id);

      if (deps.length === 0) {
        out.push({
          rule: 'orphan-model',
          severity: 'P2',
          ref: { kind: 'model', id: model.id },
          message: `Model "${model.id}" is not used by any Agent. Remove the entry or migrate an Agent to it.`,
        });
      }
    }

    return out;
  },

  // P2: Policy with no consuming Agent
  (cat) => {
    const out: Finding[] = [];

    for (const policy of cat.entities.get('policy')?.values() ?? []) {
      const deps = dependents(cat, 'policy', policy.id);

      if (deps.length === 0) {
        out.push({
          rule: 'orphan-policy',
          severity: 'P2',
          ref: { kind: 'policy', id: policy.id },
          message: `Policy "${policy.id}" is not referenced by any Agent. Either reference it or retire it.`,
        });
      }
    }

    return out;
  },

  // P2: Agent missing domain assignment
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      if (!a.domain) {
        out.push({
          rule: 'agent-without-domain',
          severity: 'P2',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" has no domain. Group under a Domain for ownership and rollups.`,
        });
      }
    }

    return out;
  },

  // P0: Agent still references a Model marked deprecated/retired
  (cat) => {
    const out: Finding[] = [];
    const deprecatedModels = new Set<string>();

    for (const m of entitiesOf(cat, 'model')) {
      if (m.status === 'deprecated' || m.status === 'retired') deprecatedModels.add(m.id);
    }

    if (deprecatedModels.size === 0) return out;

    for (const a of entitiesOf(cat, 'agent')) {
      if (deprecatedModels.has(a.model)) {
        const m = entityOf(cat, 'model', a.model);
        out.push({
          rule: 'deprecated-model-in-use',
          severity: 'P0',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" still uses ${m?.status ?? 'deprecated'} Model "${a.model}". Migrate to a supported model.`,
          details: { model: a.model, modelStatus: m?.status },
        });
      }
    }

    return out;
  },

  // P1: Agent monthly cost exceeds the catalog ceiling (default $5000, override via AGENTCATALOG_COST_CEILING_USD)
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      const cost = estimateAgentCost(cat, a.id);

      if (cost.monthly && cost.monthly.total > COST_CEILING_USD) {
        out.push({
          rule: 'cost-ceiling-exceeded',
          severity: 'P1',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" estimated monthly cost is $${cost.monthly.total} — exceeds the $${COST_CEILING_USD} ceiling. Consider a cheaper Model, traffic shaping, or raising the ceiling via AGENTCATALOG_COST_CEILING_USD.`,
          details: { monthly: cost.monthly.total, ceiling: COST_CEILING_USD },
        });
      }
    }

    return out;
  },

  // P1: Agent declares a prompts.system file that doesn't exist on disk
  (cat) => {
    const out: Finding[] = [];

    for (const a of entitiesOf(cat, 'agent')) {
      const m = cat.meta.get(refKey('agent', a.id));

      if (m?.missingFiles && m.missingFiles.length > 0) {
        out.push({
          rule: 'prompt-file-missing',
          severity: 'P1',
          ref: { kind: 'agent', id: a.id },
          message: `Agent "${a.id}" references a prompt file that doesn't exist: ${m.missingFiles[0]}. Either create the file or update the prompts.system reference.`,
          details: { missingFiles: m.missingFiles },
        });
      }
    }

    return out;
  },

  // P1: Eval declares a cases file that doesn't exist on disk
  (cat) => {
    const out: Finding[] = [];

    for (const e of entitiesOf(cat, 'eval')) {
      const m = cat.meta.get(refKey('eval', e.id));

      if (m?.missingFiles && m.missingFiles.length > 0) {
        out.push({
          rule: 'eval-cases-file-missing',
          severity: 'P1',
          ref: { kind: 'eval', id: e.id },
          message: `Eval "${e.id}" references a cases file that doesn't exist: ${m.missingFiles[0]}. Either create the file or update the cases reference.`,
          details: { missingFiles: m.missingFiles },
        });
      }
    }

    return out;
  },

  // P1: Domain's total monthly cost exceeds the configured ceiling
  (cat) => {
    const out: Finding[] = [];
    const totals = new Map<string, number>();

    for (const a of entitiesOf(cat, 'agent')) {
      if (!a.domain) continue;
      const cost = estimateAgentCost(cat, a.id);

      if (!cost.monthly) continue;
      totals.set(a.domain, (totals.get(a.domain) ?? 0) + cost.monthly.total);
    }

    for (const [domainId, total] of totals.entries()) {
      if (total <= DOMAIN_COST_CEILING_USD) continue;
      const domainExists = cat.entities.get('domain')?.has(domainId);
      out.push({
        rule: 'domain-cost-ceiling-exceeded',
        severity: 'P1',
        ref: domainExists ? { kind: 'domain', id: domainId } : null,
        message: `Domain "${domainId}" estimated monthly cost is $${Math.round(total)} — exceeds the $${DOMAIN_COST_CEILING_USD} ceiling. Investigate or raise via AGENTCATALOG_DOMAIN_COST_CEILING_USD.`,
        details: { monthly: Math.round(total), ceiling: DOMAIN_COST_CEILING_USD },
      });
    }

    return out;
  },

  // P1: Workflow flow contains a cycle (handoff loop)
  (cat) => {
    const out: Finding[] = [];

    for (const w of entitiesOf(cat, 'workflow')) {
      if (w.flow.length === 0) continue;
      const { cycle, path } = hasCycle(w.flow);

      if (cycle) {
        out.push({
          rule: 'workflow-cycle',
          severity: 'P1',
          ref: { kind: 'workflow', id: w.id },
          message: `Workflow "${w.id}" flow contains a cycle (${path?.join(' → ') ?? 'unknown path'}). Verify the handoff intent — agent loops eat cost and confuse observability.`,
          details: { cycle: path },
        });
      }
    }

    return out;
  },
];

export const SEVERITY_ORDER: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };

export const auditCatalog = (cat: Catalog, opts: AuditOptions = {}): Finding[] => {
  const skip = new Set(opts.skip ?? []);
  const findings: Finding[] = [];

  for (const rule of RULES) {
    for (const f of rule(cat)) {
      if (!skip.has(f.rule)) findings.push(f);
    }
  }

  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

    if (s !== 0) return s;

    return a.rule.localeCompare(b.rule);
  });

  return findings;
};

export const groupFindings = (findings: Finding[]): Record<Severity, Finding[]> => {
  const out: Record<Severity, Finding[]> = { P0: [], P1: [], P2: [] };

  for (const f of findings) out[f.severity].push(f);

  return out;
};
