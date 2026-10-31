import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroUserConfig } from 'astro';
import { describe, expect, it } from 'vitest';
import { cjsShimAliases, reactRendererIntegration } from '../src/react-integration';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));

/** Resolves a transitive dep the way the docs package's React tree does. */
function resolveFromReactAria(id: string): string {
  const rac = require.resolve('react-aria-components/package.json');

  return createRequire(rac).resolve(id);
}

describe('CJS shims that React Aria named-imports', () => {
  it('React Aria named-imports useSyncExternalStore from a CommonJS-only shim', () => {
    // The UI components hydrate through react-aria-components, which imports the shim.
    const ui = path.join(here, '../src/ui');
    expect(fs.readFileSync(path.join(ui, 'overrides/ThemeSelect.tsx'), 'utf8')).toMatch(
      /from '#ui\/components\/ui\/button\.tsx'/,
    );
    expect(fs.readFileSync(path.join(ui, 'components/ui/button.tsx'), 'utf8')).toMatch(
      /from 'react-aria-components'/,
    );
    expect(fs.readFileSync(path.join(ui, 'components/CatalogExplorer.tsx'), 'utf8')).toMatch(
      /ToggleGroup/,
    );
    expect(fs.readFileSync(path.join(ui, 'components/ui/toggle-group.tsx'), 'utf8')).toMatch(
      /from 'react-aria-components'/,
    );

    const sheet = path.join(
      path.dirname(require.resolve('react-aria-components/package.json')),
      'dist/private/Sheet.mjs',
    );

    const sheetSource = fs.readFileSync(sheet, 'utf8');
    expect(sheetSource).toMatch(
      /import\s*\{\s*useSyncExternalStore\b[^}]*\}\s*from\s*["']use-sync-external-store\/shim\/index\.js["']/,
    );

    const shim = resolveFromReactAria('use-sync-external-store/shim/index.js');
    const shimSource = fs.readFileSync(shim, 'utf8');
    expect(shimSource).toMatch(/module\.exports/);
    expect(shimSource).not.toMatch(/\bexport\s+(?:\{|function|const|default)/);
  });

  it('aliases those CJS shim paths to an ESM re-export from react', () => {
    const aliases = cjsShimAliases(path.join(here, '../src'));
    expect(aliases).toHaveLength(1);

    const { find, replacement } = aliases[0]!;
    expect(find.test('use-sync-external-store/shim')).toBe(true);
    expect(find.test('use-sync-external-store/shim/index.js')).toBe(true);
    // Exact matches only: other files under the shim keep their own path.
    expect(find.test('use-sync-external-store/shim/with-selector.js')).toBe(false);

    const source = fs.readFileSync(replacement, 'utf8');
    expect(source).toMatch(/export\s*\{\s*useSyncExternalStore\s*\}\s*from\s*['"]react['"]/);
  });
});

describe('reactRendererIntegration', () => {
  it('installs the CJS shim aliases on the Vite config', () => {
    const patches: AstroUserConfig[] = [];
    const setup = reactRendererIntegration().hooks['astro:config:setup'];

    // SAFETY: the hook calls only updateConfig.
    setup?.({ updateConfig: (config: AstroUserConfig) => patches.push(config) } as never);

    expect(patches[0]?.vite?.resolve?.alias).toEqual(expect.arrayContaining(cjsShimAliases()));
  });
});
