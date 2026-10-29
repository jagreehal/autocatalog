import fs from 'node:fs';
import path from 'node:path';
import { type DocsLayout, resolveDocsLayout } from 'autocatalog-docs-core';
import { docsSiteConfig } from './config';

/** The bits of hast this walk touches. Typing the whole tree would need a dep. */
interface Node {
  type?: string;
  tagName?: string;
  /** hast keeps both as plain strings; the walk touches no other property. */
  properties?: { href?: string; src?: string };
  children?: Node[];
}

/**
 * Rewrite links in document bodies onto the pages the site serves.
 *
 * The convention addresses documents by id — `payments-service/runbook` — so an
 * author writing a cross-repository link writes `/payments-service/runbook`.
 * That is correct at the root and wrong under an Astro `base`, which is how a
 * project site on GitHub Pages is always served. Starlight rewrites the links
 * it generates; the ones inside a markdown body are nobody else's job.
 *
 * Documents are also written to read on GitHub, where `[the runbook](runbook.md)`
 * is a file beside this one. The site serves that file at its id, so a relative
 * link to a document in the same repository's `docs/` becomes the page's URL.
 * One that names no such file is left for the link check to report.
 *
 * Left alone: protocol and protocol-relative URLs, anchors, and anything
 * already under the base, so running twice changes nothing.
 */
export function rehypeDocsBase(base: string) {
  const prefix = base.replace(/\/$/, '');

  return () => (tree: Node, file: { path?: string }) => {
    // Read when a document is rendered, not when the config is: the plugin
    // sets the root in config:setup, after astro.config.mjs called this.
    const { root, repo, repository } = docsSiteConfig();
    const layout = resolveDocsLayout(root, { repo, repository });

    rewrite(tree, (url) => {
      const document = file.path ? documentUrl(url, file.path, layout) : undefined;

      if (document !== undefined) return prefix + document;

      return prefix && based(url, prefix) ? prefix + url : url;
    });
  };
}

function rewrite(node: Node, to: (url: string) => string): void {
  const attr = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null;
  const value = attr ? node.properties?.[attr] : undefined;

  if (attr && value !== undefined) node.properties![attr] = to(value);

  for (const child of node.children ?? []) rewrite(child, to);
}

function based(url: string, prefix: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;

  return url !== prefix && !url.startsWith(`${prefix}/`);
}

/** `/<id>#anchor` for a relative link to a document in the same `docs/`, else undefined. */
function documentUrl(url: string, from: string, layout: DocsLayout): string | undefined {
  const match = /^([^/#?:][^#?:]*\.mdx?)(#.*)?$/.exec(url);

  if (!match) return undefined;
  const target = path.resolve(path.dirname(from), decodeURIComponent(match[1]!));
  const source = path.relative(layout.root, from).split(path.sep).join('/');
  const file = path.relative(layout.root, target).split(path.sep).join('/');
  // Another repository's documents are linked by id; `ac docs check` says so.
  const owner = layout.rootFor(source);

  if (!owner || layout.rootFor(file) !== owner || !fs.existsSync(target)) {
    return undefined;
  }

  return `/${layout.idFor(file)}${match[2] ?? ''}`;
}
