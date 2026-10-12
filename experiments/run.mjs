// Acceptance experiments: real repositories, real git history, the real CLI.
// `pnpm experiments` runs them all; `pnpm experiment <name>` runs one.
// See experiments/README.md for what each one claims.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CLI = path.join(HERE, '..', 'packages/events/cli/dist/bin.js');

// Shared between runs so `--eventcatalog` installs EventCatalog once, not every run.
const CACHE = path.join(os.tmpdir(), 'autocatalog-experiments-cache');

let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${error.message.split('\n').join('\n        ')}`);
  }
}

function run(command, args, { cwd, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
    maxBuffer: 64 * 1024 * 1024,
  });

  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function ac(args, opts) {
  return run(process.execPath, [CLI, ...args], opts);
}

// Distinct, increasing dates, so `updated` and history order are real git facts.
let clock = Date.parse('2026-01-05T09:00:00Z');

function git(cwd, ...args) {
  clock += 86_400_000;
  const date = new Date(clock).toISOString();

  const result = run(
    'git',
    ['-c', 'user.name=Experiment', '-c', 'user.email=exp@example.com', ...args],
    {
      cwd,
      env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    },
  );

  assert.equal(result.code, 0, `git ${args.join(' ')}: ${result.out}`);

  return result.out.trim();
}

function commitAll(cwd, message) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
}

/** Replace a work tree's files (not .git) with `source`, skipping `.history`. */
function replaceTree(source, dest) {
  for (const entry of fs.readdirSync(dest)) {
    if (entry !== '.git') fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
  }

  fs.cpSync(source, dest, { recursive: true, filter: (src) => path.basename(src) !== '.history' });
}

/**
 * Turn a committed source tree into a real repository. Each `.history/<NN-message>/`
 * folder is a whole earlier state, committed in order; the tree itself is the last
 * commit. So a repository with history is just more folders.
 */
function materialize(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  git(dest, 'init', '-q', '-b', 'main');
  const history = path.join(source, '.history');

  for (const step of fs.existsSync(history) ? fs.readdirSync(history).sort() : []) {
    replaceTree(path.join(history, step), dest);
    commitAll(dest, step.replace(/^\d+-/, '').replaceAll('-', ' '));
  }

  replaceTree(source, dest);
  commitAll(dest, 'current');

  return git(dest, 'rev-parse', 'HEAD');
}

function materializeAll(reposDir, into) {
  const shas = {};

  for (const name of fs.readdirSync(reposDir).sort()) {
    shas[name] = materialize(path.join(reposDir, name), path.join(into, name));
  }

  return shas;
}

function filesUnder(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function exists(site, page) {
  assert.ok(fs.existsSync(path.join(site, page)), `missing ${page}`);
}

function read(site, page) {
  return fs.readFileSync(path.join(site, page), 'utf8');
}

function catalogJson(site) {
  return JSON.parse(read(site, 'catalog.json'));
}

function buildSite(args, opts) {
  const result = ac(['site', ...args], {
    ...opts,
    env: { AUTOCATALOG_DOCS_LINKS: 'error', ...opts?.env },
  });

  if (result.code !== 0) console.log(result.out.split('\n').slice(-40).join('\n'));

  return result;
}

// ---------------------------------------------------------------------------

function freshRepo(dir, tmp) {
  const source = path.join(dir, 'repos');
  const [name] = fs.readdirSync(source);
  const repo = path.join(tmp, name);
  materialize(path.join(source, name), repo);

  const authored = filesUnder(path.join(source, name)).map((file) => ({
    file: path.relative(path.join(source, name), file),
    lines: fs.readFileSync(file, 'utf8').trimEnd().split('\n').length,
  }));

  console.log(
    `  INFO  user wrote ${authored.length} files: ${authored.map((a) => `${a.file} (${a.lines} lines)`).join(', ')}`,
  );

  const status = () => run('git', ['status', '--porcelain'], { cwd: repo }).out.trim();

  // The documented path (docs/quick-start.md): a site straight from the clone,
  // which scans contracts/ itself. It writes dist/ and must say so; nothing else.
  const direct = path.join(repo, 'dist');
  const first = buildSite(['.'], { cwd: repo });
  check('`ac site .` on the untouched clone builds with 0 broken links', () =>
    assert.equal(first.code, 0),
  );
  check('`ac site .` leaves only dist/, and says it wrote it', () => {
    assert.equal(status(), '?? dist/');
    assert.match(first.out, /Site written to dist/);
  });

  const configs = filesUnder(repo).filter(
    (file) =>
      !file.includes(`${path.sep}.git${path.sep}`) &&
      /(^|\/)(autocatalog\.config|astro\.config|\.autocatalogrc|package\.json)/.test(
        path.relative(repo, file),
      ),
  );

  check('no config file was needed', () => assert.deepEqual(configs, []));

  check('event page and schema.json', () => {
    exists(direct, `events/${name}/orders/order.placed/index.html`);
    exists(direct, `events/${name}/orders/order.placed/schema.json`);
  });
  check('service pages for producer and consumer', () => {
    exists(direct, 'services/OrderService/index.html');
    exists(direct, 'services/BillingService/index.html');
  });
  check('doc page, listed on the event it is about', () => {
    exists(direct, `${name}/runbook/index.html`);
    assert.match(read(direct, `events/${name}/orders/order.placed/index.html`), /Orders runbook/);
  });
  check('/catalog.json has the event, both services and the document', () => {
    const keys = catalogJson(direct).resources.map((r) => `${r.ref.kind}/${r.ref.id}`);

    for (const key of [
      'event/order.placed',
      'service/OrderService',
      'service/BillingService',
      'document/runbook',
    ]) {
      assert.ok(keys.includes(key), `${key} not in ${keys.join(', ')}`);
    }
  });
  check('llms.txt lists the document and the event', () => {
    const llms = read(direct, 'llms.txt');
    assert.match(llms, /Orders runbook/);
    assert.match(llms, /order\.placed/);
  });
  fs.rmSync(direct, { recursive: true });

  // The optional step: a scan, for contracts outside contracts/. It writes the
  // catalog and nothing else, and says what to do with it.
  const scan = ac(['.'], { cwd: repo });
  console.log(scan.out.trim().replace(/^/gm, '        '));
  check('`ac .` (scan) exits 0 and finds the event', () => {
    assert.equal(scan.code, 0);
    assert.match(scan.out, /1 events?/);
  });
  check('`ac .` writes only events/, and says so and whether to commit it', () => {
    assert.equal(status(), '?? events/');
    assert.match(scan.out, /wrote events\/ \(1 event folder, events\/llms\.txt\)/);
    assert.match(scan.out, /Commit events\//);
  });

  const site = path.join(tmp, 'site');
  const build = buildSite(['.', '--out', site], { cwd: repo });
  check('`ac site .` builds from the scanned catalog, with the same event page', () => {
    assert.equal(build.code, 0);
    exists(site, `events/${name}/orders/order.placed/index.html`);
  });

  check('building from the scanned catalog adds nothing to the work tree', () =>
    assert.equal(status(), '?? events/'),
  );
}

// ---------------------------------------------------------------------------

/**
 * Each `prs/<name>/` is a pull request: files laid over the repository on a
 * branch, and `expect.json` saying what CI must report.
 */
function breakingChange(dir, tmp) {
  const [name] = fs.readdirSync(path.join(dir, 'repos'));

  for (const pr of fs.readdirSync(path.join(dir, 'prs')).sort()) {
    console.log(`  -- PR ${pr}`);
    const repo = path.join(tmp, pr);
    materialize(path.join(dir, 'repos', name), repo);
    git(repo, 'checkout', '-q', '-b', pr);
    const overlay = path.join(dir, 'prs', pr);
    fs.cpSync(overlay, repo, {
      recursive: true,
      filter: (src) => path.basename(src) !== 'expect.json',
    });
    commitAll(repo, pr);
    const expect = JSON.parse(fs.readFileSync(path.join(overlay, 'expect.json'), 'utf8'));

    // The command docs/drift-ci.md puts in CI, in both formats a reviewer reads.
    for (const format of ['github', 'markdown']) {
      const summary = path.join(tmp, `${pr}-${format}-summary.md`);

      const drift = ac(['drift', '--base-ref', 'main', '--root', '.', '--format', format], {
        cwd: repo,
        env: { GITHUB_STEP_SUMMARY: summary },
      });

      console.log(drift.out.trim().replace(/^/gm, '        | '));
      check(`${format}: exit code ${expect.exit}`, () => assert.equal(drift.code, expect.exit));

      for (const [claim, pattern] of Object.entries(expect[format] ?? {})) {
        check(`${format}: ${claim}`, () => assert.match(drift.out, new RegExp(pattern, 'm')));
      }

      for (const [claim, pattern] of Object.entries(expect[`${format}Not`] ?? {})) {
        check(`${format}: ${claim}`, () =>
          assert.doesNotMatch(drift.out, new RegExp(pattern, 'm')),
        );
      }

      if (format === 'github' && expect.summary) {
        check('github: the markdown report is appended to the job summary', () =>
          assert.match(fs.readFileSync(summary, 'utf8'), /^# Contract drift/m),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------

/** A page's main content as plain text, so assertions read like what a person sees. */
function pageText(site, page) {
  const html = read(site, path.join(page, 'index.html'));
  const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? html;

  return main
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/**
 * Each `variants/<name>/` is a set of repositories and an `expect.json`:
 * `extends` (another variant whose repositories come too), `eventcatalog`,
 * `quarantined` (repository names), `pages` (page → texts it must show),
 * `links` (page → link targets, a `#fragment` naming an id on the target),
 * `absent` (pages that must not exist), `lastChanged` (page → repo/file whose
 * git date it must show) and `buildFails` (patterns the output of a build that
 * must fail shows; nothing else is checked).
 */
function multiRepo(dir, tmp) {
  const expect = JSON.parse(fs.readFileSync(path.join(dir, 'expect.json'), 'utf8'));
  const root = path.join(tmp, 'repos');

  const shas = {
    ...(expect.extends && materializeAll(path.join(dir, '..', expect.extends, 'repos'), root)),
    ...materializeAll(path.join(dir, 'repos'), root),
  };

  console.log(`  INFO  ${Object.keys(shas).length} repositories: ${Object.keys(shas).join(', ')}`);

  const site = path.join(tmp, 'site');
  const args = [root, '--out', site, '--cache', path.join(CACHE, 'repos')];
  const build = buildSite(expect.eventcatalog ? [...args, '--eventcatalog'] : args, { cwd: tmp });

  if (expect.buildFails) {
    check(`\`ac site <root>\` fails, showing ${expect.buildFails.join(' · ')}`, () => {
      assert.notEqual(build.code, 0);

      for (const pattern of expect.buildFails) assert.match(build.out, new RegExp(pattern));
    });

    return;
  }

  check(
    `\`ac site <root>${expect.eventcatalog ? ' --eventcatalog' : ''}\` builds with 0 broken links`,
    () => assert.equal(build.code, 0),
  );

  if (build.code !== 0) return;

  const catalog = catalogJson(site);
  check("each repository's commit SHA is in catalog.json", () => {
    for (const [name, sha] of Object.entries(shas)) {
      const repository = catalog.resources.find(
        (r) => r.ref.kind === 'repository' && r.ref.id === name,
      );

      assert.equal(repository?.source?.ref, sha, `${name}: ${JSON.stringify(repository?.source)}`);
    }
  });

  const quarantined = expect.quarantined ?? [];
  check(`quarantined: ${quarantined.join(', ') || 'none'}`, () => {
    const warned = [
      ...build.out.matchAll(/\[autocatalog-docs\] ([\w-]+): its \w+\/ catalog did not compile/g),
    ].map((m) => m[1]);

    // Exact: each quarantine is said once per build.
    assert.deepEqual(warned, quarantined);

    for (const name of quarantined) assert.match(pageText(site, 'catalog'), new RegExp(name));
  });

  for (const [page, texts] of Object.entries(expect.pages)) {
    check(`/${page}/ shows ${texts.join(' · ')}`, () => {
      const text = pageText(site, page);

      for (const wanted of texts)
        assert.ok(text.includes(wanted), `"${wanted}" not on /${page}/:\n${text.slice(0, 1500)}`);
    });
  }

  for (const [page, hrefs] of Object.entries(expect.links ?? {})) {
    check(`/${page}/ links to ${hrefs.join(' · ')}`, () => {
      const html = read(site, path.join(page, 'index.html'));

      for (const href of hrefs) {
        assert.ok(html.includes(`href="${href}`), `no link to ${href} on /${page}/`);
        const [target, fragment] = href.split('#');
        exists(site, path.join(target, 'index.html'));

        if (fragment) {
          assert.ok(
            read(site, path.join(target, 'index.html')).includes(`id="${fragment}"`),
            `nothing on ${target} has the id ${fragment}`,
          );
        }
      }
    });
  }

  for (const page of expect.absent ?? []) {
    check(`/${page}/ is not published`, () => assert.ok(!fs.existsSync(path.join(site, page))));
  }

  for (const [page, file] of Object.entries(expect.lastChanged ?? {})) {
    const [repo, ...rest] = file.split('/');
    const date = git(path.join(root, repo), 'log', '-1', '--format=%cI', '--', rest.join('/'));

    const shown = new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    check(`/${page}/ shows the git date ${file} last changed (${shown})`, () =>
      assert.match(pageText(site, page), new RegExp(`Last changed ${shown}`)),
    );
  }

  if (expect.eventcatalog) {
    check('Architecture page embeds an EventCatalog page that was built, with its LICENSE', () => {
      const embed = read(site, 'architecture/index.html').match(
        /default="(eventcatalog\/[^"]*)"/,
      )?.[1];

      assert.ok(embed, 'the Architecture page embeds nothing');
      exists(site, path.join(embed, 'index.html'));
      exists(site, 'eventcatalog/LICENSE');
    });

    const pages = filesUnder(site).filter(
      (file) =>
        /^(events|services)\/.*index\.html$/.test(path.relative(site, file)) &&
        !file.includes('/v/'),
    );

    check(`all ${pages.length} event and service pages link to a diagram that was built`, () => {
      for (const file of pages) {
        const at = fs.readFileSync(file, 'utf8').match(/architecture\/\?at=([^"&]+)/)?.[1];
        assert.ok(at, `${path.relative(site, file)} links to no diagram`);
        exists(site, path.join(decodeURIComponent(at), 'index.html'));
      }
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * A repository whose only contracts are autotel-message-contract approved files
 * beside its tests. The scan catalogs them without running anything; each
 * `prs/<name>/` then goes through the same drift gate as experiment 02.
 */
function messageContracts(dir, tmp) {
  const [name] = fs.readdirSync(path.join(dir, 'repos'));
  const repo = path.join(tmp, name);
  materialize(path.join(dir, 'repos', name), repo);

  // The site finds approved files beside the tests itself: no scan, no events/.
  const site = path.join(tmp, 'site');
  const built = buildSite(['.', '--out', site], { cwd: repo });
  const page = `events/${name}/payments/payment.captured`;
  check('`ac site .` shows the approved contract as an event page, without `ac scan`', () => {
    assert.equal(built.code, 0);
    assert.ok(!fs.existsSync(path.join(repo, 'events')), 'the site wrote events/');
    const text = pageText(site, page);

    for (const wanted of [
      'src/payments/__contracts__/PaymentCaptured.approved.txt',
      'LedgerService',
      'Payments runbook',
    ]) {
      assert.ok(text.includes(wanted), `"${wanted}" not on /${page}/`);
    }

    exists(site, `${page}/schema.json`);
  });

  const scan = ac(['.'], { cwd: repo });
  console.log(scan.out.trim().replace(/^/gm, '        '));
  const manifest = path.join(repo, 'events/payments/PaymentCaptured/autocatalog.json');

  check('`ac .` exits 0 and catalogs the approved file, with its sidecar metadata', () => {
    assert.equal(scan.code, 0);
    assert.match(scan.out, /✓ payment\.captured .*PaymentCaptured\.approved\.txt:1/);
    const event = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(event.version, '2.0.0');
    assert.deepEqual(event.consumers, ['LedgerService', 'EmailService']);
    assert.equal(event.provenance.fields.schema, 'inferred');
  });
  check('the approved bytes are the example, the shape inferred from them', () => {
    const folder = path.dirname(manifest);
    const schema = JSON.parse(fs.readFileSync(path.join(folder, 'schema.json'), 'utf8'));
    assert.deepEqual(Object.keys(schema.properties), [
      'amount',
      'capturedAt',
      'currency',
      'orderId',
      'paymentId',
    ]);
    assert.ok(fs.readdirSync(path.join(folder, 'examples')).some((f) => f.startsWith('approved')));
  });
  check('the pinned v1 and the non-JSON contract are skipped, each saying why', () => {
    assert.match(scan.out, /skipped .*PaymentCaptured_v1\.approved\.txt: an earlier version/);
    assert.match(scan.out, /skipped .*RefundIssued\.approved\.txt: not JSON/);
  });

  breakingChange(dir, tmp);
}

// ---------------------------------------------------------------------------

/** autotel's published packages, installed once from the fixture's own package.json. */
function installAutotel(packageFile) {
  const dir = path.join(CACHE, 'autotel');
  const manifest = fs.readFileSync(packageFile, 'utf8');
  const target = path.join(dir, 'package.json');
  const installed = fs.existsSync(path.join(dir, 'node_modules', 'autotel-eventcatalog'));

  if (!installed || !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== manifest) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, manifest);

    const install = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: dir,
      env: { COREPACK_ENABLE_STRICT: '0' },
    });

    assert.equal(install.code, 0, install.out);
  }

  return path.join(dir, 'node_modules');
}

/** Every `index.mdx` in an EventCatalog project, by the frontmatter id it declares. */
function ecPages(project) {
  const pages = {};

  const files = ['domains', 'events', 'services']
    .filter((dir) => fs.existsSync(path.join(project, dir)))
    .flatMap((dir) => filesUnder(path.join(project, dir)));

  for (const file of files) {
    if (path.basename(file) !== 'index.mdx' || file.includes(`${path.sep}versioned${path.sep}`)) {
      continue;
    }

    const id = fs.readFileSync(file, 'utf8').match(/^id: ['"]?([^'"\n]+)/m)?.[1];

    if (id) pages[id] = file;
  }

  return pages;
}

/** How autotel-eventcatalog matches ids: `order.placed` is `OrderPlaced`. */
const normal = (id) => id.toLowerCase().replace(/[._\-\s]/g, '');

/** The ids in a frontmatter list such as a service's `receives`, or an event's `owners`. */
function frontmatterList(file, key) {
  const frontmatter = fs.readFileSync(file, 'utf8').split(/^---$/m)[1] ?? '';
  const block = frontmatter.match(new RegExp(`^${key}:\\n((?:[ -].*\\n?)*)`, 'm'))?.[1] ?? '';

  return [...block.matchAll(/-\s+(?:id:\s+)?['"]?([^'"\n]+)/g)].map((m) => m[1].trim());
}

/** The channels a service page sends one event to (`sends[].to`, where EventCatalog 4 keeps them). */
function sendsTo(file, event) {
  const frontmatter = fs.readFileSync(file, 'utf8').split(/^---$/m)[1] ?? '';
  const sends = frontmatter.match(/^sends:\n((?:[ -].*\n?)*)/m)?.[1] ?? '';

  return sends
    .split(/^ {2}- /m)
    .filter((entry) => normal(entry.match(/^id: ['"]?([^'"\n]+)/)?.[1] ?? '') === normal(event))
    .flatMap((entry) =>
      [...(entry.split(/^ {4}to:\n/m)[1] ?? '').matchAll(/-\s+id:\s+['"]?([^'"\n]+)/g)].map((m) =>
        m[1].trim(),
      ),
    );
}

/** What an EventCatalog project says about one event, read from its files. */
function eventFacts(project, event) {
  const pages = ecPages(project);
  const id = Object.keys(pages).find((key) => normal(key) === normal(event));
  const page = id ? fs.readFileSync(pages[id], 'utf8') : '';
  const dir = id ? path.dirname(pages[id]) : project;
  const schemaFile = path.join(dir, 'schema.json');

  const schema =
    id && fs.existsSync(schemaFile) ? JSON.parse(fs.readFileSync(schemaFile, 'utf8')) : {};

  const under = (kind) => (key) => pages[key].includes(`${path.sep}${kind}${path.sep}`);
  const list = (key) => (id ? frontmatterList(pages[id], key).join(', ') : '') || 'none';

  return {
    events: Object.keys(pages).filter(under('events')).sort().join(', '),
    'id of the order.placed page': id ?? 'missing',
    version: page.match(/^version: ['"]?([^'"\n]+)/m)?.[1] ?? 'none',
    'earlier versions': fs.existsSync(path.join(dir, 'versioned'))
      ? fs.readdirSync(path.join(dir, 'versioned')).join(', ')
      : 'none',
    'schema required': (schema.required ?? []).join(', ') || 'none',
    'currency values': (schema.properties?.currency?.enum ?? []).join(' or ') || 'any string',
    owners: list('owners'),
    'services receiving it':
      Object.keys(pages)
        .filter(under('services'))
        .filter((key) =>
          frontmatterList(pages[key], 'receives').some((r) => normal(r) === normal(event)),
        )
        .sort()
        .join(', ') || 'none',
    channels:
      [
        ...new Set([
          ...(id ? frontmatterList(pages[id], 'channels') : []),
          ...Object.keys(pages)
            .filter(under('services'))
            .flatMap((key) => sendsTo(pages[key], event)),
        ]),
      ]
        .sort()
        .join(', ') || 'none',
  };
}

/**
 * A producer instrumented with autotel, its contracts and a consumer repository:
 * service tests write a runtime snapshot, autocatalog derives the catalog from
 * the contracts and joins the snapshot, EventCatalog renders it, and
 * autotel-eventcatalog stamps and checks it. Then the same service drifts, and
 * the same snapshot is given to EventCatalog without autocatalog.
 */
function fullPipeline(dir, tmp) {
  const root = path.join(tmp, 'repos');
  materializeAll(path.join(dir, 'repos'), root);
  const service = path.join(root, 'orders-service');
  const modules = installAutotel(path.join(service, 'package.json'));
  fs.symlinkSync(modules, path.join(service, 'node_modules'));
  const autotelEventCatalog = path.join(modules, 'autotel-eventcatalog', 'dist', 'cli.js');
  const autotelEc = (args) => run(process.execPath, [autotelEventCatalog, ...args], { cwd: tmp });

  const versions = Object.fromEntries(
    ['autotel', 'autotel-subscribers', 'autotel-eventcatalog'].map((name) => [
      name,
      JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8')).version,
    ]),
  );

  console.log(
    `  INFO  ${Object.entries(versions)
      .map(([name, version]) => `${name}@${version}`)
      .join(', ')} from npm`,
  );

  const snapshotFile = path.join(service, '.autotel', 'snapshot.json');

  const runTests = () => run('npm', ['test', '--silent'], { cwd: service });

  // 1. The service's own tests write the snapshot.
  const tests = runTests();
  check('`npm test` in orders-service passes and writes .autotel/snapshot.json', () => {
    assert.equal(tests.code, 0, tests.out);
    assert.ok(fs.existsSync(snapshotFile));
  });

  if (tests.code !== 0) return;
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  const baselineSnapshot = path.join(tmp, 'snapshot.json');
  fs.copyFileSync(snapshotFile, baselineSnapshot);

  check('the snapshot saw order.placed twice, from OrderService, with every declared field', () => {
    const placed = snapshot.events['order.placed'];
    assert.equal(placed.observedCount, 2);
    assert.equal(placed.producer, 'OrderService');
    assert.deepEqual(placed.fieldPaths, ['currency', 'giftMessage', 'orderId', 'total']);
    assert.deepEqual(Object.keys(snapshot.events), ['order.placed']);
  });

  // 2. CI commits the snapshot where the subscriber wrote it. No scan, no events/:
  // the site reads contracts/ and joins .autotel/snapshot.json by convention.
  commitAll(service, 'record runtime evidence');

  // 3. The site, with EventCatalog: runtime evidence on the event page.
  const cache = path.join(CACHE, '05', 'repos');
  const project = path.join(CACHE, '05', 'eventcatalog');

  // A clean project each run, keeping only EventCatalog's install.
  for (const entry of fs.existsSync(project) ? fs.readdirSync(project) : []) {
    if (!['node_modules', 'package.json', 'package-lock.json'].includes(entry)) {
      fs.rmSync(path.join(project, entry), { recursive: true, force: true });
    }
  }

  const site = path.join(tmp, 'site');
  const siteArgs = [root, '--out', site, '--cache', cache, '--eventcatalog'];
  const first = buildSite(siteArgs, { cwd: tmp });
  check('`ac site <root> --eventcatalog` builds with 0 broken links', () =>
    assert.equal(first.code, 0),
  );

  if (first.code !== 0) return;
  const placedPage = 'events/orders-service/orders/order.placed';
  check(`/${placedPage}/ shows the runtime evidence the snapshot holds`, () => {
    const text = pageText(site, placedPage);

    for (const wanted of [
      'Runtime evidence',
      'Saved snapshot',
      '2 recorded observations',
      'Declared BillingService, AnalyticsService',
      'Reported in snapshot BillingService',
      'Declared, absent from snapshot AnalyticsService',
      'Orders runbook',
      'Consuming order.placed',
    ]) {
      assert.ok(
        text.includes(wanted),
        `"${wanted}" not on /${placedPage}/:\n${text.slice(0, 2000)}`,
      );
    }
  });
  check(`/${placedPage}/v/1.0.0/ is the earlier contract, read from history`, () =>
    exists(site, `${placedPage}/v/1.0.0/index.html`),
  );
  check('/events/orders-service/orders/order.cancelled/ says no evidence is attached', () =>
    assert.match(
      pageText(site, 'events/orders-service/orders/order.cancelled'),
      /No evidence attached/,
    ),
  );

  // 4. autotel stamps the exported EventCatalog project.
  const pages = ecPages(project);
  const stamp = autotelEc(['stamp', '--snapshot', baselineSnapshot, '--catalog', project]);
  console.log(stamp.out.trim().replace(/^/gm, '        | '));
  const stampedPage = () => fs.readFileSync(pages['order.placed'], 'utf8');
  check(
    '`autotel-eventcatalog stamp` writes runtime evidence into the exported order.placed page',
    () => {
      assert.equal(stamp.code, 0);
      assert.match(
        stampedPage(),
        /<!-- autotel:stamp-start -->[\s\S]*Volume\*\*: 2 events[\s\S]*<!-- autotel:stamp-end -->/,
      );
    },
  );
  const stamped = stampedPage();

  // 5. The next site build exports again; the stamp must survive it and render.
  const second = buildSite(siteArgs, { cwd: tmp });
  check('rebuilding the site re-exports and keeps the stamp byte for byte', () => {
    assert.equal(second.code, 0);
    assert.equal(stampedPage(), stamped);
  });
  check("EventCatalog's built order.placed page shows the stamped evidence", () => {
    const built = filesUnder(path.join(site, 'eventcatalog')).filter(
      (file) =>
        file.endsWith('.html') &&
        /Observed in autotel snapshot/.test(fs.readFileSync(file, 'utf8')),
    );

    assert.ok(
      built.some((file) => file.includes('order.placed')),
      built.join(', ') || 'no page',
    );
  });

  // 6. Both drift checks over the same snapshot and the exported catalog agree.
  const autotelDrift = (snapshotPath) => {
    const report = path.join(tmp, 'drift.json');

    const result = autotelEc([
      'drift',
      '--snapshot',
      snapshotPath,
      '--catalog',
      project,
      '--format',
      'json',
      '--output',
      report,
    ]);

    assert.equal(result.code, 0, result.out);

    return JSON.parse(fs.readFileSync(report, 'utf8')).report.events;
  };

  const baseline = autotelDrift(baselineSnapshot);
  check(
    'baseline: autotel-eventcatalog drift agrees order.cancelled was never seen, nothing undocumented',
    () => {
      assert.deepEqual(baseline.observedButUndocumented, []);
      assert.ok(baseline.documentedButUnseen.includes('order.cancelled'));
      // The other repository's events too: autotel reads the whole catalog, the scan one repository.
      assert.deepEqual(
        baseline.documentedButUnseen.filter((id) => id !== 'invoice.issued'),
        ['order.cancelled'],
      );
      assert.deepEqual(baseline.fieldDrift, []);
    },
  );

  // 7. The service drifts: a field and an event nobody declared. One CI command
  // checks the contracts and the runtime evidence together.
  fs.cpSync(path.join(dir, 'drift', 'orders-service'), service, { recursive: true });
  const drifted = runTests();

  const acDrift = (...args) =>
    ac(['drift', '--base-ref', 'HEAD', '--root', '.', '--snapshot', snapshotFile, ...args], {
      cwd: service,
    });

  const markdown = acDrift('--format', 'markdown');
  console.log(markdown.out.trim().replace(/^/gm, '        | '));
  const report = JSON.parse(acDrift('--format', 'json').out);
  const gated = acDrift('--fail-on', 'suspicious', '--quiet');
  const drift = autotelDrift(snapshotFile);

  const ids = (kind) =>
    report.findings
      .filter((f) => f.kind === kind)
      .map((f) => f.eventId)
      .sort();

  const gate = autotelEc([
    'drift',
    '--snapshot',
    snapshotFile,
    '--catalog',
    project,
    '--fail-on-drift',
  ]);

  check('drift: `ac drift --snapshot` reports order.flagged ran but is not in the catalog', () => {
    assert.equal(drifted.code, 0, drifted.out);
    assert.match(markdown.out, /## order\.flagged\n\n- ⚠ suspicious: the runtime emitted this/);
    assert.deepEqual(ids('event_undocumented'), ['order.flagged']);
  });
  check('drift: `ac drift --snapshot` names the undeclared couponCode on order.placed', () => {
    assert.match(
      markdown.out,
      /## orders\/order\.placed\n\n- ⚠ suspicious: runtime payloads carry `couponCode`/,
    );
    assert.deepEqual(ids('field_undeclared'), ['order.placed']);
  });
  check(
    'drift: runtime findings are suspicious, so they gate only with --fail-on suspicious',
    () => {
      assert.equal(markdown.code, 0);
      assert.equal(report.breaking, 0);
      assert.equal(gated.code, 1);
    },
  );
  check(
    'drift: autotel-eventcatalog reports the same undocumented event, and fails the gate',
    () => {
      assert.deepEqual(drift.observedButUndocumented, ids('event_undocumented'));
      assert.equal(gate.code, 1, gate.out);
    },
  );
  check('drift: both flag couponCode, and only couponCode, as undeclared', () =>
    assert.deepEqual(
      drift.fieldDrift.map((entry) => [entry.event, entry.extra]),
      [['order.placed', ['couponCode']]],
    ),
  );
  check(
    "drift: both say order.cancelled was not seen (autotel also reads billing's catalog)",
    () => {
      assert.deepEqual(ids('event_unobserved'), ['order.cancelled']);
      assert.deepEqual(
        drift.documentedButUnseen.filter((id) => id !== 'invoice.issued'),
        ids('event_unobserved'),
      );
    },
  );

  // 8. The same snapshot through EventCatalog alone, as a team without autocatalog would.
  const alone = path.join(tmp, 'eventcatalog-alone');
  fs.mkdirSync(alone);
  const generate = autotelEc(['generate', '--snapshot', baselineSnapshot, '--catalog', alone]);
  check('`autotel-eventcatalog generate` writes an EventCatalog from the snapshot alone', () =>
    assert.equal(generate.code, 0, generate.out),
  );

  const without = eventFacts(alone, 'order.placed');
  const withAc = eventFacts(project, 'order.placed');

  console.log(
    `  INFO  | fact | EventCatalog from the snapshot alone | from autocatalog |\n${Object.keys(
      withAc,
    )
      .map((key) => `        | ${key} | ${without[key]} | ${withAc[key]} |`)
      .join('\n')}`,
  );

  check(
    'side by side: alone, the event is named from the code (OrderPlaced), not the contract',
    () => {
      assert.equal(without['id of the order.placed page'], 'OrderPlaced');
      assert.equal(withAc['id of the order.placed page'], 'order.placed');
    },
  );
  check('side by side: only autocatalog has order.cancelled, which no test emits', () => {
    assert.equal(without.events, 'OrderPlaced');
    assert.equal(withAc.events, 'invoice.issued, order.cancelled, order.placed');
  });
  check('side by side: the contract schema (required, enum) only with autocatalog', () => {
    assert.equal(without['schema required'], 'none');
    assert.equal(without['currency values'], 'any string');
    assert.equal(withAc['schema required'], 'orderId, total, currency');
    assert.equal(withAc['currency values'], 'GBP or EUR');
  });
  check(
    'side by side: owner, contract version and declared consumers only with autocatalog',
    () => {
      assert.equal(without.owners, 'none');
      assert.equal(withAc.owners, 'acme-orders');
      assert.equal(without.version, '1.0.0');
      assert.equal(withAc.version, '1.1.0');
      assert.equal(without['services receiving it'], 'BillingService');
      assert.equal(withAc['services receiving it'], 'AnalyticsService, BillingService');
    },
  );
  check('side by side: both carry the orders.events channel', () => {
    assert.equal(without.channels, 'orders.events');
    assert.equal(withAc.channels, 'orders.events');
  });
  check('side by side: only autocatalog keeps the earlier contract version', () => {
    assert.equal(without['earlier versions'], 'none');
    assert.equal(withAc['earlier versions'], '1.0.0');
  });
}

const EXPERIMENTS = {
  '01-fresh-repo': freshRepo,
  '02-breaking-change': breakingChange,
  '03-multi-repo': multiRepo,
  '04-message-contracts': messageContracts,
  '05-full-pipeline': fullPipeline,
};

const wanted = process.argv.slice(2);

const names = wanted.length > 0 ? wanted : Object.keys(EXPERIMENTS);

for (const name of names) {
  // `01`, `fresh-repo` and `01-fresh-repo` all name the same experiment.
  const key = Object.keys(EXPERIMENTS).find(
    (k) => k === name || k.startsWith(`${name}-`) || k.endsWith(`-${name}`),
  );

  assert.ok(key, `no experiment ${name}; have ${Object.keys(EXPERIMENTS).join(', ')}`);
  const experiment = EXPERIMENTS[key];
  const dir = path.join(HERE, key);

  const variants = fs.existsSync(path.join(dir, 'variants'))
    ? fs
        .readdirSync(path.join(dir, 'variants'))
        .sort()
        .map((v) => path.join(dir, 'variants', v))
    : [dir];

  for (const variant of variants) {
    console.log(`\n== ${path.relative(HERE, variant)}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autocatalog-experiment-'));
    experiment(variant, tmp);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);

process.exitCode = failures === 0 ? 0 : 1;
