import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

/** Accent colours a site can pick by name. `theme.css` in a brand folder sets any other. */
export const SITE_THEMES = ['teal', 'blue', 'orange', 'green', 'purple'] as const;

/** A page in the navigation, under its own name unless a label replaces it. */
interface NavigationPage {
  id: string;
  label?: string | undefined;
}

const navigationItem = z.union([
  // A page the catalog publishes, by its path: `owners`, `domains`, `catalog`.
  z
    .string()
    .min(1)
    .transform((id): NavigationPage => ({ id })),
  z.strictObject({ id: z.string().min(1), label: z.string().min(1).optional() }),
  z.strictObject({ label: z.string().min(1), href: z.string().min(1) }),
]);

export const siteNavigationSchema = z.strictObject({
  /** Replace the catalog's group. Your own documents follow them. */
  groups: z.array(
    z.strictObject({
      label: z.string().min(1),
      collapsed: z.boolean().optional(),
      items: z.array(navigationItem),
    }),
  ),
});

/**
 * A section of the site, in the rail beside the sidebar (or the header, on a
 * page with no sidebar). `match` is the paths it stands for, so a section stays
 * current on its pages: `/guides/` lights up on `/guides/setup/`. It defaults to
 * `href`. `icon` names one of the catalog's icons, such as `book` or `api`.
 */
export const siteNavLinkSchema = z.strictObject({
  label: z.string().min(1),
  href: z.string().min(1),
  icon: z.string().min(1).optional(),
  match: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
});

export type SiteNavLink = z.infer<typeof siteNavLinkSchema>;

/** As a site writes it. */
export type SiteNavigationInput = z.input<typeof siteNavigationSchema>;

/** As it reads once parsed, each item an object. */
export type SiteNavigation = z.infer<typeof siteNavigationSchema>;

/**
 * Who may open each document, decided per request on a server site. Pages,
 * the sidebar, previous and next, the home and kind pages and the assistant
 * all follow the one rule.
 */
export const siteAccessSchema = z.strictObject({
  /**
   * Your module, relative to this file: it default-exports `SiteAccess` from
   * autocatalog-docs-astro, `{ reader, canRead? }`.
   */
  module: z.string().min(1),
  /**
   * What a reader gets for a document they may not open: `hide`, a 404 that
   * names nothing (the default), or `teaser`, its title and summary with a 403.
   */
  denied: z.enum(['hide', 'teaser']).optional(),
});

export type SiteAccessConfig = z.infer<typeof siteAccessSchema>;

/** The assistant every page offers, answering from the pages the site publishes. */
export const siteChatSchema = z.strictObject({
  /**
   * Your module, relative to this file: it default-exports the options of
   * `createChat` from autocatalog-chatbot, at least `model` and `subject`.
   */
  module: z.string().min(1),
  /** The panel's name and the button that opens it: "Ask Acme". */
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  /** Questions a reader can send with one click. */
  suggestions: z.array(z.string().min(1)).optional(),
  /** Your endpoint that takes a message for a person, with the conversation attached. */
  support: z
    .strictObject({ api: z.string().min(1), note: z.string().min(1).optional() })
    .optional(),
  /** Any of the words the panel shows, by name, such as `placeholder` or `emptyTitle`. */
  text: z.record(z.string(), z.string()).optional(),
  /**
   * Any of its icons, by name, such as `launcher` or `send`: a `.svg` file
   * relative to this file, an SVG's URL, or its markup. Drawn in the text colour.
   */
  icons: z.record(z.string(), z.string().min(1)).optional(),
  /** The corner the panel sits in. */
  side: z.enum(['right', 'left']).optional(),
  /**
   * Your React component in place of the panel, relative to this file. It is
   * given the panel's props, and composes the parts autocatalog-docs-astro/chat
   * exports, such as `ChatRoot`, `ChatWindow` and `useChatPanel`.
   */
  panel: z.string().min(1).optional(),
});

export type SiteChat = z.infer<typeof siteChatSchema>;

const link = z.strictObject({ label: z.string().trim().min(1), href: z.string().trim().min(1) });

/**
 * The built-in blocks a page's layout is made of, each with its own props. A
 * block a site's `extend` adds checks its own props.
 */
export const HOME_BLOCKS = {
  /** A heading, a line under it and links to act on. */
  hero: z.strictObject({
    block: z.literal('hero'),
    title: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    actions: z.array(link).optional(),
  }),
  /** Hand-picked links as cards. */
  cards: z.strictObject({
    block: z.literal('cards'),
    title: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.strictObject({
          title: z.string().trim().min(1),
          href: z.string().trim().min(1),
          text: z.string().trim().min(1).optional(),
          icon: z.string().trim().min(1).optional(),
        }),
      )
      .min(1),
  }),
  /** The catalog's counts, as `homeCounts` chooses them, or these kinds. */
  countCards: z.strictObject({
    block: z.literal('countCards'),
    kinds: z.array(z.string().trim().min(1)).optional(),
  }),
  /** Documents by repository, or one folder's: `getting-started`. */
  docs: z.strictObject({
    block: z.literal('docs'),
    title: z.string().trim().min(1).optional(),
    folder: z.string().trim().min(1).optional(),
  }),
  /** Each API, a card to its reference. */
  apis: z.strictObject({
    block: z.literal('apis'),
    title: z.string().trim().min(1).optional(),
  }),
  /** The architecture map. */
  graph: z.strictObject({
    block: z.literal('graph'),
    title: z.string().trim().min(1).optional(),
  }),
  /** What needs review, is quarantined, has no producer, consumer or owner. */
  attention: z.strictObject({ block: z.literal('attention') }),
  /** A card for each page the catalog has: the graph, services, fields, owners. */
  explore: z.strictObject({
    block: z.literal('explore'),
    title: z.string().trim().min(1).optional(),
  }),
  /** Documents by tag. */
  tags: z.strictObject({
    block: z.literal('tags'),
    title: z.string().trim().min(1).optional(),
  }),
} as const;

/**
 * Blocks that show the company's own systems and upkeep, which a site for an
 * `audience` does not publish: naming one there fails the build.
 */
export const INSIDE_ONLY_BLOCKS: readonly HomeBlockName[] = ['countCards', 'graph', 'attention'];

export type HomeBlockName = keyof typeof HOME_BLOCKS;

/** A built-in block, checked against its props; any other is a site's own, checked at build. */
const layoutBlock = z.looseObject({ block: z.string().trim().min(1) }).superRefine((value, ctx) => {
  if (!(value.block in HOME_BLOCKS)) return;

  // SAFETY: the guard above returned for every name HOME_BLOCKS does not hold.
  const parsed = HOME_BLOCKS[value.block as HomeBlockName].safeParse(value);

  for (const issue of parsed.success ? [] : parsed.error.issues) {
    ctx.addIssue({ code: 'custom', message: `${value.block}: ${issue.message}`, path: issue.path });
  }
});

export type LayoutBlock = z.infer<typeof layoutBlock>;

/** The home page with no `layouts.home`: the built-in page is exactly these blocks. */
export const DEFAULT_HOME_LAYOUT: LayoutBlock[] = [
  { block: 'countCards' },
  { block: 'graph' },
  { block: 'docs' },
  { block: 'attention' },
  { block: 'explore' },
  { block: 'tags' },
];

/** The same for a site with an `audience`: guides and ways in, no map of the company. */
export const DEFAULT_PUBLIC_HOME_LAYOUT: LayoutBlock[] = [
  { block: 'docs' },
  { block: 'explore' },
  { block: 'tags' },
];

/** The home layout a site gets when it writes none. */
export const defaultHomeLayout = (config: Pick<SiteConfig, 'audience'>): LayoutBlock[] =>
  config.audience ? DEFAULT_PUBLIC_HOME_LAYOUT : DEFAULT_HOME_LAYOUT;

/** Everything a company sets about its site, in `autocatalog.site.json`. */
export const siteConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  /** Every repository `owner` has with this GitHub topic joins the site. */
  topic: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  /** One sentence for the home page and `llms.txt`. */
  description: z.string().min(1).optional(),
  /** A folder of `logo.*`, `logo-dark.*`, `favicon.svg` and `theme.css`. */
  brand: z.string().min(1).optional(),
  theme: z.enum(SITE_THEMES).optional(),
  navigation: siteNavigationSchema.optional(),
  /**
   * Code that extends the site: a module path, or a package whose
   * `package.json` names one in `autocatalog.site`. Each default-exports a
   * SiteExtension (or an array of them). JSON names it; nothing runs until the build.
   */
  extend: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  /**
   * Who the site is for, such as `public`. Set, the site publishes only the
   * documents that name this audience and the OpenAPI references, without the
   * operations marked `x-internal` or anything else the catalog knows.
   */
  audience: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .optional(),
  chat: siteChatSchema.optional(),
  access: siteAccessSchema.optional(),
  /**
   * The name a site built from one repository publishes its documents under,
   * in place of the folder's name: `"help"` publishes `docs/start.md` at
   * `/help/start/`, and its id is `help/start`.
   */
  repo: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  /**
   * Publish the one repository's documents at the site's root, without its
   * name: `docs/labels/start.md` at `/labels/start/`. Ids keep the name, so
   * `related:` and links between repositories read as before.
   */
  atRoot: z.boolean().optional(),
  /**
   * A folder of the site's own pages and API routes, laid out as `src/pages/`
   * is, relative to this file.
   */
  pages: z.string().min(1).optional(),
  /** `false` leaves out the Markdown copy, view and pin each page offers. */
  pageActions: z.boolean().optional(),
  /**
   * How an OpenAPI reference is laid out. `frame`, the default, keeps the
   * site's header and sidebar and gives Scalar the rest of the page, with its
   * own sidebar, search and request client, in a frame. `full` gives Scalar
   * the whole page below the header; `embedded` sets it inside the site's
   * content column.
   */
  apiReference: z.enum(['frame', 'full', 'embedded']).optional(),
  /**
   * What the sidebar calls the link to each API's reference, under its
   * service. `Scalar` unless a site says otherwise.
   */
  apiReferenceLabel: z.string().trim().min(1).optional(),
  /**
   * The kinds the home page counts, in order, such as `["service", "event",
   * "domain"]`. Six by default: services, events, domains and documents
   * first, then what the catalog holds most of.
   */
  homeCounts: z.array(z.string().trim().min(1)).optional(),
  /**
   * Pages composed from blocks, in order: `home` replaces the home page's
   * sections and keeps its header. A block is a built-in one (`HOME_BLOCKS`)
   * or one an `extend` module adds by name.
   */
  layouts: z.strictObject({ home: z.array(layoutBlock).min(1).optional() }).optional(),
  /**
   * The MCP endpoint at `/mcp` on a site with `"output": "server"`, where Claude
   * and other agents search its pages and read its APIs' operations. On by
   * default with `access` or an `audience`; `true` serves it on any server site,
   * `false` leaves it out.
   */
  mcp: z.boolean().optional(),
  /** `server` renders documents per request, behind the extensions' middleware. */
  output: z.enum(['static', 'server']).optional(),
  /** Where the site is deployed, such as `https://help.example.com`: for the sitemap and llms.txt. `--site` overrides it. */
  url: z.url().optional(),
  /** The site's sections, in the rail beside the sidebar and atop the menu on a phone. `[]` names none. */
  nav: z.array(siteNavLinkSchema).optional(),
  /** Links in the header, as Starlight takes them: `{ icon: 'github', label, href }`. */
  social: z
    .array(
      z.strictObject({
        icon: z.string().min(1),
        label: z.string().min(1),
        href: z.string().min(1),
      }),
    )
    .optional(),
  /** Tags for every page's `<head>`: meta, analytics, verification. */
  head: z
    .array(
      z.strictObject({
        tag: z.enum(['title', 'base', 'link', 'style', 'meta', 'script', 'noscript', 'template']),
        attrs: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
        content: z.string().optional(),
      }),
    )
    .optional(),
  /** The site's own words for its interface, by Starlight's key: `{ "search.label": "Search help" }`. */
  strings: z.record(z.string(), z.string()).optional(),
});

export type SiteConfig = Omit<z.infer<typeof siteConfigSchema>, '$schema' | 'extend'> & {
  extend?: string[];
};

export const SITE_CONFIG = 'autocatalog.site.json';

/** The site's configuration in this folder, with its brand folder made absolute. */
export function readSiteConfig(dir: string): SiteConfig {
  const file = path.join(dir, SITE_CONFIG);

  if (!fs.existsSync(file)) return {};

  const parsed = siteConfigSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));

  if (!parsed.success) throw new Error(`${SITE_CONFIG}: ${z.prettifyError(parsed.error)}`);

  const { $schema: _schema, extend, ...config } = parsed.data;

  return {
    ...config,
    ...(config.brand && { brand: path.resolve(dir, config.brand) }),
    ...(config.pages && { pages: path.resolve(dir, config.pages) }),
    ...(config.access && {
      access: { ...config.access, module: path.resolve(dir, config.access.module) },
    }),
    ...(config.chat && {
      chat: {
        ...config.chat,
        module: path.resolve(dir, config.chat.module),
        ...(config.chat.panel && { panel: path.resolve(dir, config.chat.panel) }),
        // A file is relative to this one, and becomes a file: URL so it reads
        // apart from a site's own URL; a URL or markup stays as written.
        ...(config.chat.icons && {
          icons: Object.fromEntries(
            Object.entries(config.chat.icons).map(([name, icon]) => [
              name,
              /^\.{1,2}\//.test(icon) ? pathToFileURL(path.resolve(dir, icon)).href : icon,
            ]),
          ),
        }),
      },
    }),
    // A path is relative to this file; a package name stays as written.
    ...(extend && {
      extend: [extend]
        .flat()
        .map((entry) => (/^[./]/.test(entry) ? path.resolve(dir, entry) : entry)),
    }),
  };
}
