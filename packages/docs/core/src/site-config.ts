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
 * A link in the header, beside the site's title. `match` is the paths it stands
 * for, so a section stays current on its pages: `/guides/` lights up on
 * `/guides/setup/`. It defaults to `href`.
 */
export const siteNavLinkSchema = z.strictObject({
  label: z.string().min(1),
  href: z.string().min(1),
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
  /** `server` renders documents per request, behind the extensions' middleware. */
  output: z.enum(['static', 'server']).optional(),
  /** Where the site is deployed, such as `https://help.example.com`: for the sitemap and llms.txt. `--site` overrides it. */
  url: z.url().optional(),
  /** Sections in the header, beside the title, and atop the menu on a phone. */
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
