import fs from 'node:fs/promises';
import kleur from 'kleur';
import { cloneRepositories, listRepositories, repositoryName } from '../enrol';
import { runAgents } from '../index';

export interface McpSweepOptions {
  owner?: string | undefined;
  topic?: string | undefined;
  repos?: string[] | undefined;
  root: string;
  internal?: string | undefined;
  prune?: boolean | undefined;
  dryRun?: boolean | undefined;
  cache: string;
}

/**
 * One inventory for a whole GitHub owner: clone each repository's latest commit,
 * read them as one folder of checkouts, and write to one catalog. Clones are
 * read as files and never run, and the folder is gone afterwards.
 */
export async function runMcpSweep(opts: McpSweepOptions): Promise<number> {
  if (opts.topic && !opts.owner) {
    console.error('--topic needs --owner: whose repositories, with which topic.');

    return 2;
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  const repositories = [
    ...(opts.owner ? await listRepositories({ owner: opts.owner, topic: opts.topic, token }) : []),
    ...(opts.repos ?? []).map((url) => ({ name: repositoryName(url), cloneUrl: url })),
  ];

  if (repositories.length === 0) {
    console.error(
      opts.owner
        ? `No repositories to sweep for ${opts.owner}. Set GITHUB_TOKEN to see private ones.`
        : 'Name what to sweep: --owner <owner>, or --repo <url>.',
    );

    return 2;
  }

  const count = repositories.length;

  console.log(
    `${kleur.bold('mcp-sweep:')} ${count} ${count === 1 ? 'repository' : 'repositories'}`,
  );

  try {
    const { cloned, failed } = await cloneRepositories(repositories, {
      into: opts.cache,
      shallow: true,
      ...(token && { token }),
    });

    for (const { name, reason } of failed) {
      console.log(`  ${kleur.yellow('skip')} ${name} ${kleur.dim(reason)}`);
    }

    // A repository nobody could read says nothing about the servers it names.
    const partial = failed.length > 0;

    if (partial && opts.prune) {
      console.log(
        `  ${kleur.yellow('not pruning')} ${failed.length} repositories could not be read`,
      );
    }

    if (cloned.length === 0) return 1;

    const exit = await runAgents([
      'discover',
      '--from',
      'mcp',
      opts.cache,
      '--root',
      opts.root,
      '--per-repository',
      ...(opts.internal ? ['--internal', opts.internal] : []),
      ...(opts.prune && !partial ? ['--prune'] : []),
      ...(opts.dryRun ? ['--dry-run'] : []),
    ]);

    return exit !== 0 ? exit : partial ? 1 : 0;
  } finally {
    await fs.rm(opts.cache, { recursive: true, force: true });
  }
}
