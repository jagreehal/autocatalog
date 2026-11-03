import path from 'node:path';
import { Command } from 'commander';
import kleur from 'kleur';
import { runAdapter } from './runner';

const program = new Command();

program
  .name('autocatalog-from-zod')
  .description('Generate Autocatalog events from a Zod TS module')
  .argument('<module>', 'path to TS module exporting events')
  .option('-e, --export <name>', 'named export to read from the module', 'jsonSchemas')
  .option('-o, --out <dir>', 'output events directory', './events')
  .action(async (modulePath: string, opts: { export: string; out: string }) => {
    try {
      const result = await runAdapter({
        module: modulePath,
        exportName: opts.export,
        out: path.resolve(opts.out),
      });

      if (result.errors.length > 0) {
        for (const err of result.errors) console.error(kleur.yellow(`  ! ${err}`));
      }

      console.log(kleur.green(`✓ wrote ${result.eventsWritten} event(s) to ${opts.out}`));
      process.exit(result.errors.length > 0 ? 1 : 0);
    } catch (err) {
      console.error(kleur.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
