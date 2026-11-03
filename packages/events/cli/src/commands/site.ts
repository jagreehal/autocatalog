import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import kleur from 'kleur';
import {
  cloneRepositories,
  listRepositoriesByTopic,
  repositoryName,
  type EnrolledRepository,
} from '../enrol';
import { readCompanyIndex } from '../company-index';
import {
  clonePinned,
  enrolledSinceLock,
  importEventCatalogSources,
  LOCK_FILE,
  readLock,
} from '../federation';
import {
  buildEventCatalog,
  EVENTCATALOG_DIR,
  missingEmbeds,
  type BuiltEventCatalog,
} from './site-eventcatalog';

export interface RunSiteOptions {
  /** Aggregation root when nothing is cloned: sibling checkouts, or one repository. */
  root: string;
  /** Clone every repository `owner` has with this topic. */
  topic?: string;
  owner?: string;
  /** Clone these repositories. */
  repos?: string[];
  /** Where clones go. */
  cache: string;
  out: string;
  site?: string;
  base?: string;
  title?: string;
  dev: boolean;
  /** Install and build EventCatalog, and embed its diagrams in the site. */
  eventcatalog?: boolean;
  /**
   * The docs frontmatter contract to enforce. Without it, the root's own
   * `contracts/docs-frontmatter.json`, else the one an enrolled repository
   * publishes.
   */
  docsSchema?: string;
  /** The document kinds to publish, found like the contract when left out. */
  docsConventions?: string;
  /** A folder of the site's own pages and API routes. */
  pages?: string;
  /** A server-sent events feed the maps' Live mode follows, and the SSE event name its frames use. */
  liveUrl?: string;
  liveEvent?: string;
  /** The lock that pins each enrolled repository; `autocatalog.lock.json` when it exists. */
  lock?: string;
  /** Build enrolled repositories at their latest commits, ignoring the lock. */
  unlocked?: boolean;
  /** Other sites' `/catalog.json`, joined into the graph without pages. */
  indexes?: string[];
}

/**
 * The company index in one command. Clones what is enrolled, then builds (or
 * serves) the Starlight site that ships inside autocatalog-docs-astro. Nothing
 * is scaffolded: every choice is a flag.
 */
export async function runSite(opts: RunSiteOptions): Promise<number> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  let root = path.resolve(opts.root);
  const lockPath = path.resolve(opts.lock ?? LOCK_FILE);

  const pins = opts.unlocked
    ? undefined
    : await readLock(lockPath, { required: Boolean(opts.lock) }).catch((error: Error) => error);

  if (pins instanceof Error) {
    console.error(kleur.red(pins.message));

    return 1;
  }

  if (pins) {
    // Pinned: exactly the reviewed commits, whatever the branches say now.
    console.log(
      kleur.dim(
        `Building ${pins.length} repositories pinned by ${path.relative(process.cwd(), lockPath) || lockPath}`,
      ),
    );

    const cloned = await clonePinned(pins, {
      cache: path.resolve(opts.cache),
      ...(token && { token }),
    });

    const notLocked = await enrolledSinceLock(
      { topic: opts.topic, owner: opts.owner, repos: opts.repos },
      pins,
      lockPath,
      token,
    ).catch((error: Error) => error);

    if (notLocked instanceof Error) {
      console.error(kleur.red(notLocked.message));

      return 1;
    }

    for (const failure of [...cloned.failures, ...notLocked])
      console.warn(kleur.yellow(`Left out ${failure.name}: ${failure.reason}`));

    if (cloned.failures.length === pins.length) {
      console.error(kleur.red('No pinned repository could be built.'));

      return 1;
    }

    root = cloned.root;
  } else if (opts.topic || opts.owner || opts.repos?.length) {
    if (Boolean(opts.topic) !== Boolean(opts.owner)) {
      console.error(
        kleur.red('--topic and --owner go together: whose repositories, with which topic.'),
      );

      return 1;
    }

    const enrolled: EnrolledRepository[] = [
      ...(opts.topic && opts.owner
        ? await listRepositoriesByTopic({ owner: opts.owner, topic: opts.topic, token })
        : []),
      ...(opts.repos ?? []).map((url) => ({ name: repositoryName(url), cloneUrl: url })),
    ];

    if (enrolled.length === 0) {
      console.error(
        kleur.red(
          opts.topic
            ? `No repository owned by ${opts.owner} has the topic ${opts.topic}.`
            : 'No repositories to clone.',
        ),
      );

      return 1;
    }

    console.log(kleur.dim(`Cloning ${enrolled.map((repo) => repo.name).join(', ')}`));

    const cloned = await cloneRepositories(enrolled, {
      into: path.resolve(opts.cache),
      token,
    }).catch((error: Error) => error);

    if (cloned instanceof Error) {
      console.error(kleur.red(cloned.message));

      return 1;
    }

    for (const failure of cloned.failed) {
      console.warn(kleur.yellow(`Left out ${failure.name}: ${failure.reason}`));
    }

    if (cloned.cloned.length === 0) {
      console.error(kleur.red('No repository could be cloned.'));

      return 1;
    }

    console.log(
      kleur.green(
        `✓ Cloned ${cloned.cloned.length} ${cloned.cloned.length === 1 ? 'repository' : 'repositories'} into ${path.relative(process.cwd(), cloned.root) || '.'}`,
      ),
    );
    console.log(
      kleur.dim(
        token
          ? '  Authenticated with GITHUB_TOKEN or GH_TOKEN.'
          : '  Unauthenticated: public repositories only. Set GITHUB_TOKEN or GH_TOKEN for private ones and a higher rate limit.',
      ),
    );

    root = cloned.root;
  }

  // EventCatalog projects, federated as they are: each is imported into a
  // folder this command owns, so nobody's checkout is written to.
  const imported = await importEventCatalogSources(
    root,
    path.join(path.dirname(path.resolve(opts.cache)), 'eventcatalog-sources'),
  );

  for (const failure of imported.failures)
    console.warn(kleur.yellow(`Left out ${failure.name}: ${failure.reason}`));

  if (imported.sources.length > 0)
    console.log(
      kleur.dim(
        `Federating ${imported.sources.length} EventCatalog project${imported.sources.length === 1 ? '' : 's'}: ${imported.sources.map((dir) => path.basename(dir)).join(', ')}`,
      ),
    );

  // Other sites' graphs, fetched once and joined without pages.
  const indexFiles: string[] = [];

  if (opts.indexes?.length) {
    const dir = path.join(path.dirname(path.resolve(opts.cache)), 'indexes');

    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    for (const [i, source] of opts.indexes.entries()) {
      try {
        const { graph } = await readCompanyIndex(source, {});
        const file = path.join(dir, `${i}.json`);

        await fs.writeFile(file, JSON.stringify(graph));
        indexFiles.push(file);
      } catch (error) {
        console.warn(
          kleur.yellow(
            `Left out ${source}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
  }

  // Checked once anything enrolled is cloned: the contract may live in a clone.
  const docsSchema = opts.docsSchema && path.resolve(opts.docsSchema);

  if (docsSchema && !(await fs.stat(docsSchema).catch(() => null))?.isFile()) {
    console.error(kleur.red(`--docs-schema: no file at ${opts.docsSchema}`));

    return 1;
  }

  const docsConventions = opts.docsConventions && path.resolve(opts.docsConventions);

  if (docsConventions && !(await fs.stat(docsConventions).catch(() => null))?.isFile()) {
    console.error(kleur.red(`--docs-conventions: no file at ${opts.docsConventions}`));

    return 1;
  }

  const pages = opts.pages && path.resolve(opts.pages);

  if (pages && !(await fs.stat(pages).catch(() => null))?.isDirectory()) {
    console.error(kleur.red(`--pages: no folder at ${opts.pages}`));

    return 1;
  }

  if (opts.eventcatalog && opts.dev) {
    console.error(kleur.red('--eventcatalog draws diagrams at build time; leave out --dev.'));

    return 1;
  }

  // Built first: the pages need to know what it drew. It lives beside the
  // clones, not among them, because a fresh clone empties --cache.
  const eventcatalog = opts.eventcatalog
    ? await buildEventCatalog({
        root,
        project: path.join(path.dirname(path.resolve(opts.cache)), 'eventcatalog'),
        base: opts.base ?? '/',
        site: opts.site,
      }).catch((error: Error) => error)
    : undefined;

  if (eventcatalog instanceof Error) {
    console.error(kleur.red(eventcatalog.message));

    return 1;
  }

  const siteProject = path.join(
    path.dirname(fileURLToPath(import.meta.resolve('autocatalog-docs-astro'))),
    '..',
    'site',
  );

  const astro = path.join(
    path.dirname(fileURLToPath(import.meta.resolve('astro/package.json'))),
    'bin',
    'astro.mjs',
  );

  // Each run has a root of its own inside the bundled project, so two runs at
  // once never share dist/, .astro/ or Astro's caches. Inside it, so its
  // prerender chunks still resolve the packages they import.
  // A dev server keeps running in the background after `astro dev` returns,
  // so it gets a root that stays.
  const run = opts.dev
    ? path.join(siteProject, '.run-dev')
    : await fs.mkdtemp(path.join(siteProject, '.run-'));

  await fs.mkdir(run, { recursive: true });

  const code = await new Promise<number>((resolve) => {
    // Run from that root: Astro resolves some of its build output against the
    // working directory, not --root.
    const child = spawn(
      process.execPath,
      [
        '--import',
        new URL('./site-react.js', import.meta.url).href,
        astro,
        opts.dev ? 'dev' : 'build',
        '--root',
        run,
        // Astro joins --config onto --root.
        '--config',
        path.relative(run, path.join(siteProject, 'astro.config.mjs')),
      ],
      {
        cwd: run,
        stdio: 'inherit',
        env: {
          ...process.env,
          AUTOCATALOG_DOCS_ROOT: root,
          ...(imported.sources.length && {
            AUTOCATALOG_DOCS_SOURCES: imported.sources.join(path.delimiter),
          }),
          ...(indexFiles.length && { AUTOCATALOG_DOCS_INDEXES: indexFiles.join(path.delimiter) }),
          AUTOCATALOG_REACT_FROM: import.meta.resolve('autocatalog-docs-astro'),
          ...(opts.site && { AUTOCATALOG_SITE_URL: opts.site }),
          ...(opts.base && { AUTOCATALOG_SITE_BASE: opts.base }),
          ...(opts.title && { AUTOCATALOG_DOCS_TITLE: opts.title }),
          ...(docsSchema && { AUTOCATALOG_DOCS_SCHEMA: docsSchema }),
          ...(docsConventions && { AUTOCATALOG_DOCS_CONVENTIONS: docsConventions }),
          ...(pages && { AUTOCATALOG_DOCS_PAGES: pages }),
          ...(eventcatalog && { AUTOCATALOG_EVENTCATALOG: eventcatalog.embedsFile }),
          ...(opts.liveUrl && { AUTOCATALOG_DOCS_LIVE_URL: opts.liveUrl }),
          ...(opts.liveEvent && { AUTOCATALOG_DOCS_LIVE_EVENT: opts.liveEvent }),
        },
      },
    );

    child.on('exit', (exit) => resolve(exit ?? 1));
  });

  if (opts.dev) return code;

  try {
    return code === 0 ? await publishSite(path.join(run, 'dist'), opts.out, eventcatalog) : code;
  } finally {
    await fs.rm(run, { recursive: true, force: true });
  }
}

/**
 * Astro builds inside the bundled project, where its prerender chunks can
 * resolve the packages they import. The result is assembled beside --out and
 * swapped in whole, so a failed build leaves the last good site.
 */
async function publishSite(
  dist: string,
  outDir: string,
  eventcatalog: BuiltEventCatalog | undefined,
): Promise<number> {
  const out = path.resolve(outDir);
  const next = `${out}.next`;
  await fs.rm(next, { recursive: true, force: true });
  await fs.cp(dist, next, { recursive: true });

  if (eventcatalog) {
    await fs.cp(eventcatalog.dist, path.join(next, EVENTCATALOG_DIR), { recursive: true });
    await fs.cp(eventcatalog.license, path.join(next, EVENTCATALOG_DIR, 'LICENSE'));
    const missing = await missingEmbeds(next, eventcatalog.embeds);

    if (missing.length > 0) {
      await fs.rm(next, { recursive: true, force: true });
      console.error(
        kleur.red(`EventCatalog did not build pages the site embeds:\n  ${missing.join('\n  ')}`),
      );

      return 1;
    }
  }

  await fs.rm(out, { recursive: true, force: true });
  await fs.rename(next, out);

  console.log(kleur.green(`Site written to ${path.relative(process.cwd(), out) || '.'}`));
  // Build output, not source: deploy it, and keep it out of the repository.
  console.log(
    kleur.dim(
      `${path.relative(process.cwd(), out) || '.'} is build output: deploy it, don't commit it (add it to .gitignore).`,
    ),
  );

  return 0;
}
