import { entitiesOf, type Catalog } from './loader.js';
import type { EntityKind } from './schemas.js';

export type EdgeIssue = {
  from: { kind: EntityKind; id: string };
  ref: { kind: EntityKind; id: string };
  message: string;
};

const lookup = (cat: Catalog, kind: EntityKind, id: string): boolean =>
  cat.entities.get(kind)?.has(id) ?? false;

export const validateEdges = (cat: Catalog): EdgeIssue[] => {
  const issues: EdgeIssue[] = [];

  for (const a of entitiesOf(cat, 'agent')) {
    if (!lookup(cat, 'model', a.model)) {
      issues.push({
        from: { kind: 'agent', id: a.id },
        ref: { kind: 'model', id: a.model },
        message: `Agent "${a.id}" references unknown Model "${a.model}"`,
      });
    }

    for (const toolId of a.tools) {
      if (!lookup(cat, 'tool', toolId)) {
        issues.push({
          from: { kind: 'agent', id: a.id },
          ref: { kind: 'tool', id: toolId },
          message: `Agent "${a.id}" references unknown Tool "${toolId}"`,
        });
      }
    }

    for (const policyId of a.policies) {
      if (!lookup(cat, 'policy', policyId)) {
        issues.push({
          from: { kind: 'agent', id: a.id },
          ref: { kind: 'policy', id: policyId },
          message: `Agent "${a.id}" references unknown Policy "${policyId}"`,
        });
      }
    }

    if (a.domain && !lookup(cat, 'domain', a.domain)) {
      issues.push({
        from: { kind: 'agent', id: a.id },
        ref: { kind: 'domain', id: a.domain },
        message: `Agent "${a.id}" references unknown Domain "${a.domain}"`,
      });
    }
  }

  for (const t of entitiesOf(cat, 'tool')) {
    if (t.domain && !lookup(cat, 'domain', t.domain)) {
      issues.push({
        from: { kind: 'tool', id: t.id },
        ref: { kind: 'domain', id: t.domain },
        message: `Tool "${t.id}" references unknown Domain "${t.domain}"`,
      });
    }
  }

  for (const w of entitiesOf(cat, 'workflow')) {
    for (const agentId of w.agents) {
      if (!lookup(cat, 'agent', agentId)) {
        issues.push({
          from: { kind: 'workflow', id: w.id },
          ref: { kind: 'agent', id: agentId },
          message: `Workflow "${w.id}" references unknown Agent "${agentId}"`,
        });
      }
    }

    for (const step of w.flow) {
      for (const id of [step.from, step.to]) {
        if (!lookup(cat, 'agent', id)) {
          issues.push({
            from: { kind: 'workflow', id: w.id },
            ref: { kind: 'agent', id },
            message: `Workflow "${w.id}" flow references unknown Agent "${id}"`,
          });
        }
      }
    }

    if (w.domain && !lookup(cat, 'domain', w.domain)) {
      issues.push({
        from: { kind: 'workflow', id: w.id },
        ref: { kind: 'domain', id: w.domain },
        message: `Workflow "${w.id}" references unknown Domain "${w.domain}"`,
      });
    }
  }

  for (const e of entitiesOf(cat, 'eval')) {
    if (!lookup(cat, 'agent', e.target)) {
      issues.push({
        from: { kind: 'eval', id: e.id },
        ref: { kind: 'agent', id: e.target },
        message: `Eval "${e.id}" targets unknown Agent "${e.target}"`,
      });
    }
  }

  return issues;
};
