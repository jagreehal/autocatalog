// Type-check every package with TypeScript 7, the native compiler.
//
// TypeScript 6 stays installed beside it: TypeScript 7 publishes its compiler
// API only as unstable, and the static Zod scanner, tsup's declaration build
// and astro check all call that API. So 7 checks the code and 6 serves the API.
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

// bin/ is not in the package's exports, so find it beside package.json.
const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve('typescript-7/package.json')),
  'bin/tsc',
);

const projects = globSync(['packages/*/*/tsconfig.json', 'apps/*/tsconfig.json'], {
  cwd: root,
}).map((config) => path.join(root, path.dirname(config)));

let failed = 0;

for (const dir of projects) {
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', dir], { stdio: 'inherit' });

  if (result.status !== 0) {
    failed += 1;
    console.error(`✗ ${path.relative(root, dir)}`);
  }
}

console.log(`${projects.length - failed}/${projects.length} projects type-check`);

process.exit(failed > 0 ? 1 : 0);
