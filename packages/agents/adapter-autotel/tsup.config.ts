import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts', 'src/node.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: true,
});
