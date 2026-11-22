// The Effect rules, type-aware, over every workspace package that depends on
// `effect`: a package that adopts Effect is linted without a line changing here.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const globs = fs
  .readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  .split('\n')
  .flatMap((line) => /^\s+-\s+'([^']+)'/.exec(line)?.[1] ?? []);

const folders = globs.flatMap((glob) => {
  if (!glob.endsWith('/*')) {
    return [glob];
  }

  const parent = path.join(root, glob.slice(0, -2));

  return fs.existsSync(parent)
    ? fs
        .readdirSync(parent, { withFileTypes: true })
        .flatMap((entry) => (entry.isDirectory() ? [path.join(glob.slice(0, -2), entry.name)] : []))
    : [];
});

const usesEffect = (folder) => {
  const manifest = path.join(root, folder, 'package.json');

  if (!fs.existsSync(manifest)) {
    return false;
  }

  const { dependencies = {}, devDependencies = {} } = JSON.parse(fs.readFileSync(manifest, 'utf8'));

  return 'effect' in dependencies || 'effect' in devDependencies;
};

const packages = folders.filter(usesEffect);

if (packages.length === 0) {
  console.log('No workspace package depends on effect.');
  process.exit(0);
}

console.log(`Effect rules over ${packages.join(', ')}`);

// From inside each package: oxlint reads `oxlint-suppressions.json` from where
// it runs, and the root one records the main config's findings, not these.
const failed = packages.filter((folder) => {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'effect-tsgo',
      'oxlint',
      '--type-aware',
      '--disable-nested-config',
      '-c',
      path.join(root, '.oxlintrc.effect.json'),
      '--deny-warnings',
      '.',
    ],
    { cwd: path.join(root, folder), stdio: 'inherit' },
  );

  return result.status !== 0;
});

process.exit(failed.length > 0 ? 1 : 0);
