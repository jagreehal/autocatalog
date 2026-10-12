import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import {
  CONSUMES_FILE,
  EVENT_MANIFEST_CONTRACT_PATH,
  checkConsumerDeclarations,
  jsonObjectSchema,
  readConsumerDeclarations,
  shownName,
  validateCatalog,
  type ConsumerDeclaration,
  type JsonObject,
} from 'autocatalog-core';
import { publishedLine, readCompanyIndex, readEventSchema } from '../company-index';

export interface RunValidateOptions {
  cwd: string;
  quiet?: boolean;
  strictWarnings?: boolean;
  /**
   * The company site's `/catalog.json`, as a URL or a file: check the fields
   * this repository says it consumes against the schemas producers publish.
   */
  catalog?: string;
  /** An environment variable holding a token for a private company site. */
  catalogTokenEnv?: string;
}

/**
 * What this repository says it consumes, checked against the producers when a
 * company index is given. Its own problems, as lines to print.
 */
async function checkConsumes(opts: RunValidateOptions): Promise<string[] | 'none'> {
  if (!fs.existsSync(path.join(opts.cwd, CONSUMES_FILE))) return 'none';

  let declarations: ConsumerDeclaration[];

  try {
    declarations = await readConsumerDeclarations(opts.cwd);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  if (!opts.catalog) return [];

  const catalog = opts.catalog;
  const options = { tokenEnv: opts.catalogTokenEnv };

  const { graph, publishedAt } = await readCompanyIndex(catalog, options);

  if (!opts.quiet) console.log(`  ${publishedLine('producers', catalog, publishedAt)}`);

  return (
    await checkConsumerDeclarations(declarations, graph, (event) =>
      readEventSchema(catalog, event, options),
    )
  ).map((problem) => `${CONSUMES_FILE}: ${problem}`);
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

  let consumes: string[] | 'none';

  try {
    consumes = await checkConsumes(opts);
  } catch (error) {
    console.error(
      kleur.red(
        `✗ could not read ${opts.catalog}: ${shownName(error instanceof Error ? error.message : String(error))}`,
      ),
    );

    return 1;
  }

  for (const problem of consumes === 'none' ? [] : consumes)
    console.error(kleur.red(`✗ ${problem}`));

  // A repository that only consumes other teams' events has none of its own.
  if (consumes !== 'none' && !fs.existsSync(eventsRoot)) {
    if (consumes.length === 0 && !opts.quiet) console.log(kleur.green(`✓ ${CONSUMES_FILE} valid`));

    return consumes.length > 0 ? 1 : 0;
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

  if (result.errors.length > 0 || (consumes !== 'none' && consumes.length > 0)) return 1;

  if (opts.strictWarnings && result.warnings.length > 0) return 1;

  return 0;
}
