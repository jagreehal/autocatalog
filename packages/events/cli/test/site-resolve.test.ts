import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { declaredPackages, fromBuiltSite, packageName, resolveOrder } from '../src/site-resolve';

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

  it('tries the project first for a package it names, so its own code gets its version', () => {
    const folders = [at('/autocatalog/docs-astro')];

    expect(resolveOrder('yaml', folders, project)).toEqual([at(project), ...folders]);
    expect(resolveOrder('@acme/ui/button', folders, project)[0]).toBe(at(project));
  });
});
