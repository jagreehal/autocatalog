import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findPackageJSON } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  readSiteConfig,
  SITE_THEMES,
  type SiteConfig,
  siteConfigSchema,
} from 'autocatalog-docs-core';
import kleur from 'kleur';
import { z } from 'zod';
import {
  cloneRepositories,
  gitStderr,
  listRepositories,
  repositoryName,
  tokenHeader,
  type EnrolledRepository,
} from '../enrol';
import { readCompanyIndex } from '../company-index';
import {
  clonePinned,
  enrolled,
  enrolledSinceLock,
  type EnrolmentFlags,
  catalogReleases,
  importEventCatalogSources,
  LOCK_FILE,
  type LockEntry,
  readLockFile,
} from '../federation';
import {
  buildEventCatalog,
  EVENTCATALOG_DIR,
  missingEmbeds,
  type BuiltEventCatalog,
} from './site-eventcatalog';

/** The files of a brand folder that `ac site` reads, each one optional. */
export interface Brand {
  logo?: string;
  logoDark?: string;
  favicon?: string;
  css?: string;
  /** Files served as they are: apple-touch-icon, social card, robots.txt, fonts. */
  public?: string;
}

const execFileAsync = promisify(execFile);

const LOGO = /\.(?:svg|png|webp|jpe?g|avif)$/;

const FAVICONS = ['favicon.svg', 'favicon.png', 'favicon.ico'];

/** What a company's brand folder holds, read by file name. */
export async function readBrand(dir: string): Promise<Brand> {
  const names = await fs.readdir(dir);
  const file = (found: string | undefined) => (found ? path.join(dir, found) : undefined);
  const logo = file(names.find((name) => LOGO.test(name) && name.startsWith('logo.')));
  const logoDark = file(names.find((name) => LOGO.test(name) && name.startsWith('logo-dark.')));
  // An SVG first, the way browsers prefer it.
  const favicon = file(FAVICONS.find((name) => names.includes(name)));
  const css = file(names.find((name) => name === 'theme.css'));
  const publicFiles = names.includes('public') ? path.join(dir, 'public') : undefined;

  if (!logo && !logoDark && !favicon && !css && !publicFiles) {
    throw new Error(`${dir} holds no logo, logo-dark, favicon, theme.css or public/`);
  }

  return {
    ...(logo && { logo }),
    ...(logoDark && { logoDark }),
    ...(favicon && { favicon }),
    ...(css && { css }),
    ...(publicFiles && { public: publicFiles }),
  };
}

/**
 * What the site would be built from, as a short hash: the commits a lock pins,
 * or the latest commit of each enrolled repository. A scheduled build compares
 * this with the last one it deployed and skips a site with nothing new.
 */
async function siteFingerprint(
  pins: LockEntry[] | undefined,
  flags: EnrolmentFlags,
  token: string | undefined,
): Promise<string> {
  const heads = pins
    ? pins.map((pin) => JSON.stringify(pin))
    : await Promise.all(
        (await enrolled(flags, token)).map(async ({ name, cloneUrl }) => {
          const { stdout } = await execFileAsync('git', [
            ...tokenHeader(cloneUrl, token),
            'ls-remote',
            cloneUrl,
            'HEAD',
          ]).catch((error: Error) => {
            // git's own words: the error message repeats the command line, token included.
            throw new Error(`${name}: ${gitStderr(error)}`);
          });

          return `${name} ${stdout.split('\t')[0]}`;
        }),
      );

  return createHash('sha256').update(heads.sort().join('\n')).digest('hex').slice(0, 16);
}

/**
 * What the build runs with. An enrolled repository's MDX runs inside it, so the
 * token that cloned every repository stays behind.
 */
export function siteEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { GITHUB_TOKEN: _github, GH_TOKEN: _gh, ...rest } = env;

  return rest;
}

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
  /** Whether `root` came from the command line, which then decides what is built. */
  rootGiven?: boolean;
  /** A folder holding the company's logo, favicon and theme. */
  brand?: string;
  /** An accent colour by name. */
  theme?: string;
  /** Who the site is for, such as `public`: their documents and the API references only. */
  audience?: string;
  /** Print a hash of what is enrolled instead of building. */
  fingerprint?: boolean;
  /** One sentence for the home page and llms.txt. */
  description?: string;
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
export async function runSite(input: RunSiteOptions): Promise<number> {
  let config: SiteConfig;

  try {
    config = readSiteConfig(process.cwd());
  } catch (error) {
    console.error(kleur.red(error instanceof Error ? error.message : String(error)));

    return 1;
  }

  const opts = {
    ...input,
    topic: input.topic ?? (input.rootGiven ? undefined : config.topic),
    owner: input.owner ?? (input.rootGiven ? undefined : config.owner),
    site: input.site ?? config.url,
  };

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  let root = path.resolve(opts.root);
  const lockPath = path.resolve(opts.lock ?? LOCK_FILE);

  const lock = opts.unlocked
    ? undefined
    : await readLockFile(lockPath, { required: Boolean(opts.lock) }).catch((error: Error) => error);

  if (lock instanceof Error) {
    console.error(kleur.red(lock.message));

    return 1;
  }

  const pins = lock?.repositories;

  if (opts.fingerprint) {
    const printed = await siteFingerprint(pins, opts, token).catch((error: Error) => error);

    if (printed instanceof Error) {
      console.error(kleur.red(printed.message));

      return 1;
    }

    console.log(printed);

    return 0;
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

    const repositories: EnrolledRepository[] = [
      ...(opts.topic && opts.owner
        ? await listRepositories({ owner: opts.owner, topic: opts.topic, token })
        : []),
      ...(opts.repos ?? []).map((url) => ({ name: repositoryName(url), cloneUrl: url })),
    ];

    if (repositories.length === 0) {
      console.error(
        kleur.red(
          opts.topic
            ? `No repository owned by ${opts.owner} has the topic ${opts.topic}.`
            : 'No repositories to clone.',
        ),
      );

      return 1;
    }

    console.log(kleur.dim(`Cloning ${repositories.map((repo) => repo.name).join(', ')}`));

    const cloned = await cloneRepositories(repositories, {
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

  const releases = catalogReleases(pins ?? [], root, imported);

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

  const pages = opts.pages ? path.resolve(opts.pages) : config.pages;

  if (pages && !(await fs.stat(pages).catch(() => null))?.isDirectory()) {
    console.error(kleur.red(`--pages: no folder at ${pages}`));

    return 1;
  }

  const extend = await Promise.all(
    (config.extend ?? []).map((entry) => resolveExtension(entry)),
  ).catch((error: Error) => error);

  if (extend instanceof Error) {
    console.error(kleur.red(`extend: ${extend.message}`));

    return 1;
  }

  const theme = opts.theme ?? config.theme;

  if (theme && !SITE_THEMES.some((name) => name === theme)) {
    console.error(kleur.red(`--theme: pick one of ${SITE_THEMES.join(', ')}`));

    return 1;
  }

  if (config.access && !(await fs.stat(config.access.module).catch(() => null))?.isFile()) {
    console.error(kleur.red(`access.module: no file at ${config.access.module}`));

    return 1;
  }

  // A static site is the same for every reader, so there is no one to ask.
  if (config.access && config.output !== 'server') {
    console.error(
      kleur.red('access decides per request: set "output": "server" in autocatalog.site.json'),
    );

    return 1;
  }

  if (config.chat && !(await fs.stat(config.chat.module).catch(() => null))?.isFile()) {
    console.error(kleur.red(`chat.module: no file at ${config.chat.module}`));

    return 1;
  }

  if (config.chat?.panel && !(await fs.stat(config.chat.panel).catch(() => null))?.isFile()) {
    console.error(kleur.red(`chat.panel: no file at ${config.chat.panel}`));

    return 1;
  }

  const audience = opts.audience ?? config.audience;

  if (!siteConfigSchema.shape.audience.safeParse(audience).success) {
    console.error(kleur.red('--audience: a lower-case name, such as public'));

    return 1;
  }

  const brandDir = opts.brand ?? config.brand;

  if (brandDir && !(await fs.stat(brandDir).catch(() => null))?.isDirectory()) {
    console.error(kleur.red(`--brand: no folder at ${brandDir}`));

    return 1;
  }

  const brand = brandDir
    ? await readBrand(path.resolve(brandDir)).catch((error: Error) => error)
    : {};

  if (brand instanceof Error) {
    console.error(kleur.red(`--brand: ${brand.message}`));

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

  // Astro reads a component path that shares no folder with its root, below
  // `/`, as inside the root, and cannot compile it.
  if (
    (extend.length > 0 || pages || config.chat || config.access) &&
    !sharesAFolder(process.cwd(), siteProject)
  ) {
    console.error(
      kleur.red(
        `This site's own code is in ${process.cwd()}, which shares no folder with autocatalog in ${siteProject}, and Astro cannot build it from there. Install autocatalog in the site's folder: npm install --save-dev autocatalog`,
      ),
    );

    return 1;
  }

  // Each run has a root of its own inside the bundled project, so two runs at
  // once never share dist/, .astro/ or Astro's caches. Inside it, so its
  // prerender chunks still resolve the packages they import.
  // A dev server's root stays between runs, one per project, so two projects
  // served at once never show each other's site.
  const run = opts.dev
    ? path.join(
        siteProject,
        `.run-dev-${createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12)}`,
      )
    : await fs.mkdtemp(path.join(siteProject, '.run-'));

  await fs.mkdir(run, { recursive: true });

  // The bundled public folder is shared by every run, so a brand gets a copy.
  const publicDir = brand.favicon || brand.public ? path.join(run, 'public') : undefined;

  const faviconName = brand.favicon && path.basename(brand.favicon);

  if (publicDir) {
    await fs.cp(path.join(siteProject, 'public'), publicDir, { recursive: true });

    if (brand.public) await fs.cp(brand.public, publicDir, { recursive: true });

    if (brand.favicon && faviconName) {
      await fs.copyFile(brand.favicon, path.join(publicDir, faviconName));
    }
  }

  const title = opts.title ?? config.title;
  const description = opts.description ?? config.description;

  // The site's own packages first, then autocatalog's: see site-resolve.ts.
  const resolveFrom = [process.cwd(), ...(await siteDependencyDirs())];

  const code = await new Promise<number>((resolve) => {
    // Run from that root: Astro resolves some of its build output against the
    // working directory, not --root.
    const child = spawn(
      process.execPath,
      [
        '--import',
        new URL('./site-react.js', import.meta.url).href,
        '--import',
        SITE_RESOLVE,
        astro,
        // In the foreground, always: Astro would otherwise background a dev
        // server an agent starts, and hand the next run that stale server.
        ...(opts.dev ? ['dev', '--ignore-lock'] : ['build']),
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
          ...siteEnvironment(process.env),
          AUTOCATALOG_DOCS_ROOT: root,
          ...(imported.sources.length && {
            AUTOCATALOG_DOCS_SOURCES: imported.sources.join(path.delimiter),
          }),
          ...(indexFiles.length && { AUTOCATALOG_DOCS_INDEXES: indexFiles.join(path.delimiter) }),
          // With a lock, it alone says who owns each service, an empty one included.
          ...(lock && { AUTOCATALOG_DOCS_SERVICE_OWNERS: JSON.stringify(lock.services) }),
          ...(Object.keys(releases).length && {
            AUTOCATALOG_DOCS_RELEASES: JSON.stringify(releases),
          }),
          AUTOCATALOG_REACT_FROM: import.meta.resolve('autocatalog-docs-astro'),
          AUTOCATALOG_RESOLVE_FROM: resolveFrom.join(path.delimiter),
          ...(opts.site && { AUTOCATALOG_SITE_URL: opts.site }),
          ...(opts.base && { AUTOCATALOG_SITE_BASE: opts.base }),
          ...(title && { AUTOCATALOG_DOCS_TITLE: title }),
          ...(description && { AUTOCATALOG_DOCS_DESCRIPTION: description }),
          ...(theme && { AUTOCATALOG_SITE_THEME: theme }),
          ...(audience && { AUTOCATALOG_SITE_AUDIENCE: audience }),
          ...(config.navigation && {
            AUTOCATALOG_SITE_NAVIGATION: JSON.stringify(config.navigation),
          }),
          ...(publicDir && { AUTOCATALOG_SITE_PUBLIC: publicDir }),
          ...(faviconName && { AUTOCATALOG_SITE_FAVICON: `/${faviconName}` }),
          ...(config.nav && { AUTOCATALOG_SITE_NAV: JSON.stringify(config.nav) }),
          ...(config.social && { AUTOCATALOG_SITE_SOCIAL: JSON.stringify(config.social) }),
          ...(config.head && { AUTOCATALOG_SITE_HEAD: JSON.stringify(config.head) }),
          ...(config.strings && { AUTOCATALOG_SITE_STRINGS: JSON.stringify(config.strings) }),
          ...((brand.logo ?? brand.logoDark) && {
            AUTOCATALOG_SITE_LOGO: path.relative(run, (brand.logo ?? brand.logoDark)!),
            AUTOCATALOG_SITE_LOGO_DARK: path.relative(run, (brand.logoDark ?? brand.logo)!),
          }),
          ...(brand.css && { AUTOCATALOG_SITE_CSS: brand.css }),
          ...(docsSchema && { AUTOCATALOG_DOCS_SCHEMA: docsSchema }),
          ...(docsConventions && { AUTOCATALOG_DOCS_CONVENTIONS: docsConventions }),
          ...(pages && { AUTOCATALOG_DOCS_PAGES: pages }),
          ...(extend.length && { AUTOCATALOG_SITE_EXTEND: extend.join(path.delimiter) }),
          // Where the site's own package.json is: its dependencies stay out of the server bundle.
          AUTOCATALOG_SITE_PROJECT: process.cwd(),
          ...(config.output && { AUTOCATALOG_SITE_OUTPUT: config.output }),
          ...(config.chat && { AUTOCATALOG_SITE_CHAT: JSON.stringify(config.chat) }),
          ...(config.access && { AUTOCATALOG_SITE_ACCESS: JSON.stringify(config.access) }),
          ...(config.repo && { AUTOCATALOG_DOCS_REPO: config.repo }),
          ...(config.atRoot && { AUTOCATALOG_DOCS_AT_ROOT: 'true' }),
          ...(config.pageActions === false && { AUTOCATALOG_SITE_PAGE_ACTIONS: 'false' }),
          ...(eventcatalog && { AUTOCATALOG_EVENTCATALOG: eventcatalog.embedsFile }),
          ...(opts.liveUrl && { AUTOCATALOG_DOCS_LIVE_URL: opts.liveUrl }),
          ...(opts.liveEvent && { AUTOCATALOG_DOCS_LIVE_EVENT: opts.liveEvent }),
        },
      },
    );

    // Stopping `ac site` stops the server it started, however it is stopped.
    const stop = () => child.kill('SIGTERM');

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    child.on('exit', (exit) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve(exit ?? 1);
    });
  });

  if (opts.dev) return code;

  try {
    if (code !== 0) return code;

    const published = await publishSite(path.join(run, 'dist'), opts.out, eventcatalog);

    // The assistant answers per request, so a site with one runs as a server too.
    if (published === 0 && (config.output === 'server' || config.chat)) {
      await writeServerStart(path.resolve(opts.out), resolveFrom);
    }

    return published;
  } finally {
    await fs.rm(run, { recursive: true, force: true });
  }
}

/**
 * autocatalog-docs-astro and each package it depends on. The server bundle
 * imports their dependencies by name, which only resolve from beside them.
 */
async function siteDependencyDirs(): Promise<string[]> {
  const manifest = findPackageJSON(import.meta.resolve('autocatalog-docs-astro'));

  if (!manifest) return [];

  const pkg = dependenciesSchema.parse(JSON.parse(await fs.readFile(manifest, 'utf8')));

  const from = pathToFileURL(manifest);

  const dirs = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).flatMap((name) => {
    const found = findPackageJSON(name, from);

    return found ? [path.dirname(found)] : [];
  });

  return [path.dirname(manifest), ...dirs];
}

const dependenciesSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

/** A package that extends the site names its module in `autocatalog.site`. */
const siteEntrySchema = z.object({
  autocatalog: z.object({ site: z.string().min(1).optional() }).optional(),
});

const SITE_RESOLVE = new URL('./site-resolve.js', import.meta.url).href;

/**
 * `node <out>/server.mjs` starts a server site. It resolves autocatalog's
 * packages from this install, so build where it runs, as with any Node server.
 */
async function writeServerStart(out: string, resolveFrom: string[]): Promise<void> {
  await fs.writeFile(
    path.join(out, 'server.mjs'),
    [
      '// Written by `ac site`. Run it to serve the site.',
      `process.env.AUTOCATALOG_RESOLVE_FROM ??= ${JSON.stringify(resolveFrom.join(path.delimiter))};`,
      `await import(${JSON.stringify(SITE_RESOLVE)});`,
      "await import('./server/entry.mjs');",
      '',
    ].join('\n'),
  );
  console.log(
    kleur.dim(`Start it with: node ${path.relative(process.cwd(), out) || '.'}/server.mjs`),
  );
}

/** Whether two paths share a folder below the root of the file system. */
export function sharesAFolder(a: string, b: string): boolean {
  const top = (file: string) => path.resolve(file).split(path.sep)[1];

  return top(a) === top(b);
}

/**
 * An `extend` entry as a module file: a path as written, or the module a
 * package names in its `package.json` under `autocatalog.site`.
 */
export async function resolveExtension(entry: string, cwd = process.cwd()): Promise<string> {
  if (path.isAbsolute(entry)) {
    if (!(await fs.stat(entry).catch(() => null))?.isFile()) throw new Error(`no file at ${entry}`);

    return entry;
  }

  const manifest = findPackageJSON(entry, pathToFileURL(path.join(cwd, 'package.json')));

  if (!manifest) throw new Error(`no package ${entry} installed in ${cwd}`);

  const pkg = siteEntrySchema.parse(JSON.parse(await fs.readFile(manifest, 'utf8')));

  if (!pkg.autocatalog?.site) {
    throw new Error(`${entry} names no module under autocatalog.site in its package.json`);
  }

  return path.resolve(path.dirname(manifest), pkg.autocatalog.site);
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
