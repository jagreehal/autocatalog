import { resolve } from 'node:path';
import kleur from 'kleur';
import { auditCatalog, groupFindings, loadCatalog, type Severity } from 'autocatalog-agents-core';

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  P0: kleur.red,
  P1: kleur.yellow,
  P2: kleur.dim,
};

export const runAudit = async (args: string[]): Promise<number> => {
  let root = '.';
  let json = false;
  let failOn: Severity = 'P0';

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') root = args[++i] ?? '.';
    else if (a === '--json') json = true;
    else if (a === '--fail-on') {
      // Anything but P1/P2 has always meant the P0 threshold.
      const severity = args[++i];
      failOn = severity === 'P1' || severity === 'P2' ? severity : 'P0';
    } else if (!root || root === '.') root = a;
  }

  const cat = await loadCatalog(resolve(root));
  const findings = auditCatalog(cat);

  if (json) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
  } else {
    const grouped = groupFindings(findings);
    const counts = `${kleur.red(`P0: ${grouped.P0.length}`)}  ${kleur.yellow(`P1: ${grouped.P1.length}`)}  ${kleur.dim(`P2: ${grouped.P2.length}`)}`;
    process.stdout.write(`${kleur.bold('audit:')} ${counts}\n\n`);

    if (findings.length === 0) {
      process.stdout.write(`${kleur.green('✓ no findings')}\n`);
    } else {
      for (const sev of ['P0', 'P1', 'P2'] as const) {
        const bucket = grouped[sev];

        if (bucket.length === 0) continue;
        process.stdout.write(SEVERITY_COLOR[sev](`${sev}  (${bucket.length})\n`));

        for (const f of bucket) {
          const refStr = f.ref ? `${f.ref.kind}/${f.ref.id}` : 'catalog';
          process.stdout.write(
            `  ${SEVERITY_COLOR[sev]('•')} ${kleur.bold(f.rule)} — ${refStr}\n      ${f.message}\n`,
          );
        }

        process.stdout.write('\n');
      }
    }
  }

  const failThreshold = { P0: 0, P1: 1, P2: 2 }[failOn] ?? 0;
  const fail = findings.some((f) => ({ P0: 0, P1: 1, P2: 2 })[f.severity] <= failThreshold);

  return fail ? 1 : 0;
};
