import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import kleur from 'kleur';
import {
  isSingleRepository,
  loadRepositoryEvents,
  publishesCatalogContent,
} from 'autocatalog-core';
import { ignoredDirectory } from '../enrol';
import {
  exportToEventCatalog,
  type EventCatalogPointer,
  type EventCatalogSource,
} from '../eventcatalog';

/**
 * The EventCatalog the site draws its diagrams with. 4.x only: EventCatalog 5
 * moves core to BUSL-1.1, and 4.10.7 is the first to honour `&theme=` in embeds.
 */
export const EVENTCATALOG_VERSION = '^4.10.7';

/** What the site's pages embed, read by autocatalog-docs-astro. Paths are relative to the site base. */
export interface EventCatalogEmbeds {
  /** EventCatalog's chrome-free embed mode, which it unlocks only with its own licence key. */
  embed: boolean;
  graph: string;
  events: Record<string, string>;
  services: Record<string, string>;
}

export interface BuiltEventCatalog {
  /** EventCatalog's build output, to copy to `eventcatalog/` in the site. */
  dist: string;
  /** The embeds file the site build reads. */
  embedsFile: string;
  embeds: EventCatalogEmbeds;
  /**
   * EventCatalog's own LICENSE: MIT, with a commercial licence on its
   * enterprise code. The site publishes EventCatalog's compiled output, so the
   * notice goes with it.
   */
  license: string;
}

/** Where EventCatalog's output sits inside the site. */
export const EVENTCATALOG_DIR = 'eventcatalog';

/**
 * Each repository's events under an aggregation root, read the way the site
 * reads them: the root itself when it is one, else each child, through the same
 * loader. A repository that does not load is left out, as the site quarantines it.
 */
async function eventSources(root: string): Promise<EventCatalogSource[]> {
  const repositories = isSingleRepository(root)
    ? [root]
    : (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter(publishesCatalogContent);

  const sources: EventCatalogSource[] = [];

  for (const repository of repositories.sort()) {
    try {
      const events = await loadRepositoryEvents(repository, { history: true });

      if (events.length > 0) sources.push({ name: path.basename(repository), events });
    } catch {
      // The site build names the repository and the reason.
    }
  }

  return sources;
}

/** Run quietly, and show the output only when it fails. */
function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The project is npm's own, even inside a repository whose packageManager
      // field would make corepack refuse npm.
      env: { ...process.env, COREPACK_ENABLE_STRICT: '0' },
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed:\n${output.slice(-4000)}`));
    });
  });
}

/**
 * Export the composed catalog into an EventCatalog project kept in `project`,
 * install EventCatalog there once, and build it to be served under
 * `<base>eventcatalog/`. Returns undefined when there is nothing to draw.
 */
export async function buildEventCatalog(opts: {
  root: string;
  project: string;
  base: string;
  /** The origin the site is served from; EventCatalog uses it as Astro's `site`. */
  site?: string;
}): Promise<BuiltEventCatalog | undefined> {
  const catalogs = await eventSources(opts.root);

  if (catalogs.length === 0) {
    console.log(kleur.dim('No events to draw, so EventCatalog is not built.'));

    return undefined;
  }

  const project = path.resolve(opts.project);
  await ignoredDirectory(project);

  // Installed once and reused until the pinned range changes.
  const manifest = `${JSON.stringify(
    {
      name: 'autocatalog-eventcatalog',
      private: true,
      type: 'module',
      dependencies: { '@eventcatalog/core': EVENTCATALOG_VERSION },
    },
    null,
    2,
  )}\n`;

  const packageFile = path.join(project, 'package.json');
  const previous = await fs.readFile(packageFile, 'utf8').catch(() => '');
  const core = path.join(project, 'node_modules', '@eventcatalog', 'core');
  const installed = await fs.stat(path.join(core, 'package.json')).catch(() => null);

  if (previous !== manifest || !installed) {
    console.log(kleur.dim(`Installing @eventcatalog/core@${EVENTCATALOG_VERSION} in ${project}`));
    await fs.writeFile(packageFile, manifest);
    await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], project);
  }

  const base = `/${opts.base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

  await fs.writeFile(
    path.join(project, 'eventcatalog.config.js'),
    `export default ${JSON.stringify(
      {
        cId: 'autocatalog-site',
        title: 'Diagrams',
        organizationName: 'autocatalog',
        ...(opts.site && { homepageLink: opts.site }),
        outDir: 'dist',
        base: `${base}${EVENTCATALOG_DIR}/`,
        trailingSlash: false,
        visualiser: { architectureGraph: { enabled: true } },
      },
      null,
      2,
    )};\n`,
  );

  // Diagrams only: narrative is on the site's own pages, rendered as Markdown.
  const exported = await exportToEventCatalog({ catalogs, catalogDir: project });

  for (const reason of exported.skipped) console.warn(kleur.yellow(`  ! ${reason}`));

  const dist = path.join(project, 'dist');
  await fs.rm(dist, { recursive: true, force: true });
  console.log(kleur.dim('Building EventCatalog'));
  // Said every time: EventCatalog 4's build reports usage to EventCatalog and
  // has no setting to stop it, and everything else here sends nothing.
  console.log(
    kleur.dim(
      "EventCatalog's build reports anonymous usage (resource counts, a content hash) to EventCatalog; autocatalog sends nothing.",
    ),
  );
  await run(process.execPath, [path.join(core, 'bin', 'eventcatalog.js'), 'build'], project);

  const visualiser = (collection: string, pointers: Record<string, EventCatalogPointer>) =>
    Object.fromEntries(
      Object.entries(pointers).map(([ours, { id, version }]) => [
        ours,
        `${EVENTCATALOG_DIR}/visualiser/${collection}/${id}/${version}/`,
      ]),
    );

  const graph = `${EVENTCATALOG_DIR}/visualiser/graph/`;

  // EventCatalog decides from its own licence keys whether a page may be
  // embedded, and covers one that may not with a notice. Its build says which.
  const page = await fs.readFile(path.join(dist, 'visualiser', 'graph', 'index.html'), 'utf8');

  const embeds: EventCatalogEmbeds = {
    embed: /canPageBeEmbedded\s*=\s*true\b/.test(page),
    graph,
    events: visualiser('events', exported.written.events),
    services: visualiser('services', exported.written.services),
  };

  if (!embeds.embed) {
    console.log(
      kleur.dim(
        'EventCatalog embeds its diagrams without its own navigation only with its licence key (EVENTCATALOG_LICENSE_KEY_BACKSTAGE); pages show its full visualiser instead.',
      ),
    );
  }

  const embedsFile = path.join(project, 'embeds.json');
  await fs.writeFile(embedsFile, `${JSON.stringify(embeds, null, 2)}\n`);

  return { dist, embedsFile, embeds, license: path.join(core, 'LICENSE') };
}

/**
 * Every page the site embeds must exist in the copied output, or the iframe is
 * a 404. EventCatalog writes a disabled page as its 404, so that counts too.
 */
export async function missingEmbeds(out: string, embeds: EventCatalogEmbeds): Promise<string[]> {
  const targets = [
    embeds.graph,
    ...Object.values(embeds.events),
    ...Object.values(embeds.services),
  ];

  const missing: string[] = [];

  for (const target of targets) {
    const page = await fs.readFile(path.join(out, target, 'index.html'), 'utf8').catch(() => '');

    if (!page || page.includes('<title>404')) {
      missing.push(target);
    }
  }

  return missing;
}
