import { Command } from 'commander';
import { runFromKong } from './index';

const program = new Command();

const collect = (value: string, previous: string[]) => [...previous, value];

program
  .name('autocatalog-from-kong')
  .description('Write autocatalog.gateway.json from a Kong declarative configuration')
  .argument(
    '<config...>',
    'decK files, or Kubernetes manifests: files or the folders that hold them',
  )
  .option('--gateway <name>', "the gateway's name in the catalog", 'kong')
  .option(
    '--service <kong=catalog>',
    'a Kong service whose catalog name differs, repeatable',
    collect,
    [],
  )
  .option('--check', 'fail when the committed file does not match this configuration')
  .option(
    '--same-as <config...>',
    'fail unless another configuration of this gateway lets through the same routes; writes nothing',
  )
  .option('--root <dir>', 'the repository to write into', '.')
  .action(
    async (
      config: string[],
      opts: {
        gateway: string;
        service: string[];
        check?: boolean;
        root: string;
        sameAs?: string[];
      },
    ) => {
      process.exit(await runFromKong({ ...opts, config }));
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
