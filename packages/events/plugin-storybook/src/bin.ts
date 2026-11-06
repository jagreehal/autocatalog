import { Command } from 'commander';
import { runFromStorybook } from './index';

const program = new Command();

program
  .name('autocatalog-from-storybook')
  .description('Write autocatalog.components.json from a Storybook build')
  .argument('<build>', 'the built Storybook, such as storybook-static')
  .option('--url <url>', 'where the Storybook is deployed, so the site can link to each story')
  .option('--owner <team>', 'who owns these components; without it, CODEOWNERS says')
  .option('--check', 'fail when the committed file does not match this build')
  .option('--root <dir>', 'the repository to write into', '.')
  .action(
    async (
      build: string,
      opts: { url?: string; owner?: string; check?: boolean; root: string },
    ) => {
      process.exit(await runFromStorybook({ ...opts, build }));
    },
  );

program.parseAsync(process.argv).catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
