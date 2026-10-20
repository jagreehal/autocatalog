import { docsSchema } from '@astrojs/starlight/schema';
import { defineCollection, z } from 'astro:content';
import {
  declaredFrontmatterFields,
  resolveDocKinds,
  resolveDocsLayout,
  resolveFrontmatterContract,
} from 'autocatalog-docs-core';
import { docsSiteConfig } from './config';
import { docsLoader } from './loader';

// AUTOCATALOG_DOCS_* are set by the autocatalogDocs() plugin in config:setup,
// which fires before the loaders are invoked.
const { root, repo, schemaPath, conventionsPath } = docsSiteConfig();

// The reader and the site must address a document the same way, so the pattern
// and the id both come from the shared layout rather than being restated here.
const layout = resolveDocsLayout(root, repo === undefined ? {} : { repo });

/** Starlight's own frontmatter. A company field of the same name must not fight it. */
const STARLIGHT_FIELDS = new Set([
  'title',
  'description',
  'slug',
  'editUrl',
  'head',
  'tableOfContents',
  'template',
  'hero',
  'banner',
  'lastUpdated',
  'prev',
  'next',
  'sidebar',
  'draft',
  'pagefind',
]);

/** The four fields this plugin renders itself, typed because it reads them. */
const CONVENTION_FIELDS = {
  owner: z.string().optional(),
  summary: z.string().optional(),
  related: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
};

/**
 * Every other field the organisation's contract declares.
 *
 * A content collection drops anything it was not told about, so a field a
 * company added to its own schema would validate and then vanish before any
 * page could show it. Declaring them here is what makes the contract the single
 * place a company describes its documentation — add `tier` to the schema and
 * `entry.data.tier` exists, with no second registration anywhere.
 *
 * Loosely typed on purpose: the JSON Schema is the authority on what these are,
 * and restating its types in Zod would be the stale second copy the convention
 * exists to argue against.
 */
const contract = resolveFrontmatterContract(root, schemaPath);

// Each document kind's own fields too: an ADR's `status` is as much the
// organisation's contract as the base schema is.
const kindFields = resolveDocKinds(root, conventionsPath).kinds.flatMap((kind) =>
  kind.schema ? declaredFrontmatterFields(kind.schema) : [],
);

const customFields = Object.fromEntries(
  [...new Set([...declaredFrontmatterFields(contract.schema), ...kindFields])].flatMap((field) =>
    STARLIGHT_FIELDS.has(field) || field in CONVENTION_FIELDS
      ? []
      : [[field, z.unknown().optional()] as const],
  ),
);

export const collections = {
  // Starlight's own collection, pointed at every enrolled repository instead of
  // one `src/content/docs`. Starlight's loader is a glob over the project; this
  // is the same glob somewhere else, so pages, search and navigation are
  // Starlight's and only the source of the documents is ours.
  docs: defineCollection({
    loader: docsLoader(layout),
    // Everything is optional here, including `owner`, which the contract
    // requires. Enforcement belongs to the company's JSON Schema — checked when
    // the index is built and by `ac docs check` in the repository that owns the
    // document — not to a second, weaker copy of the rules in Zod. Requiring it
    // here would also reject the generated index page, which is not a document
    // and has no owning team.
    schema: docsSchema({ extend: z.object({ ...CONVENTION_FIELDS, ...customFields }) }),
  }),
};
