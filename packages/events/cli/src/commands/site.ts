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
import { buildEventCatalog, EVENTCATALOG_DIR, missingEmbeds } from './site-eventcatalog';

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
}

/**
 * The company index in one command. Clones what is enrolled, then builds (or
 * serves) the Starlight site that ships inside autocatalog-docs-astro. Nothing
 * is scaffolded: every choice is a flag.
 */
export async function runSite(opts: RunSiteOptions): Promise<number> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  let root = path.resolve(opts.root);

  if (opts.topic || opts.owner || opts.repos?.length) {
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

  const code = await new Promise<number>((resolve) => {
    // Run from the bundled project: Astro resolves some of its build output
    // against the working directory, not --root.
    const child = spawn(
      process.execPath,
      [
        '--import',
        new URL('./site-react.js', import.meta.url).href,
        astro,
        opts.dev ? 'dev' : 'build',
        '--root',
        siteProject,
      ],
      {
        cwd: siteProject,
        stdio: 'inherit',
        env: {
          ...process.env,
          AUTOCATALOG_DOCS_ROOT: root,
          AUTOCATALOG_REACT_FROM: import.meta.resolve('autocatalog-docs-astro'),
          ...(opts.site && { AUTOCATALOG_SITE_URL: opts.site }),
          ...(opts.base && { AUTOCATALOG_SITE_BASE: opts.base }),
          ...(opts.title && { AUTOCATALOG_DOCS_TITLE: opts.title }),
          ...(docsSchema && { AUTOCATALOG_DOCS_SCHEMA: docsSchema }),
          ...(docsConventions && { AUTOCATALOG_DOCS_CONVENTIONS: docsConventions }),
          ...(eventcatalog && { AUTOCATALOG_EVENTCATALOG: eventcatalog.embedsFile }),
        },
      },
    );

    child.on('exit', (exit) => resolve(exit ?? 1));
  });

  if (code !== 0 || opts.dev) return code;

  // Astro builds inside the bundled project, where its prerender chunks can
  // resolve the packages they import. The result is assembled beside --out
  // and swapped in whole, so a failed build leaves the last good site.
  const out = path.resolve(opts.out);
  const next = `${out}.next`;
  await fs.rm(next, { recursive: true, force: true });
  await fs.cp(path.join(siteProject, 'dist'), next, { recursive: true });

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
