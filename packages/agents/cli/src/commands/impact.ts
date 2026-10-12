import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import kleur from 'kleur';
import {
  computeEventImpact,
  computeImpact,
  describeUnresolved,
  EntityKindSchema,
  linkEvents,
  loadCatalog,
  loadEventKeys,
  resolveEventRef,
  type EntityRef,
} from 'autocatalog-agents-core';

const parseRef = (s: string): EntityRef | null => {
  const idx = s.indexOf('/');

  if (idx <= 0 || idx === s.length - 1) return null;
  const kind = EntityKindSchema.safeParse(s.slice(0, idx));

  if (!kind.success) return null;

  return { kind: kind.data, id: s.slice(idx + 1) };
};

export const runImpact = async (args: string[]): Promise<number> => {
  let root = '.';
  let events: string | undefined;
  let target: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;

    if (a === '--root') {
      root = args[++i] ?? '.';
    } else if (a === '--events') {
      events = args[++i];
    } else if (!target) {
      target = a;
    }
  }

  if (!target) {
    process.stderr.write(
      'usage: ac-agents impact <kind>/<id> [--root <path>]\n       ac-agents impact event/<domain>/<id> [--root <path>] [--events <dir>]\n',
    );

    return 2;
  }

  if (target.startsWith('event/')) {
    return runEventImpact(target.slice('event/'.length), resolve(root), events);
  }

  const ref = parseRef(target);

  if (!ref) {
    process.stderr.write(`invalid reference: "${target}" (expected <kind>/<id>)\n`);

    return 2;
  }

  const cat = await loadCatalog(resolve(root));

  if (!cat.entities.get(ref.kind)?.has(ref.id)) {
    process.stderr.write(`unknown entity: ${ref.kind}/${ref.id}\n`);

    return 1;
  }

  const report = computeImpact(cat, ref);

  process.stdout.write(
    `${kleur.bold('impact:')} ${kleur.cyan(report.subject.kind)}/${kleur.bold(report.subject.id)}\n\n`,
  );

  process.stdout.write(kleur.dim('depends on:\n'));

  if (report.dependencies.length === 0) {
    process.stdout.write(`  ${kleur.dim('(nothing)')}\n`);
  } else {
    for (const d of report.dependencies) {
      process.stdout.write(`  ${kleur.green('→')} ${d.kind}/${d.id}\n`);
    }
  }

  process.stdout.write(kleur.dim('\ndepended on by:\n'));

  if (report.dependents.length === 0) {
    process.stdout.write(`  ${kleur.dim('(nothing)')}\n`);
  } else {
    for (const d of report.dependents) {
      process.stdout.write(`  ${kleur.magenta('←')} ${d.kind}/${d.id}\n`);
    }
  }

  if (report.events) {
    process.stdout.write(kleur.dim('\nevents:\n'));

    for (const e of report.events.produces)
      process.stdout.write(`  ${kleur.green('↑')} produces ${e}\n`);

    for (const e of report.events.consumes)
      process.stdout.write(`  ${kleur.magenta('↓')} consumes ${e}\n`);
  }

  process.stdout.write('\n');

  return 0;
};

const runEventImpact = async (ref: string, root: string, events?: string): Promise<number> => {
  const eventsRoot = events ? resolve(events) : join(root, 'events');

  if (!ref) {
    process.stderr.write('invalid reference: expected event/<domain>/<id> or event/<id>\n');

    return 2;
  }

  if (!existsSync(eventsRoot)) {
    process.stderr.write(
      `no event catalog at ${eventsRoot} — event impact needs one (pass --events <dir>)\n`,
    );

    return 1;
  }

  const [cat, keys] = await Promise.all([loadCatalog(root), loadEventKeys(eventsRoot)]);
  const resolution = resolveEventRef(ref, keys);

  if (!('event' in resolution)) {
    process.stderr.write(`${describeUnresolved(ref, resolution)}\n`);

    return 1;
  }

  const report = computeEventImpact(cat, linkEvents(cat, keys).links, resolution.event);

  process.stdout.write(
    `${kleur.bold('impact:')} ${kleur.cyan('event')}/${kleur.bold(report.event)}\n\n`,
  );

  const section = (title: string, refs: EntityRef[], arrow: string) => {
    process.stdout.write(kleur.dim(`${title}:\n`));

    if (refs.length === 0) process.stdout.write(`  ${kleur.dim('(nothing)')}\n`);

    for (const r of refs) process.stdout.write(`  ${arrow} ${r.kind}/${r.id}\n`);
  };

  section('produced by', report.producers, kleur.green('↑'));
  process.stdout.write('\n');
  section('consumed by', report.consumers, kleur.magenta('↓'));

  if (report.viaTools.length > 0) {
    process.stdout.write(kleur.dim('\nreached through a tool:\n'));

    for (const v of report.viaTools) {
      process.stdout.write(
        `  ${kleur.yellow('~')} ${v.agent.kind}/${v.agent.id} via ${v.tool.kind}/${v.tool.id} (${v.direction})\n`,
      );
    }
  }

  process.stdout.write('\n');

  return 0;
};
