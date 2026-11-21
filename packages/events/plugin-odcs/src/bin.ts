import { Command } from 'commander';
import { runConsumers, runFromOdcs } from './index';

const program = new Command();

program
  .name('autocatalog-from-odcs')
  .description('Write the tables ODCS data contracts declare into .autocatalog/models.json')
  .argument(
    '[contracts...]',
    'contract files, or the folders that hold them (default: the repository)',
  )
  .option('--root <dir>', 'the repository to write into', '.')
  .option(
    '--datastore <name>',
    'logical datastore (default: .autocatalog/config.json, else default)',
  )
  .option('--database <name>', 'database (default: .autocatalog/config.json, else default)')
  .option('--base <dir>', 'a checkout of the base branch: fail on an under-bumped breaking change')
  .option(
    '--consumers <checkouts...>',
    "other repositories' checkouts: fail when a data product's expected contract is no longer met; writes nothing",
  )
  .option('--check', 'fail when the committed models do not match the contracts; writes nothing')
  .action(
    async (
      contracts: string[],
      opts: {
        root: string;
        datastore?: string;
        database?: string;
        base?: string;
        check?: boolean;
        consumers?: string[];
      },
    ) => {
      if (opts.consumers) process.exit(runConsumers(opts.root, opts.consumers));
      const options: Parameters<typeof runFromOdcs>[0] = { ...opts };

      if (contracts.length) options.contracts = contracts;
      process.exit(await runFromOdcs(options));
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
