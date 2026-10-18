# autocatalog-docs-astro

A [Starlight](https://starlight.astro.build) plugin that reads **every enrolled
repository's `docs/`** instead of one `src/content/docs`.

Teams keep authorship in git, beside the code the document describes. Readers
get a company index with search, navigation and everything else Starlight
already does well. Nothing has to move into a wiki.

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import autocatalogDocs from 'autocatalog-docs-astro';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Acme docs',
      plugins: [autocatalogDocs()],
    }),
  ],
});
```

```ts
// src/content.config.ts — Astro loads this from your project, so re-export it
export { collections } from 'autocatalog-docs-astro/content.config';
```

## What is Starlight's, and what is this

Search, keyboard and screen-reader support, dark mode, translations, the table
of contents, previous/next — all Starlight's, and better than a hand-rolled
site would ever be. This plugin supplies only what Starlight has no opinion
about, because it assumes one repository:

| Added                           | How                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Documents from every repo       | The `docs` collection is loaded from the aggregation root, ids derived from path                    |
| Sidebar                         | One group per repository, generated from disk, titled from each document's frontmatter              |
| Ownership                       | `owner` frontmatter, shown below every document                                                     |
| Freshness                       | Last commit touching the file, asked of the repository that owns it                                 |
| Both link directions            | Declared `related` edges, plus the backlinks derived from them                                      |
| `/`                             | An index page, because no single team should own the company's front door                           |
| `/catalog`                      | One browsable inventory of Docs, Events, Agents, evidence, and relationships                        |
| `/catalog.json`                 | The same composed inventory as deterministic `autocatalog/graph-v1` JSON                            |
| `/domains`, `/domains/<domain>` | Each domain's events, services, owners and map                                                      |
| `/apis/<repo>/<name>`           | An API reference for each OpenAPI spec under `contracts/`, with the spec beside it                  |
| `/schemas`                      | Every event schema with its format, version, domain and owner                                       |
| `/<repo>/<path>.md`             | A raw markdown twin of every document, event and service page                                       |
| `/llms.txt`, `/llms-full.txt`   | The whole index in the llms.txt format, and the full text of every document and event               |
| `/contracts/docs-manifest.json` | The aggregated docs index that each repository's `ac docs check` resolves links against             |
| The title block                 | An override of Starlight's `PageTitle`: a resource's catalog key, and where its definition was read |

Navigation, search and the table of contents stay Starlight's. The look is a
shadcn/ui preset and DESIGN.md at the repository root. A site that sets its own
`customCss` or overrides `PageTitle` keeps its own.

Ids come from where the file is (`payments-service/docs/runbook.md` →
`payments-service/runbook`), never from a declared id that can disagree with the
filesystem.

## Nothing here is authored

The site is derived output, so it cannot disagree with what the repositories
committed:

- **Freshness comes from git**, and each enrolled repository may be its own
  checkout, which the site's git history knows nothing about — so the date is
  asked of the owning repository. When git cannot answer — an uncommitted file,
  a shallow clone — the page says the last change is unknown rather than
  inventing a date. This is why Starlight's own `lastUpdated` is not used.
- **Backlinks are derived.** A document declares `related: [other-repo/doc]`;
  the target's page shows who points at it, because the target cannot be
  expected to know.
- **The sidebar is what is on disk.** Enrolling a repository is cloning it, not
  editing this site's config. Set `sidebar` in your Starlight config to take it
  back.
- **The index is built, not read.** `buildDocsManifest` runs during the build, so
  a document that breaks the contract fails the build.
- **The Catalog is composed, not copied.** Conventional `docs/`, `events/`, and
  Agent-system directories are compiled through their own Adapters and joined
  by Repository identity. A composed fact is never silently replaced by a later
  Adapter: contradictions fail with `ResourceGraphConflictError`.
- **A repository that will not compile is quarantined, not hidden.** Its events
  or agents are left out of the graph, the build warns, and `/catalog` names the
  repository and the reason. One team's broken catalog does not take down the
  index every other team reads — and failing the merge is that repository's own
  job, through `ac docs check` and `ac validate` where the mistake was made.

## Your contract, your fields

The frontmatter contract is a committed JSON Schema the organisation owns —
`contracts/docs-frontmatter.json`, found without a flag. Add a field to it and
**it reaches the page**, because the content collection is built from the
contract's own `properties`:

```jsonc
// contracts/docs-frontmatter.json
{
  "required": ["title", "owner", "tier"],
  "properties": {
    "owner": { "enum": ["Reliability", "Payments", "Data Platform"] },
    "tier": { "enum": ["critical", "standard"] },
  },
}
```

```astro
---
// src/DocTitle.astro — an ordinary Starlight override, in your project. It
// wraps the plugin's title, which adds the badge, crumbs and version pills.
import Default from 'autocatalog-docs-astro/overrides/PageTitle.astro';
const tier = Astro.locals.starlightRoute?.entry?.data?.tier;
---
<Default><slot /></Default>
{tier === 'critical' && <p>Someone may be paged while reading this.</p>}
```

One declaration, three consequences: `ac docs check` fails a pull request
without a valid `tier`, `entry.data.tier` exists on every page, and a Python
repository can enforce the same rule with `jsonschema`. There is no second place
to register the field.

Zod's role here is only to keep fields, never to define them: `owner`, `summary`,
`related` and `tags` are declared so Starlight does not strip them, and every one
is optional. Requiring anything in Zod would be a second, weaker copy of rules
the company already owns — and would reject the generated index page, which is
not a document. Enforcement happens in the two places that read the JSON Schema:
the site build, and `ac docs check` in the repository that owns the document.

If you close your contract with `"additionalProperties": false`, remember to
declare any Starlight frontmatter your documents use (`template`, `sidebar`,
`hero`, …) — the contract governs the whole file.

## Options

| Option        | Default | Meaning                                              |
| ------------- | ------- | ---------------------------------------------------- |
| `root`        | `..`    | Aggregation root, relative to the Astro project      |
| `repo`        | —       | URL namespace documents sit under, single-repo shape |
| `repository`  | `repo`  | Repository identity in the graph, when it differs    |
| `schema`      | —       | Committed JSON Schema the frontmatter must satisfy   |
| `description` | —       | One sentence, used on `/` and in `llms.txt`          |

Title, theming, custom CSS, social links and every other appearance choice are
Starlight's own config — this plugin does not wrap them.

`root` defaults to `..`: a docs site in its own repository, reading the sibling
repositories checked out beside it. Point it at a directory containing `docs/`
to publish a single repository's own documentation instead — the shape is
detected from disk, not configured.

`repo` is an address: a document's id is where it is published, so `repo: 'docs'`
puts every page under `/docs/`. A project site already served from `/<repo>/`
usually wants a shorter word there than the repository is called — and the graph
joins Documents, Events and Agents on the repository's real name. That is what
`repository` is for, and it defaults to `repo` when the two agree.

## Deploying under a base path

A project site on GitHub Pages is served from `/<repo>/`, not from the root. The
plugin prefixes Astro's `base` onto every link it generates, and Starlight does
the same for its own. Links **inside** a document are the one thing left: the
convention addresses documents by id, so an author writes
`/payments-service/runbook`, which is correct at the root and wrong under a base.

Astro fixes the markdown pipeline before a plugin-added integration can reach it,
so that rewrite is wired from the site's own config:

```js
import autocatalogDocs, { rehypeDocsBase } from 'autocatalog-docs-astro';

const base = '/my-repo';

export default defineConfig({
  site: 'https://acme.github.io',
  base,
  markdown: { rehypePlugins: [rehypeDocsBase(base)] },
  integrations: [starlight({ plugins: [autocatalogDocs()] })],
});
```

Sites served from the root need none of this; the plugin is a no-op when `base`
is `/`.

## Images

A diagram or screenshot committed next to the document works the way it looks:

```md
![The capture path, from checkout to settlement](./capture-flow.png)
```

Astro optimises it into the site's own assets, so the image survives the repo it
came from being cloned somewhere else. That needs `sharp` installed in the site
project — Astro's default image service — or the build fails on the first
document that includes one. The `.md` twin keeps the original relative
reference, so an agent reading raw markdown sees the path, not the built asset.

## Maps

Event and service pages draw their message flow, and the knowledge graph page a
map of every event, service, agent and tool, with EventCatalog's own visualiser
(`@eventcatalog/visualiser`, MIT): pan, zoom, fit, node search and a legend.
Its code loads only once the map nears the viewport; without JavaScript the
page shows the same flow as static HTML.

## React

Every page and override is a React component (`src/ui`), rendered at build
time and hydrated only where a reader can do something: filters, search, the
schema tree, maps, copy and the theme button. Each one has a Storybook story:
`pnpm --filter autocatalog-docs-astro storybook`.

The components are stock [shadcn/ui](https://ui.shadcn.com) (React Aria base,
preset `b0`), added with the shadcn CLI into `src/ui/components/ui` and styled
with Tailwind. The theme is shadcn's, in `src/ui/styles/tailwind.css`, and
Starlight's colour variables point at its tokens, so changing those tokens
restyles the whole site, search and sidebar included. `@shadcn/lint` (in the root oxlint config) keeps `src/ui` to stock
components and theme tokens. The plugin adds Tailwind's Vite plugin unless the
site already runs it.

The plugin brings React and adds `@astrojs/react` unless the site already has
it, so a build needs nothing installed. `astro dev` loads React from the site's
own `node_modules`, so a site using pnpm must add `react` and `react-dom` to its
dependencies; until it does, `astro dev` stops and says so.

## In CI

The site build fails on a broken contract, but a publishing repository should
not learn that from the aggregator's build. Run the check in the repository that
owns the document, in the pull request that changed it:

```bash
ac docs check          # frontmatter, cross-repo links, and deleted-but-linked docs
ac docs manifest       # publish contracts/docs-manifest.json
```

See [autocatalog-docs-core](../core/README.md) for what those enforce.

## Working example

`examples/docs-demo` aggregates three repositories that each own their `docs/`.
One also owns Events and an Agent system, all visible in the same `/catalog`.
Nothing in the site project authors a document, a date, a backlink, or a graph
connection.

`apps/docs` is the other shape: one repository publishing its own `docs/`, with a
configured sidebar and a hand-written home page. It is what autocatalog's own
documentation site is built from.
