import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
  // typescript is used at runtime for AST parsing; bundling it breaks ESM (dynamic require)
  external: ['typescript'],
  banner: { js: '#!/usr/bin/env node' },
});
