import { fileURLToPath } from 'node:url';
import { closestMatch, resourceKey } from 'autocatalog-core';
import {
  domainNeighbourhood,
  lookupTerm,
  resolveAbout,
  serviceNeighbourhood,
} from 'autocatalog-docs-core';
import type { Plugin } from 'vite';
import type { DocsCatalog } from './catalog';
import { eventPath } from './event-path';
import { flowVisualiser } from './flows';
import { dataProductPageProps, termAnchor } from './model';
import { graphOwners, ownerFor, ownerHref } from './owners';
import { eventPages, servicePages } from './page-models';
import type { VisualiserGraph } from './ui/lib/visualiser';
import { schemaTree, type PropNode } from './ui/lib/schema-tree';
import { catalogGraph } from './visualiser';

/** The components every `.mdx` document can use without importing them. */
export const MDX_COMPONENTS = ['Map', 'Schema', 'Term', 'Owner'] as const;

/** By file path, so a document outside the site's project resolves it too. */
export const MDX_MODULE = fileURLToPath(new URL('./mdx/index.ts', import.meta.url));

/**
 * Import the built-in components into an `.mdx` file that uses them and does
 * not import them itself. A transform on the source rather than a remark
 * plugin, so it works with whichever Markdown processor the site runs.
 */
export function mdxComponents(): Plugin {
  return {
    name: 'autocatalog-docs-mdx-components',
    enforce: 'pre',
    transform(code, id) {
      if (!id.split('?')[0]!.endsWith('.mdx')) return undefined;

      return withComponentImports(code);
    },
  };
}

/** The source with an import for each built-in component it uses and does not import. */
export function withComponentImports(code: string): string | undefined {
  const prose = withoutCode(code);
  const bound = importedNames(prose);

  const used = MDX_COMPONENTS.filter(
    (name) => new RegExp(`<${name}[\\s/>]`).test(prose) && !bound.has(name),
  );

  if (used.length === 0) return undefined;

  const line = `import { ${used.join(', ')} } from ${JSON.stringify(MDX_MODULE)};\n`;
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(code);

  return frontmatter
    ? `${frontmatter[0]}${line}${code.slice(frontmatter[0].length)}`
    : `${line}${code}`;
}

/**
 * The source with its code examples blanked: fenced blocks and inline code.
 * MDX has no indented code, so these are the only places an example hides.
 */
function withoutCode(code: string): string {
  return code
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/(`+)[\s\S]*?\1/g, '');
}

/** The local names a file's imports bind: `Map` in `import { Map }`, but not in `import { Map as Own }`. */
function importedNames(code: string): Set<string> {
  const names = new Set<string>();

  for (const [, clause] of code.matchAll(/^import\s+([^'";]+?)\s+from\s+['"]/gm)) {
    const named = /\{([^}]*)\}/.exec(clause!)?.[1] ?? '';
    const rest = clause!.replace(/\{[^}]*\}/, '');

    for (const binding of [...named.split(','), ...rest.split(',')]) {
      const name = binding
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.replace(/^(type|\*)\s*/, '');

      if (name) names.add(name);
    }
  }

  return names;
}

/**
 * The map `<Map focus="…">` draws: the whole catalog, or the part around one
 * resource, written as `about:` writes it, or `flow/<id>`, `domain/<name>`,
 * `data-product/<id>`. A focus that names nothing fails the build with the
 * nearest match.
 */
export async function mdxMap(
  catalog: Pick<DocsCatalog, 'events' | 'flows' | 'graph' | 'model'>,
  base: string,
  focus: string | undefined,
  repository?: string,
): Promise<VisualiserGraph | undefined> {
  const pages = { servicePages: servicePages(catalog), eventPages: eventPages(catalog) };

  if (!focus) return catalogGraph(catalog.graph, base, pages);

  const [kind, ...rest] = focus.split('/');
  const id = rest.join('/');

  if (kind === 'flow') {
    const flow = catalog.flows.find((candidate) => candidate.id === id);

    if (!flow)
      throw new Error(
        missing(
          'flow',
          id,
          catalog.flows.map((each) => each.id),
        ),
      );

    return flowVisualiser(flow, catalog, base, pages);
  }

  if (kind === 'data-product') {
    const product = catalog.model.dataProducts.find((candidate) => candidate.id === id);

    if (!product) {
      throw new Error(
        missing(
          'data product',
          id,
          catalog.model.dataProducts.map((each) => each.id),
        ),
      );
    }

    return (await dataProductPageProps(product, catalog, base, pages)).visualiser;
  }

  if (kind === 'domain') {
    const domains = [...new Set(catalog.events.map(({ event }) => event.frontmatter.domain))];

    if (!domains.includes(id)) throw new Error(missing('domain', id, domains));

    return catalogGraph(catalog.graph, base, {
      ...pages,
      only: domainNeighbourhood(catalog.graph, id),
    });
  }

  if (kind === 'service') {
    const services = catalog.graph.resources.flatMap((resource) =>
      resource.ref.kind === 'service' ? [resource.ref.id] : [],
    );

    if (!services.includes(id)) throw new Error(missing('service', id, services));

    return catalogGraph(catalog.graph, base, {
      ...pages,
      only: serviceNeighbourhood(catalog.graph, id),
    });
  }

  const resolution = resolveAbout(focus, catalog.graph.resources, repository);

  if ('failure' in resolution) throw new Error(`<Map focus="${focus}">: ${resolution.failure}`);

  // One resource and everything one relationship away from it.
  const key = resourceKey(resolution.ref);
  const only = new Set([key]);

  for (const { from, to } of catalog.graph.relationships) {
    if (resourceKey(from) === key) only.add(resourceKey(to));

    if (resourceKey(to) === key) only.add(resourceKey(from));
  }

  return catalogGraph(catalog.graph, base, { ...pages, only });
}

const missing = (what: string, id: string, ids: string[]) => {
  const hint = closestMatch(id, ids);

  return `no ${what} '${id}'${hint ? ` — did you mean '${hint}'?` : ''}`;
};

/** What `<Schema>` draws: the event's name, its page, and its properties. */
export interface MdxSchema {
  title: string;
  href: string;
  nodes: PropNode[];
}

/** What `<Term>` links: the term's name, its definition, and its place in the glossary. */
export interface MdxTerm {
  name: string;
  summary?: string | undefined;
  href: string;
}

/** The schema `<Schema event="event/<domain>/<id>">` shows, with the event's page. */
export function mdxSchema(
  catalog: Pick<DocsCatalog, 'events'>,
  base: string,
  reference: string,
): MdxSchema {
  const [kind, domain, id] = reference.split('/');

  const found = catalog.events.filter(
    ({ event }) => event.frontmatter.domain === domain && event.frontmatter.id === id,
  );

  if (kind !== 'event' || found.length !== 1) {
    const hint = closestMatch(
      reference,
      catalog.events.map(
        ({ event }) => `event/${event.frontmatter.domain}/${event.frontmatter.id}`,
      ),
    );

    throw new Error(
      `<Schema event="${reference}">: ${found.length > 1 ? 'more than one repository publishes it' : `no such event${hint ? ` — did you mean '${hint}'?` : ''}`}`,
    );
  }

  const entry = found[0]!;

  return {
    title: entry.event.frontmatter.name ?? entry.event.frontmatter.id,
    href: `${base}${eventPath(entry)}`,
    nodes: schemaTree(entry.event.schema),
  };
}

/** The term `<Term id="…">` names: its definition, linked to the glossary. */
export function mdxTerm(
  catalog: Pick<DocsCatalog, 'model'>,
  base: string,
  id: string,
  domain?: string,
): MdxTerm {
  const found = lookupTerm(catalog.model.glossaries, id).filter(
    (term) => term.id === id && (!domain || term.domain === domain),
  );

  if (found.length !== 1) {
    throw new Error(
      `<Term id="${id}">: ${found.length > 1 ? `defined in ${found.map((term) => term.domain).join(' and ')}; name the domain` : 'no glossary defines it'}`,
    );
  }

  const term = found[0]!;

  return {
    name: term.name,
    summary: term.summary,
    href: `${base}glossary/#${termAnchor(term.domain, term.id)}`,
  };
}

/** The owner `<Owner name="…">` names, linked to their page when the catalog has one. */
export function mdxOwner(
  catalog: Pick<DocsCatalog, 'graph'>,
  name: string,
): { name: string; href?: string | undefined } {
  const owner = ownerFor(graphOwners(catalog.graph), name);

  return owner ? { name: owner.name, href: ownerHref(owner) } : { name };
}
