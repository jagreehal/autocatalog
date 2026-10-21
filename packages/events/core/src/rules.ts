import { z } from 'zod';
import { isSafeName } from './consumes';
import type { DriftFinding, DriftSeverity } from './drift';
import type { ResourceGraph, ResourceRef } from './resource-graph';

/** Where a repository keeps its rules: one per `*.rule.{ts,mts,js,mjs}` file. */
export const RULES_DIRECTORY = 'contracts/rules';

/** Severities and exceptions for the rules, beside them. */
export const RULES_CONFIG_FILE = 'rules.json';

export type RuleSeverity = Exclude<DriftSeverity, 'additive'>;

export interface RuleViolation {
  message: string;
  /** The resource the violation is about, as the graph names it. */
  resource?: ResourceRef;
  /** What to do about it. */
  suggestion?: string;
}

export interface RuleContext {
  /** The catalog as the change leaves it. */
  current: ResourceGraph;
  /** The catalog before the change, when `ac drift` has one. */
  base?: ResourceGraph;
}

export interface CatalogRule {
  /** Names the rule in reports and in `rules.json`. */
  id: string;
  name: string;
  description?: string;
  /** How a violation gates: `breaking` (the default), `suspicious` or `info`. */
  severity?: RuleSeverity;
  run(context: RuleContext): RuleViolation[] | Promise<RuleViolation[]>;
}

const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const ruleSeverity = z.enum(['breaking', 'suspicious', 'info']);

const resourceRef = z.object({
  kind: z.string(),
  namespace: z.string().optional(),
  id: z.string(),
  version: z.string().optional(),
});

/** What one rule's run reports back from its isolated process. */
export const ruleResult = z.object({
  id: z.string().regex(RULE_ID, 'use lowercase letters, digits and -'),
  name: z.string().min(1).max(200),
  severity: ruleSeverity.optional(),
  violations: z
    .array(
      z.object({
        message: z.string().min(1).max(2000),
        resource: resourceRef.optional(),
        suggestion: z.string().max(2000).optional(),
      }),
    )
    .max(1000),
});

export type RuleResult = z.infer<typeof ruleResult>;

/** `rules.json`: a severity per rule, and the resources each rule leaves alone. */
export const rulesConfig = z.strictObject({
  severity: z.record(z.string(), ruleSeverity.or(z.literal('off'))).optional(),
  /** Resource keys a rule skips, such as `event:payments/legacy.charged`; `*` matches any run. */
  except: z.record(z.string(), z.array(z.string())).optional(),
});

export type RulesConfig = z.infer<typeof rulesConfig>;

/** A rule that ran on one side of the change, or the reason it could not. */
export type RuleOutcome = { file: string } & ({ result: RuleResult } | { error: string });

const pattern = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split('*')
      .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );

const refLabel = (ref: ResourceRef): string =>
  `${ref.kind}:${ref.namespace ? `${ref.namespace}/` : ''}${ref.id}`;

// Rule output is repository code's output, printed into pull request reports.
const printable = (text: string): string => text.replaceAll(/[\p{Cc}`|<>[\]!@]/gu, ' ');

/**
 * Each rule's violations as drift findings, so one report and one `--fail-on`
 * gate cover them. A rule that could not run is breaking whatever its
 * severity: a gate that skipped a check has not passed it.
 */
export function ruleFindings(outcomes: RuleOutcome[], config: RulesConfig = {}): DriftFinding[] {
  return outcomes.flatMap((outcome): DriftFinding[] => {
    if ('error' in outcome) {
      return [
        {
          domain: '',
          eventId: `rule ${printable(outcome.file)}`,
          severity: 'breaking',
          kind: 'rule_failed',
          message: `the rule in ${printable(outcome.file)} did not run: ${printable(outcome.error).slice(0, 500)}. Fix it, or remove it`,
          consumers: [],
          subject: outcome.file,
        },
      ];
    }

    const { id, name, violations } = outcome.result;
    const severity = config.severity?.[id] ?? outcome.result.severity ?? 'breaking';

    if (severity === 'off') return [];

    const except = (config.except?.[id] ?? []).map(pattern);

    return violations.flatMap((violation): DriftFinding[] => {
      const { resource } = violation;

      if (resource && except.some((skip) => skip.test(refLabel(resource)))) return [];

      const label = resource && isSafeName(refLabel(resource).replace(':', '/'));
      const suggestion = violation.suggestion ? `. ${printable(violation.suggestion)}` : '';

      return [
        {
          ...(resource && { resource }),
          domain: label ? (resource.namespace ?? '') : '',
          eventId: label ? `${resource.kind}/${resource.id}` : 'catalog',
          severity,
          kind: 'rule_violation',
          message: `${printable(name)} (${id}): ${printable(violation.message)}${suggestion}`,
          consumers: [],
          subject: `${id}\0${resource ? refLabel(resource) : ''}`,
          fingerprint: violation.message,
        },
      ];
    });
  });
}
