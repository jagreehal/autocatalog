import { resolve } from 'node:path';
import kleur from 'kleur';
import { loadCatalog } from 'autocatalog-agents-core';
import { computeDrift, loadObservations, type DriftKind } from 'autocatalog-agents-adapter-autotel';

const KIND_COLOR: Record<DriftKind, (s: string) => string> = {
  'unknown-agent': kleur.red,
  'undeclared-tool': kleur.red,
  'unknown-tool': kleur.red,
  'undeclared-model': kleur.yellow,
  'model-mismatch': kleur.red,
  'unused-declared-tool': kleur.dim,
};

export const runDrift = async (args: string[]): Promise<number> => {
  let root = '.';
  let file: string | null = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') root = args[++i] ?? '.';
    else if (a === '--json') json = true;
    else if (!file) file = a;
  }

  if (!file) {
    process.stderr.write('usage: ac-agents drift <otlp-file> [--root <catalog>] [--json]\n');

    return 2;
  }

  const cat = await loadCatalog(resolve(root));
  const obs = await loadObservations(resolve(file));
  const report = computeDrift(cat, obs);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');

    return report.driftCount === 0 ? 0 : 1;
  }

  process.stdout.write(
    `${kleur.bold('drift:')} ${report.driftCount} finding${report.driftCount === 1 ? '' : 's'}`,
  );
  process.stdout.write(
    `  ${kleur.dim(`(${report.observedSpans} spans across ${report.observedAgents} agent(s))`)}\n\n`,
  );

  if (report.drifts.length === 0) {
    process.stdout.write(
      `${kleur.green('✓ no drift — observed reality matches declared catalog')}\n`,
    );

    return 0;
  }

  for (const d of report.drifts) {
    const color = KIND_COLOR[d.kind];
    process.stdout.write(`  ${color('•')} ${kleur.bold(d.kind)} — agent/${d.agentId}`);

    if (d.toolId) process.stdout.write(`  → tool/${d.toolId}`);
    process.stdout.write(`\n      ${d.message}\n`);
  }

  process.stdout.write('\n');

  return 1;
};
