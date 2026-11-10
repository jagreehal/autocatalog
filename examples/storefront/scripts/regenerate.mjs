// Regenerate the storefront's repositories from an EventCatalog checkout:
//   node scripts/regenerate.mjs <path to eventcatalog checkout> [--force]
//
// It replaces each team's folder, so it refuses a checkout at another commit
// unless --force says the different output is wanted.
//
// 1. `ac from-eventcatalog` reads examples/default into manifests.
// 2. convert.mjs writes a repository per team, and the handbook.
// 3. `ac resources scan` folds each repository's imported services into resources.json.
// 4. Prettier formats them as the rest of the repository is.
//
// Run twice, it writes the same files: the storefront is this script's output.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The EventCatalog commit the committed storefront was read from. */
const COMMIT = '23b4bb0';

const args = process.argv.slice(2);

const force = args.includes('--force');

const [checkout] = args.filter((arg) => arg !== '--force');

if (!checkout) {
  console.error('usage: node scripts/regenerate.mjs <path to eventcatalog checkout> [--force]');
  process.exit(1);
}

const demo = path.resolve(import.meta.dirname, '..');

const monorepo = path.resolve(demo, '../..');

const ac = path.join(monorepo, 'packages/events/cli/dist/bin.js');

const example = path.join(path.resolve(checkout), 'examples/default');

const head = execFileSync('git', ['-C', checkout, 'rev-parse', '--short=7', 'HEAD'], {
  encoding: 'utf8',
}).trim();

if (head !== COMMIT && !force) {
  console.error(
    `${checkout} is at ${head}, not ${COMMIT}: the output would differ from the committed catalog. Check out ${COMMIT}, or pass --force to regenerate from ${head}.`,
  );
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-'));

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });

run('node', [ac, 'from-eventcatalog', example, '--out', path.join(work, 'import/events'), '-q']);

run('node', [
  path.join(demo, 'scripts/convert.mjs'),
  example,
  path.join(work, 'import'),
  path.join(work, 'out'),
]);

const repositories = fs.readdirSync(path.join(work, 'out')).sort();

for (const repository of repositories) {
  run('node', [ac, 'resources', 'scan', path.join(work, 'out', repository), '-q']);
}

// Replace each repository whole, so a file the converter no longer writes goes too.
for (const repository of repositories) {
  fs.rmSync(path.join(demo, repository), { recursive: true, force: true });
  fs.cpSync(path.join(work, 'out', repository), path.join(demo, repository), { recursive: true });
}

run(path.join(monorepo, 'node_modules/.bin/prettier'), [
  '--write',
  '--log-level',
  'warn',
  ...repositories.map((repository) => path.join(demo, repository)),
]);

fs.rmSync(work, { recursive: true, force: true });

console.log(`regenerated ${repositories.length} repositories from eventcatalog@${head}`);
