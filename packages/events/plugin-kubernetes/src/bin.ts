import { Command } from 'commander';
import { runFromKubernetes } from './index';

const program = new Command();

const collect = (value: string, previous: string[]) => [...previous, value];

program
  .name('autocatalog-from-kubernetes')
  .description('Write autocatalog.network.json from Kubernetes manifests')
  .argument('<manifests...>', 'manifest files, or the folders that hold them')
  .option(
    '--service <workload=catalog>',
    'a workload whose catalog name differs, repeatable',
    collect,
    [],
  )
  .option('--check', 'fail when the committed file does not match these manifests')
  .option('--root <dir>', 'the repository to write into', '.')
  .action(
    async (manifests: string[], opts: { service: string[]; check?: boolean; root: string }) => {
      process.exit(await runFromKubernetes({ ...opts, manifests }));
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
