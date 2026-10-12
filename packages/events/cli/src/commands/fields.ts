import path from 'node:path';
import kleur from 'kleur';
import {
  describeFieldConflict,
  hasFieldConflict,
  indexFields,
  loadCatalog,
  queryFields,
  type FieldSummary,
} from 'autocatalog-core';

export interface RunFieldsOptions {
  cwd: string;
  query?: string; // field name or path fragment
  json?: boolean;
  conflictsOnly?: boolean;
  quiet?: boolean;
}

function conflictNote(field: FieldSummary): string {
  const note = describeFieldConflict(field);

  return note ? kleur.yellow(`  ⚠ ${note}`) : '';
}

function printList(fields: FieldSummary[]): void {
  const width = Math.min(44, Math.max(...fields.map((f) => f.path.length)));

  for (const field of fields) {
    const events = `${field.occurrences.length} event${field.occurrences.length === 1 ? '' : 's'}`;
    console.log(
      `${kleur.bold(field.path.padEnd(width))} ${kleur.dim(events.padEnd(9))} ${kleur.dim(
        field.types.join(' | '),
      )}${conflictNote(field)}`,
    );
  }
}

function printDetail(field: FieldSummary): void {
  console.log(kleur.bold(`\n${field.path}`) + kleur.dim(`  ${field.types.join(' | ')}`));
  const note = conflictNote(field);

  if (note) console.log(note.trimStart());

  for (const o of field.occurrences) {
    const guarantee = o.required ? kleur.green('required') : kleur.dim('optional');
    console.log(`  ${o.domain}/${o.eventId}@${o.version}  ${o.type}  ${guarantee}`);
  }

  if (field.consumers.length > 0) {
    console.log(
      kleur.dim('\n  reaches: ') + field.consumers.join(', ') + kleur.dim('  (via those events)'),
    );
  }
}

export async function runFields(opts: RunFieldsOptions): Promise<number> {
  const events = await loadCatalog(path.join(opts.cwd, 'events'), { skipVersioned: true });

  const fields = queryFields(indexFields(events), {
    query: opts.query,
    conflictsOnly: opts.conflictsOnly,
  });

  if (opts.json) {
    console.log(JSON.stringify(fields, null, 2));

    return fields.length === 0 && opts.query ? 1 : 0;
  }

  if (fields.length === 0) {
    if (!opts.quiet) {
      console.log(
        opts.query
          ? `No field matches ${opts.query}.`
          : 'No fields found — is the catalog scanned?',
      );
    }

    return opts.query ? 1 : 0;
  }

  if (opts.quiet) return 0;

  // One match is a lookup ("where does customerId live?"); many is a browse.
  if (fields.length === 1 && opts.query) printDetail(fields[0]!);
  else printList(fields);

  const conflicts = fields.filter(hasFieldConflict).length;
  console.log(
    kleur.dim(
      `\n${fields.length} field(s) across ${events.length} event(s)` +
        (conflicts > 0 ? ` · ${conflicts} inconsistent` : ''),
    ),
  );

  return 0;
}
