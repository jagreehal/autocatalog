import fs from 'node:fs';
import path from 'node:path';
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

/** As a site writes it. */
export type SiteNavigationInput = z.input<typeof siteNavigationSchema>;

/** As it reads once parsed, each item an object. */
export type SiteNavigation = z.infer<typeof siteNavigationSchema>;

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
});

export type SiteConfig = Omit<z.infer<typeof siteConfigSchema>, '$schema'>;

export const SITE_CONFIG = 'autocatalog.site.json';

/** The site's configuration in this folder, with its brand folder made absolute. */
export function readSiteConfig(dir: string): SiteConfig {
  const file = path.join(dir, SITE_CONFIG);

  if (!fs.existsSync(file)) return {};

  const parsed = siteConfigSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));

  if (!parsed.success) throw new Error(`${SITE_CONFIG}: ${z.prettifyError(parsed.error)}`);

  const { $schema: _schema, ...config } = parsed.data;

  return config.brand ? { ...config, brand: path.resolve(dir, config.brand) } : config;
}
