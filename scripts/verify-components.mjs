#!/usr/bin/env node
// Publishes examples/components/ as teams would, through two plugins, and
// checks each step.
//
//   node scripts/verify-components.mjs [work-dir]
//
// Three apps build a Storybook and read it with autocatalog-plugin-storybook.
// A fourth keeps its components in a format of its own, read by a plugin in the
// example. Each committed autocatalog.components.json must match its source.
// Then each app becomes a git repository enrolled over file://, and one site
// lists every component: owners from a file and from CODEOWNERS, links into each
// viewer, one name in two repositories, the owner pages, Markdown for agents, a
// repository whose documents are all invalid, and a second site joining the
// first through --index. Nothing outside the plugin knows Storybook's name.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const EXAMPLE = path.join(ROOT, 'examples/components');

const BIN = path.join(ROOT, 'packages/events/cli/dist/bin.js');

const WORK = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'ac-components-')));

const STORYBOOKS = ['checkout', 'design-system', 'reports'];

const APPS = [...STORYBOOKS, 'gallery'];

const FILE = 'autocatalog.components.json';

const build = (app) => path.join(WORK, 'builds', app);

const remote = (app) => path.join(WORK, 'remotes', app);

const company = path.join(WORK, 'company-site');

let step = '';

function check(ok, message, output = '') {
  if (!ok) throw new Error(`${step}: ${message}${output ? `\n${output}` : ''}`);
}

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' },
  });

  if (result.error) throw result.error;

  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const ac = (cwd, ...args) => run('node', [BIN, ...args], cwd);

function must(cwd, ...args) {
  const result = ac(cwd, ...args);

  check(result.status === 0, `ac ${args.join(' ')} exited ${result.status}`, result.out);

  return result.out;
}

const page = (...parts) => readFileSync(path.join(company, 'dist', ...parts), 'utf8');

const steps = {
  'each app builds its Storybook'() {
    for (const app of STORYBOOKS) {
      const result = run(
        'pnpm',
        ['exec', 'storybook', 'build', '-o', build(app), '--quiet'],
        path.join(EXAMPLE, app),
      );

      check(result.status === 0, `${app} did not build`, result.out);
      check(
        existsSync(path.join(build(app), 'manifests/components.json')),
        `${app} wrote no manifest`,
      );
    }
  },

  'the committed files match their sources'() {
    for (const app of STORYBOOKS)
      must(path.join(EXAMPLE, app), 'from-storybook', build(app), '--check');

    must(path.join(EXAMPLE, 'gallery'), 'from-gallery', '--check');
  },

  'a stale file fails the check, and importing again keeps the address and owner'() {
    const team = path.join(WORK, 'stale');

    mkdirSync(team, { recursive: true });

    const committed = JSON.parse(readFileSync(path.join(EXAMPLE, 'design-system', FILE), 'utf8'));
    const before = JSON.stringify(committed);

    committed.components[0].props.pop();
    writeFileSync(path.join(team, FILE), JSON.stringify(committed));

    const app = path.join(EXAMPLE, 'design-system');
    const args = ['from-storybook', build('design-system'), '--root', team];
    const stale = ac(app, ...args, '--check');

    check(stale.status === 1, 'a stale file passed the check', stale.out);
    must(app, ...args);

    const after = JSON.parse(readFileSync(path.join(team, FILE), 'utf8'));

    check(JSON.stringify(after) === before, 'importing again changed more than the props');
  },

  'a build with no manifest says so, and still lists its stories'() {
    const bare = path.join(WORK, 'bare');
    const team = path.join(WORK, 'bare-team');

    cpSync(build('reports'), bare, { recursive: true });
    rmSync(path.join(bare, 'manifests'), { recursive: true });
    mkdirSync(team);

    const out = must(path.join(EXAMPLE, 'reports'), 'from-storybook', bare, '--root', team);

    check(/features\.componentsManifest/.test(out), 'nothing said the manifest is missing', out);

    const [component] = JSON.parse(readFileSync(path.join(team, FILE), 'utf8')).components;

    check(component.stories.length === 1, 'no stories from the index', JSON.stringify(component));
  },

  'one site lists every team'() {
    mkdirSync(company, { recursive: true });

    for (const app of APPS) {
      cpSync(path.join(EXAMPLE, app), remote(app), {
        recursive: true,
        filter: (source) => !/node_modules|storybook-static/.test(source),
      });
      run('git', ['init', '-q', '-b', 'main'], remote(app));
      run('git', ['add', '-A'], remote(app));
      run(
        'git',
        ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init'],
        remote(app),
      );
    }

    const repos = ['--repo', ...APPS.map((app) => `file://${remote(app)}`)];

    must(company, 'federation', 'lock', ...repos);

    // reports' only document has no frontmatter: said, and its components stay.
    const out = must(company, 'site', ...repos, '--out', 'dist', '--site', 'https://acme.dev');

    check(/reports.*required property 'title'/.test(out), 'the invalid document is not named', out);

    const list = page('components/index.html');

    for (const name of ['ErrorBanner', 'PayButton', 'Button', 'ReportTable', 'ReceiptCard'])
      check(list.includes(name), `the list has no ${name}`);

    check(list.includes('Also in design-system'), 'the duplicate is not named');
  },

  'a component page links its stories and names its owner'() {
    const checkout = page('components/checkout/checkout-errorbanner/index.html');

    check(
      checkout.includes(
        'https://storybook.acme.dev/checkout/?path=/story/checkout-errorbanner--declined',
      ),
      'no link to the story',
    );
    check(checkout.includes('acme/checkout'), 'CODEOWNERS did not name the owner');

    const design = page('components/design-system/design-system-button/index.html');

    check(design.includes('Design Systems'), 'the file did not name the owner');

    const reports = page('components/reports/reports-reporttable/index.html');

    check(!reports.includes('Open in Storybook'), 'a link with no deployed Storybook');
  },

  'a plugin that is not Storybook links into its own viewer'() {
    const gallery = page('components/gallery/receipt-card/index.html');

    check(gallery.includes('Open in Gallery'), 'the viewer is not named', gallery.slice(0, 200));
    check(gallery.includes('https://gallery.acme.dev/#receipt-card/paid'), 'no link to the screen');
  },

  'nothing outside the plugin knows Storybook'() {
    const site = 'packages/docs/astro/src';

    for (const file of [
      'packages/events/core/src/components.ts',
      `${site}/components.ts`,
      `${site}/ui/pages/ComponentPage.tsx`,
      `${site}/ui/pages/ComponentsPage.tsx`,
    ])
      check(!/storybook/i.test(readFileSync(path.join(ROOT, file), 'utf8')), `${file} names it`);
  },

  'the graph carries components to everything that reads it'() {
    const graph = JSON.parse(page('catalog.json'));

    check(
      graph.resources.filter(({ ref }) => ref.kind === 'component').length === 6,
      'catalog.json does not hold every component',
    );
    check(page('owners/acme-checkout/index.html').includes('PayButton'), 'not on the owner page');

    const joined = path.join(WORK, 'unit-site');

    mkdirSync(joined);

    const catalog = path.join(company, 'dist/catalog.json');

    must(
      joined,
      'site',
      '--repo',
      `file://${remote('reports')}`,
      '--index',
      catalog,
      '--out',
      'dist',
    );
    check(
      readFileSync(path.join(joined, 'dist/components/index.html'), 'utf8').includes('ReceiptCard'),
      'a joined site does not list the other site’s components',
    );
  },

  'agents read every component as Markdown'() {
    const twin = page('components/checkout/checkout-errorbanner.md');

    check(twin.includes('owner: acme/checkout'), 'the twin has no owner', twin);
    check(twin.includes('`onRetry`'), 'the twin has no props', twin);
    check(twin.includes('### Declined'), 'the twin has no stories', twin);

    const llms = page('llms.txt');

    check(llms.includes('## Components'), 'llms.txt lists no components', llms);
    check(
      llms.includes('https://acme.dev/components/checkout/checkout-paybutton.md'),
      'llms.txt does not link the twin',
      llms,
    );
    check(page('llms-full.txt').includes('### Declined'), 'llms-full.txt has no components');
  },
};

let failed = false;

try {
  for (const [name, runStep] of Object.entries(steps)) {
    step = name;
    await runStep();
    console.log(`✓ ${name}`);
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error.message}`);
}

if (!process.argv[2]) rmSync(WORK, { recursive: true, force: true });

process.exit(failed ? 1 : 0);
