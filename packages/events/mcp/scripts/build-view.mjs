// The MCP App view as one self-contained HTML file: hosts frame it without
// network access, so its script and styles go inline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

const result = await build({
  entryPoints: [path.join(root, 'view/map.tsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  jsx: 'automatic',
  write: false,
  outdir: 'out',
  define: { 'process.env.NODE_ENV': '"production"' },
  // Loaded only when a reader asks for the Mermaid view, which the map does not offer.
  external: ['mermaid'],
  logLevel: 'warning',
});

const file = (ext) => result.outputFiles.find((output) => output.path.endsWith(ext))?.text ?? '';

// A closing tag inside the bundle would end the inline element early.
const inline = (code, tag) => code.replaceAll(`</${tag}`, `<\\/${tag}`);

await fs.writeFile(
  path.join(root, 'dist/map.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>Catalog map</title><style>${inline(file('.css'), 'style')}</style></head><body><div id="root"></div><script type="module">${inline(file('.js'), 'script')}</script></body></html>`,
);
