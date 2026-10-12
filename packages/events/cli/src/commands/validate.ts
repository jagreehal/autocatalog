import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import {
  EVENT_MANIFEST_CONTRACT_PATH,
  jsonObjectSchema,
  validateCatalog,
  type JsonObject,
} from 'autocatalog-core';

export interface RunValidateOptions {
  cwd: string;
  quiet?: boolean;
  strictWarnings?: boolean;
}

export async function runValidate(opts: RunValidateOptions): Promise<number> {
  const eventsRoot = path.join(opts.cwd, 'events');
  const contractFile = path.join(opts.cwd, EVENT_MANIFEST_CONTRACT_PATH);
  let policy: JsonObject | undefined;

  // No contract means no project rules, not an error: the IR still applies.
  if (fs.existsSync(contractFile)) {
    try {
      policy = jsonObjectSchema.parse(JSON.parse(fs.readFileSync(contractFile, 'utf8')));
    } catch (error) {
      console.error(
        kleur.red(
          `✗ ${EVENT_MANIFEST_CONTRACT_PATH} is not a JSON object: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
        ),
      );

      return 1;
    }
  }

  const result = await validateCatalog(eventsRoot, { policy });

  if (!opts.quiet) {
    if (result.errors.length === 0) {
      console.log(kleur.green(`✓ ${result.events.length} event(s) valid`));

      if (result.warnings.length > 0) {
        console.log(kleur.yellow(`! ${result.warnings.length} warning(s):`));

        for (const w of result.warnings) {
          const where = w.path ? ` [${path.relative(opts.cwd, w.path)}]` : '';
          console.log(`  - ${kleur.yellow(w.code)}${where}: ${w.message}`);
        }
      }
    } else {
      console.log(
        kleur.red(`✗ ${result.errors.length} error(s) in ${result.events.length} event(s):`),
      );

      for (const e of result.errors) {
        const where = e.path ? ` [${path.relative(opts.cwd, e.path)}]` : '';
        console.log(`  - ${kleur.yellow(e.code)}${where}: ${e.message}`);
      }

      if (result.warnings.length > 0) {
        console.log(kleur.yellow(`! ${result.warnings.length} warning(s):`));

        for (const w of result.warnings) {
          const where = w.path ? ` [${path.relative(opts.cwd, w.path)}]` : '';
          console.log(`  - ${kleur.yellow(w.code)}${where}: ${w.message}`);
        }
      }
    }
  }

  if (result.errors.length > 0) return 1;

  if (opts.strictWarnings && result.warnings.length > 0) return 1;

  return 0;
}
