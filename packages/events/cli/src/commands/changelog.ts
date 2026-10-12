import path from 'node:path';
import { compareSemverish, loadCatalog, renderVersionChangelog } from 'autocatalog-core';

export interface RunChangelogOptions {
  cwd: string;
  quiet?: boolean;
}

/** Render plain-language version-to-version changelogs for every event with history. */
export async function runChangelog(opts: RunChangelogOptions): Promise<number> {
  const eventsRoot = path.join(opts.cwd, 'events');
  const all = await loadCatalog(eventsRoot);

  const currents = all.filter((e) => !e.folder.isVersioned);
  const sections: string[] = [];

  for (const current of currents) {
    const versions = all
      .filter(
        (e) =>
          e.folder.isVersioned &&
          e.frontmatter.id === current.frontmatter.id &&
          e.frontmatter.domain === current.frontmatter.domain,
      )
      .sort((a, b) => compareSemverish(a.frontmatter.version, b.frontmatter.version));

    if (versions.length === 0) continue;

    const chain = [...versions, current];

    for (let i = chain.length - 1; i > 0; i--) {
      const from = chain[i - 1]!;
      const to = chain[i]!;
      sections.push(
        renderVersionChangelog({
          eventId: `${to.frontmatter.domain}/${to.frontmatter.id}`,
          fromVersion: from.frontmatter.version,
          toVersion: to.frontmatter.version,
          fromSchema: from.schema,
          toSchema: to.schema,
        }),
      );
    }
  }

  if (!opts.quiet) {
    if (sections.length === 0) {
      console.log('No versioned history found — nothing to summarise.');
    } else {
      console.log(['# Changelog', '', ...sections].join('\n'));
    }
  }

  return 0;
}
