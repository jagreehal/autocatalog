import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  declaredPackages,
  declaringFolders,
  fromBuiltSite,
  fromSite,
  packageName,
  resolveOrder,
} from '../src/site-resolve';

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'autocatalog-resolve-'));

fs.writeFileSync(
  path.join(project, 'package.json'),
  JSON.stringify({ dependencies: { yaml: '2.9.1' }, devDependencies: { '@acme/ui': '1.0.0' } }),
);

afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

const at = (dir: string) => pathToFileURL(path.join(dir, 'noop.js')).href;

describe('site-resolve', () => {
  it('names the package a bare import is from', () => {
    expect(packageName('js-yaml')).toBe('js-yaml');
    expect(packageName('js-yaml/dist/js-yaml.mjs')).toBe('js-yaml');
    expect(packageName('@scope/name/sub/path')).toBe('@scope/name');
  });

  it('reads an import the build marked as the site’s', () => {
    expect(fromSite('autocatalog-site:express?from=')).toEqual({ name: 'express', folder: '' });
    expect(fromSite('autocatalog-site:@scope/name/sub?from=node_modules%2Fext')).toEqual({
      name: '@scope/name/sub',
      folder: 'node_modules/ext',
    });
    expect(fromSite('express')).toBeUndefined();
  });

  it('gives CommonJS and ES modules the same marked package', () => {
    const site = path.join(project, 'cjs');
    const other = path.join(project, 'other');

    for (const [dir, version] of [
      [site, 'the site’s'],
      [other, 'another'],
    ] as const) {
      const thing = path.join(dir, 'node_modules/thing');
      fs.mkdirSync(thing, { recursive: true });
      fs.writeFileSync(path.join(thing, 'package.json'), JSON.stringify({ name: 'thing' }));
      fs.writeFileSync(
        path.join(thing, 'index.js'),
        `module.exports = ${JSON.stringify(version)};`,
      );
    }

    const built = path.join(other, 'built.mjs');
    fs.writeFileSync(
      built,
      [
        "import { createRequire } from 'node:module';",
        "import imported from 'autocatalog-site:thing?from=';",
        "const required = createRequire(import.meta.url)('autocatalog-site:thing?from=');",
        "const { sep } = createRequire(import.meta.url)('autocatalog-site:path?from=');",
        'console.log(JSON.stringify([imported, required, sep]));',
      ].join('\n'),
    );

    const hook = new URL('../src/site-resolve.ts', import.meta.url).href;

    const output = execFileSync(process.execPath, ['--import', hook, built], {
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', AUTOCATALOG_RESOLVE_SITE: site },
    });

    expect(JSON.parse(output)).toEqual(['the site’s', 'the site’s', path.sep]);
  });

  it('reads every dependency list the project names', () => {
    expect([...declaredPackages(project)].sort()).toEqual(['@acme/ui', 'yaml']);
    expect(declaredPackages(path.join(project, 'missing')).size).toBe(0);
  });

  it('tries autocatalog first for a package the project only has hoisted', () => {
    // Starlight imports js-yaml 4; a project can have js-yaml 5 from some other tool.
    const folders = [at('/autocatalog/starlight')];

    expect(resolveOrder('js-yaml', folders, project)).toEqual([...folders, at(project)]);
    expect(resolveOrder('js-yaml', folders, undefined)).toEqual(folders);
  });

  it('takes the built site as autocatalog code, even inside the project', () => {
    // `dist/` in the project: Node alone would find the project's hoisted packages first.
    const built = at(path.join(project, 'dist'));
    const dist = pathToFileURL(path.join(project, 'dist', path.sep)).href;

    expect(fromBuiltSite(`${dist}server/chunks/head.mjs`, dist)).toBe(true);
    expect(fromBuiltSite(built.replace('dist/noop.js', 'src/page.mjs'), dist)).toBe(false);
    expect(fromBuiltSite(undefined, dist)).toBe(false);
    expect(fromBuiltSite(`${dist}server/entry.mjs`, undefined)).toBe(false);
  });

  it('tries the folder that names a package before one that only has it hoisted', () => {
    // Express brings cookie 0.7; Astro's output imports the cookie 2 that Astro names.
    const astro = path.join(project, 'astro');
    fs.mkdirSync(astro, { recursive: true });
    fs.writeFileSync(
      path.join(astro, 'package.json'),
      JSON.stringify({ dependencies: { cookie: '^2.0.0' }, devDependencies: { express: '5' } }),
    );

    const folders = [at('/autocatalog/docs-astro'), at(astro)];

    expect(declaringFolders('cookie', folders)).toEqual([at(astro)]);
    expect(declaringFolders('express', folders)).toEqual([]);
    expect(resolveOrder('cookie', folders, project)).toEqual([at(astro), folders[0], at(project)]);
  });

  it('tries the project first for a package it names, so its own code gets its version', () => {
    const folders = [at('/autocatalog/docs-astro')];

    // No folder names these, so nothing but the project can be meant.
    expect(resolveOrder('yaml', folders, project)).toEqual([at(project), ...folders]);
    expect(resolveOrder('@acme/ui/button', folders, project)[0]).toBe(at(project));
  });
});
