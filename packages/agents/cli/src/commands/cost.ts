import { resolve } from 'node:path';
import kleur from 'kleur';
import {
  estimateAgentCost,
  loadCatalog,
  rollupCost,
  totalMonthlyCost,
  type RollupKey,
} from 'autocatalog-agents-core';

const fmt = (n: number): string => {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  if (n >= 1) return `$${n.toFixed(2)}`;

  return `$${n.toFixed(4)}`;
};

const parseAgentRef = (s: string): string | null => {
  if (s.startsWith('agent/')) return s.slice('agent/'.length);

  if (s.includes('/')) return null;

  return s;
};

export const runCost = async (args: string[]): Promise<number> => {
  let root = '.';
  let target: string | null = null;
  let by: RollupKey | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') root = args[++i] ?? '.';
    else if (a === '--by-domain') by = 'domain';
    else if (a === '--by-owner') by = 'owner';
    else if (a === '--by-model') by = 'model';
    else if (a === '--by') {
      const key = args[++i];

      if (key === undefined) by = null;
      else if (key === 'domain' || key === 'owner' || key === 'model') by = key;
      else {
        process.stderr.write(`expected --by domain|owner|model, got "${key}"\n`);

        return 2;
      }
    } else if (!target) target = a;
  }

  const cat = await loadCatalog(resolve(root));

  if (by) {
    const rows = rollupCost(cat, by);
    process.stdout.write(`${kleur.bold(`Cost rollup by ${by}:`)}\n\n`);

    if (rows.length === 0) {
      process.stdout.write(`  ${kleur.dim('(no agents)')}\n`);

      return 0;
    }

    const bucketWidth = Math.max(...rows.map((r) => r.bucket.length), 12);
    process.stdout.write(
      `  ${kleur.dim(by.padEnd(bucketWidth))}  ${kleur.dim('monthly'.padStart(12))}  ${kleur.dim('agents')}\n`,
    );

    for (const r of rows) {
      const monthly =
        r.estimatedCount === r.agentCount ? fmt(r.monthlyTotal) : `~${fmt(r.monthlyTotal)}`;

      const agents = `${r.estimatedCount}/${r.agentCount}`;
      process.stdout.write(
        `  ${r.bucket.padEnd(bucketWidth)}  ${monthly.padStart(12)}  ${agents}\n`,
      );
    }

    const totals = totalMonthlyCost(cat);
    process.stdout.write(
      `\n  ${kleur.bold('total'.padEnd(bucketWidth))}  ${kleur.bold(fmt(totals.total).padStart(12))}  ${totals.estimatedAgents}/${totals.totalAgents}\n`,
    );

    if (totals.estimatedAgents < totals.totalAgents) {
      process.stdout.write(
        `\n  ${kleur.dim(`(${totals.totalAgents - totals.estimatedAgents} agent(s) have no expected_traffic; totals exclude them)`)}\n`,
      );
    }

    return 0;
  }

  if (!target) {
    const totals = totalMonthlyCost(cat);
    process.stdout.write(
      `${kleur.bold('Total monthly cost')}: ${fmt(totals.total)} ${kleur.dim(`(${totals.estimatedAgents}/${totals.totalAgents} agents estimated)`)}\n`,
    );
    process.stdout.write(
      `${kleur.dim('Use --by-domain | --by-owner | --by-model for a rollup,')}\n`,
    );
    process.stdout.write(
      `${kleur.dim('or `ac-agents cost <agent-id>` for a single-agent breakdown.')}\n`,
    );

    return 0;
  }

  const agentId = parseAgentRef(target);

  if (!agentId) {
    process.stderr.write(`expected an agent id or "agent/<id>", got "${target}"\n`);

    return 2;
  }

  if (!cat.entities.get('agent')?.has(agentId)) {
    process.stderr.write(`unknown agent: ${agentId}\n`);

    return 1;
  }

  const cost = estimateAgentCost(cat, agentId);
  process.stdout.write(
    `${kleur.bold('cost:')} ${kleur.cyan('agent/')}${kleur.bold(cost.agentId)}\n`,
  );
  process.stdout.write(`  ${kleur.dim('model:'.padEnd(18))}${cost.modelId}\n`);

  if (!cost.monthly) {
    process.stdout.write(`  ${kleur.yellow('unestimated:')} ${cost.reason ?? 'unknown'}\n`);

    return 0;
  }

  process.stdout.write(
    `  ${kleur.dim('invocations/day:'.padEnd(18))}${cost.invocationsPerDay?.toLocaleString()}\n`,
  );
  process.stdout.write(
    `  ${kleur.dim('per invocation:'.padEnd(18))}${fmt(cost.perInvocation!.total)}  ${kleur.dim(`(in ${fmt(cost.perInvocation!.input)} / out ${fmt(cost.perInvocation!.output)})`)}\n`,
  );
  process.stdout.write(`  ${kleur.dim('daily:'.padEnd(18))}${fmt(cost.daily!.total)}\n`);
  process.stdout.write(
    `  ${kleur.dim('monthly (~30d):'.padEnd(18))}${kleur.bold(fmt(cost.monthly.total))}\n`,
  );

  return 0;
};
