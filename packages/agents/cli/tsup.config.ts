import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  // The library entry is public now that `ac agents` calls it, so it ships types.
  dts: { entry: 'src/index.ts' },
  clean: true,
  outDir: 'dist',
  sourcemap: true,
  platform: 'node',
  target: 'node24',
});
