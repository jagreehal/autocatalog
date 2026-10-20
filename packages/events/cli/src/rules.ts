import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RULES_CONFIG_FILE,
  RULES_DIRECTORY,
  newSinceBase,
  ruleFindings,
  ruleResult,
  rulesConfig,
  type DriftFinding,
  type ResourceGraph,
  type RuleContext,
  type RuleOutcome,
} from 'autocatalog-core';
import { AdapterExecutionError, runIsolated } from './adapters';

const RULE_PROTOCOL = 'autocatalog/rule-v1';

// Names a report can print as they are.
const RULE_FILE = /^[\w.-]{1,100}\.rule\.(ts|mts|js|mjs)$/;

const RULE_HOST = String.raw`
const fs = await import('node:fs');
try {
  const loaded = await import(process.argv[1]);
  const rule = loaded.default;
  if (!rule || typeof rule.run !== 'function') {
    throw new Error('the default export is not a rule: export default defineRule({ id, name, run })');
  }
  const context = JSON.parse(fs.readFileSync(0, 'utf8'));
  const violations = await rule.run(context);
  fs.writeFileSync(3, JSON.stringify({
    protocol: '${RULE_PROTOCOL}',
    result: { id: rule.id, name: rule.name, severity: rule.severity, violations },
  }));
} catch (error) {
  fs.writeFileSync(2, error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
`;

/** The rule files a repository keeps, relative to its root. */
export async function discoverRules(root: string): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, RULES_DIRECTORY)).catch(() => []);

  return entries
    .filter((name) => RULE_FILE.test(name))
    .sort()
    .map((name) => path.join(RULES_DIRECTORY, name));
}

async function readRulesConfig(root: string) {
  const file = path.join(root, RULES_DIRECTORY, RULES_CONFIG_FILE);
  const text = await fs.readFile(file, 'utf8').catch(() => undefined);

  if (text === undefined) return {};

  try {
    return rulesConfig.parse(JSON.parse(text));
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function runRule(root: string, file: string, context: RuleContext): Promise<RuleOutcome> {
  try {
    const result = await runIsolated({
      name: file,
      entry: path.join(root, file),
      root,
      // The rule's own tree and nothing else: no packages, so a change cannot reach it.
      readOnly: [root],
      host: RULE_HOST,
      protocol: RULE_PROTOCOL,
      args: [],
      stdin: JSON.stringify(context),
    });

    const parsed = ruleResult.safeParse(result);

    return parsed.success
      ? { file, result: parsed.data }
      : { file, error: `it returned no rule result (${parsed.error.issues[0]?.message})` };
  } catch (error) {
    return { file, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The repository's rules, run against the catalog the change leaves and the
 * one it started from. A violation the base already had drops to info, as
 * runtime drift does, so adding a rule never fails every open pull request.
 * Rules are repository code, so they run only with consent, and isolated.
 */
export async function runRules(input: {
  root: string;
  /** Read only when there are rules to run. */
  graphs: () => Promise<{ current: ResourceGraph; base?: ResourceGraph }>;
  baseLabel?: string;
  allowCodeExecution?: boolean;
}): Promise<DriftFinding[]> {
  const files = await discoverRules(input.root);

  if (files.length === 0) return [];

  if (!input.allowCodeExecution) {
    throw new AdapterExecutionError(
      'code_execution_consent_required',
      `${RULES_DIRECTORY} has ${files.length} rule(s); rerun with --allow-code-execution only for a repository you trust`,
    );
  }

  const config = await readRulesConfig(input.root);
  const { current, base } = await input.graphs();

  const [now, before] = await Promise.all([
    Promise.all(files.map((file) => runRule(input.root, file, { current, ...(base && { base }) }))),
    base ? Promise.all(files.map((file) => runRule(input.root, file, { current: base }))) : [],
  ]);

  // A rule that fails to run on the base must not excuse the same failure now.
  const baseline = ruleFindings(
    before.filter((outcome) => 'result' in outcome),
    config,
  );

  return newSinceBase(ruleFindings(now, config), baseline, input.baseLabel);
}
