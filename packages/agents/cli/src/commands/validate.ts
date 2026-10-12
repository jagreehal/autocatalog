import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import kleur from 'kleur';
import {
  declaredEventLinks,
  ENTITY_KINDS,
  linkEvents,
  loadCatalog,
  loadEventKeys,
  validateEdges,
} from 'autocatalog-agents-core';

export const runValidate = async (args: string[]): Promise<number> => {
  // `--root <dir>` is accepted because the scripts were written that way; a
  // flag silently parsed as the directory name is how a check ends up
  // validating nothing and passing.
  const flagIndex = args.indexOf('--root');
  const eventsIndex = args.indexOf('--events');
  const eventsFlag = eventsIndex === -1 ? undefined : args[eventsIndex + 1];

  const positional = args.find(
    (arg, i) => !arg.startsWith('-') && (eventsIndex === -1 || i !== eventsIndex + 1),
  );

  const root = flagIndex === -1 ? positional : args[flagIndex + 1];

  if (!root || root.startsWith('-') || (eventsIndex !== -1 && !eventsFlag)) {
    process.stderr.write('usage: ac-agents validate <root> [--events <dir>]\n');

    return 2;
  }

  const absRoot = resolve(root);

  process.stdout.write(`${kleur.dim('catalog:')} ${absRoot}\n`);

  const cat = await loadCatalog(absRoot);

  let total = 0;

  for (const kind of ENTITY_KINDS) {
    const n = cat.entities.get(kind)?.size ?? 0;
    total += n;
    process.stdout.write(`  ${kleur.cyan(kind.padEnd(10))} ${n}\n`);
  }

  process.stdout.write(`  ${kleur.bold('total'.padEnd(10))} ${total}\n\n`);

  if (cat.issues.length > 0) {
    process.stdout.write(kleur.yellow(`load issues (${cat.issues.length}):\n`));

    for (const issue of cat.issues) {
      process.stdout.write(
        `  ${kleur.yellow('•')} [${issue.kind}] ${issue.path}\n      ${issue.message}\n`,
      );
    }

    process.stdout.write('\n');
  }

  const edgeIssues = validateEdges(cat);

  if (edgeIssues.length > 0) {
    process.stdout.write(kleur.red(`edge issues (${edgeIssues.length}):\n`));

    for (const issue of edgeIssues) {
      process.stdout.write(`  ${kleur.red('✗')} ${issue.message}\n`);
    }

    process.stdout.write('\n');
  }

  // Event references are checked against the event catalog next to this one,
  // or the one --events names. Without either they are reported as unchecked
  // rather than passed: a check that quietly skips is a check that lies.
  const declared = declaredEventLinks(cat);
  const eventsRoot = eventsFlag ? resolve(eventsFlag) : join(absRoot, 'events');
  let eventIssues: string[] = [];

  if (declared.length > 0) {
    if (existsSync(eventsRoot)) {
      eventIssues = linkEvents(cat, await loadEventKeys(eventsRoot)).issues.map((i) => i.message);

      if (eventIssues.length > 0) {
        process.stdout.write(kleur.red(`event issues (${eventIssues.length}):\n`));

        for (const message of eventIssues) process.stdout.write(`  ${kleur.red('✗')} ${message}\n`);

        process.stdout.write('\n');
      } else {
        process.stdout.write(
          `${kleur.dim('events:')} ${declared.length} reference${declared.length === 1 ? '' : 's'} resolved against ${eventsRoot}\n\n`,
        );
      }
    } else if (eventsFlag) {
      process.stderr.write(
        kleur.red(`✗ --events ${eventsFlag}: no event catalog at ${eventsRoot}\n`),
      );

      return 1;
    } else {
      process.stdout.write(
        kleur.yellow(
          `events: ${declared.length} reference${declared.length === 1 ? '' : 's'} not checked — no event catalog at ${eventsRoot} (pass --events <dir>)\n\n`,
        ),
      );
    }
  }

  if (total === 0) {
    process.stderr.write(
      kleur.red(`✗ no agent catalog entities found under ${absRoot} — nothing was validated\n`),
    );

    return 1;
  }

  if (cat.issues.length === 0 && edgeIssues.length === 0 && eventIssues.length === 0) {
    process.stdout.write(kleur.green('✓ catalog is valid\n'));

    return 0;
  }

  return 1;
};
