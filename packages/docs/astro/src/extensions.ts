import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StarlightPlugin, StarlightUserConfig } from '@astrojs/starlight/types';
import type { unified } from '@astrojs/markdown-remark';
import type { AstroIntegration } from 'astro';
import { z } from 'zod';

const paths = z.union([z.string().min(1), z.array(z.string().min(1))]);

/** A unified plugin, or `[plugin, options]`, as the site's Markdown processor takes it. */
type UnifiedPluginEntry = NonNullable<
  NonNullable<Parameters<typeof unified>[0]>['rehypePlugins']
>[number];

type HeadEntry = NonNullable<StarlightUserConfig['head']>[number];

/**
 * What a site adds to the one `ac site` builds, without forking it. A module
 * named by `extend` in `autocatalog.site.json` default-exports one of these, or
 * an array of them, so extensions compose by importing each other.
 *
 * Paths starting with `.` are relative to the module that declares them.
 */
const siteExtensionSchema = z.strictObject({
  name: z.string().optional(),
  /** Astro middleware modules: sign-in, redirects, rewriting the response. */
  middleware: paths.optional(),
  /** Starlight route middleware modules: change the sidebar, pagination or entry per request. */
  routeMiddleware: paths.optional(),
  /** Starlight component overrides, by component name. A later extension wins. */
  components: z.record(z.string(), z.string().min(1)).optional(),
  /** Blocks a layout in autocatalog.site.json can name: an Astro component by block name. */
  blocks: z.record(z.string(), z.string().min(1)).optional(),
  customCss: z.array(z.string().min(1)).optional(),
  head: z.array(z.custom<HeadEntry>()).optional(),
  /** For every Markdown and MDX document: `plugin` or `[plugin, options]`. */
  remarkPlugins: z.array(z.custom<UnifiedPluginEntry>()).optional(),
  rehypePlugins: z.array(z.custom<UnifiedPluginEntry>()).optional(),
  /** Anything else Starlight or Astro can do. */
  plugins: z.array(z.custom<StarlightPlugin>()).optional(),
  integrations: z.array(z.custom<AstroIntegration>()).optional(),
});

export type SiteExtension = z.input<typeof siteExtensionSchema>;

const moduleSchema = z.object({
  default: z.union([siteExtensionSchema, z.array(siteExtensionSchema)]),
});

/** Every extension folded into the fields the site's config takes. */
export interface SiteExtensions {
  middleware: Array<string>;
  routeMiddleware: Array<string>;
  components: Record<string, string>;
  blocks: Record<string, string>;
  customCss: Array<string>;
  head: Array<HeadEntry>;
  remarkPlugins: Array<UnifiedPluginEntry>;
  rehypePlugins: Array<UnifiedPluginEntry>;
  plugins: Array<StarlightPlugin>;
  integrations: Array<AstroIntegration>;
}

const local = (dir: string) => (file: string) =>
  file.startsWith('.') ? path.resolve(dir, file) : file;

const list = (value: string | Array<string> | undefined) =>
  value === undefined ? [] : [value].flat();

/** Merge extensions in order. `dir` is where each one's relative paths start. */
export function mergeSiteExtensions(
  extensions: Array<{ dir: string; extension: SiteExtension }>,
): SiteExtensions {
  const merged: SiteExtensions = {
    middleware: [],
    routeMiddleware: [],
    components: {},
    blocks: {},
    customCss: [],
    head: [],
    remarkPlugins: [],
    rehypePlugins: [],
    plugins: [],
    integrations: [],
  };

  for (const { dir, extension: ext } of extensions) {
    const at = local(dir);

    merged.middleware.push(...list(ext.middleware).map(at));
    merged.routeMiddleware.push(...list(ext.routeMiddleware).map(at));
    merged.customCss.push(...(ext.customCss ?? []).map(at));

    for (const [name, file] of Object.entries(ext.components ?? {})) {
      merged.components[name] = at(file);
    }

    // A layout names a block by name, so two extensions offering one name is
    // a choice nobody made: say which two, and take neither.
    for (const [name, file] of Object.entries(ext.blocks ?? {})) {
      const taken = merged.blocks[name];

      if (taken !== undefined) {
        throw new Error(
          `extend: two extensions add a block named '${name}': ${taken} and ${at(file)}. Rename one.`,
        );
      }

      merged.blocks[name] = at(file);
    }

    merged.head.push(...(ext.head ?? []));
    merged.remarkPlugins.push(...(ext.remarkPlugins ?? []));
    merged.rehypePlugins.push(...(ext.rehypePlugins ?? []));
    merged.plugins.push(...(ext.plugins ?? []));
    merged.integrations.push(...(ext.integrations ?? []));
  }

  return merged;
}

/** Import each extension module (absolute paths) and merge what they export. */
export async function loadSiteExtensions(files: Array<string>): Promise<SiteExtensions> {
  const loaded: Array<{ dir: string; extension: SiteExtension }> = [];

  for (const file of files) {
    const parsed = moduleSchema.safeParse(
      // The site's own module, named at build time; nothing for Vite to bundle.
      await import(/* @vite-ignore */ pathToFileURL(file).href),
    );

    if (!parsed.success) {
      throw new Error(
        `extend: ${file} must default-export a site extension or an array of them\n${z.prettifyError(parsed.error)}`,
      );
    }

    for (const extension of [parsed.data.default].flat()) {
      loaded.push({ dir: path.dirname(file), extension });
    }
  }

  const merged = mergeSiteExtensions(loaded);

  // A site's own modules, such as a panel for the assistant, import what the site has.
  const project = process.env.AUTOCATALOG_SITE_PROJECT;

  merged.integrations.unshift(resolveFromSite(project), siteDependencies(project));

  // Astro middleware has no config field; an integration adds it. After
  // autocatalog's own, so it reads the `locals.reader` that `access` set.
  if (merged.middleware.length > 0) {
    merged.integrations.unshift({
      name: 'autocatalog-site-middleware',
      hooks: {
        'astro:config:setup': ({ addMiddleware }) => {
          for (const entrypoint of merged.middleware) {
            addMiddleware({ entrypoint, order: 'post' });
          }
        },
      },
    });
  }

  return merged;
}

// Resolving from this file finds every package autocatalog-docs-astro depends on.
const SITE_IMPORTER = import.meta.filename;

const REACT = /^react(-dom)?(\/|$)/;

/**
 * What the site's own project installs stays outside the server bundle, loaded
 * from its node_modules when the server runs, as in any Astro project: some
 * packages, such as OpenTelemetry's, do not survive being bundled.
 */
export function siteDependencies(project: string | undefined): AstroIntegration {
  const { external, noExternal } = siteBundling(project);

  return {
    name: 'autocatalog-site-dependencies',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ vite: { resolve: { external, noExternal } } });
      },
    },
  };
}

/** Packages the server loads from the site's node_modules, and those it bundles. */
export interface SiteBundling {
  external: Array<string>;
  noExternal: Array<string>;
}

/** autocatalog's own packages are part of the site it builds, and React is the one it brings: see resolveFromSite. */
const own = (names: Array<string>) =>
  names.filter((name) => !name.startsWith('autocatalog') && !REACT.test(name));

/**
 * Which of the site project's dependencies the server loads from its
 * node_modules (`external`), and which it bundles (`noExternal`): anything that
 * renders with React, so it renders with the one React the pages do.
 */
export function siteBundling(project: string | undefined): SiteBundling {
  if (project === undefined) {
    return { external: [], noExternal: [] };
  }

  const { dependencies, optionalDependencies } = manifestAt(project);
  const running = own(Object.keys({ ...dependencies, ...optionalDependencies }));
  const noExternal = running.filter((name) => usesReact(project, name));

  return { external: running.filter((name) => !noExternal.includes(name)), noExternal };
}

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});

/** A package.json, or nothing when there is none. */
function manifestAt(dir: string): z.infer<typeof manifestSchema> {
  const file = path.join(dir, 'package.json');

  return fs.existsSync(file) ? manifestSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : {};
}

/** Whether a package names another, in any of its dependency lists. */
function declares(dir: string, name: string): boolean {
  const manifest = manifestAt(dir);

  return [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
  ].some((names) => names !== undefined && Object.hasOwn(names, name));
}

/** Whether a dependency renders with React. */
function usesReact(project: string, name: string): boolean {
  const peers = manifestAt(path.join(project, 'node_modules', name)).peerDependencies ?? {};

  return 'react' in peers;
}

const packageName = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

/** Where autocatalog's own code is, as `ac site` lists it: this package and what it installs. */
const ownFolders = () =>
  new Set((process.env.AUTOCATALOG_RESOLVE_FROM ?? '').split(path.delimiter).filter(Boolean));

/** A module's folder and those around it, to the top of the package it was installed as. */
function packageFolders(module: string): Array<string> {
  const folders: Array<string> = [];

  for (
    let dir = path.dirname(module);
    path.basename(dir) !== 'node_modules' && path.dirname(dir) !== dir;
    dir = path.dirname(dir)
  ) {
    folders.push(dir);
  }

  return folders;
}

/**
 * Names a package a site's code imports and the server loads when it runs: the
 * one beside that code, where autocatalog may load another version by the plain
 * name. `site-resolve` in autocatalog-cli looks it up from the folder it gives.
 */
const FROM_SITE = 'autocatalog-site:';

/**
 * An import of a package by the site's own code, or by an extension it installs,
 * marked with the folder whose package.json names it; nothing for autocatalog's.
 */
export function siteImport(
  source: string,
  importer: string,
  { project, folders = ownFolders() }: { project: string; folders?: ReadonlySet<string> },
): string | undefined {
  const name = packageName(source);
  const module = importer.replace(/\?.*$/s, '');

  // Node answers its own names, whatever the project installs under them.
  if (isBuiltin(source) || own([name]).length === 0 || !fs.existsSync(module)) {
    return undefined;
  }

  const around = packageFolders(fs.realpathSync(module));
  const owner = around.find((dir) => declares(dir, name));

  if (owner === undefined || around.some((dir) => folders.has(dir))) {
    return undefined;
  }

  const beside = path.relative(fs.realpathSync(project), owner).split(path.sep).join('/');

  return `${FROM_SITE}${source}?from=${encodeURIComponent(beside)}`;
}

/**
 * A site's own files import what the site is built with (`astro:*` aside):
 * `@astrojs/starlight/components/...`, React, the catalog. The site's project
 * does not install those, so a bare import its own node_modules cannot answer is
 * resolved from here instead. What the project installs itself still wins.
 */
function resolveFromSite(project: string | undefined): AstroIntegration {
  const mark = (source: string, importer: string) =>
    project === undefined ? undefined : siteImport(source, importer, { project });

  return {
    name: 'autocatalog-site-resolve',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'autocatalog-site-resolve',
                enforce: 'pre',
                async resolveId(source, importer, options) {
                  if (!importer || /^[./\0]|:/.test(source)) {
                    return null;
                  }

                  // One React for every page, whatever imports it: two cannot share hooks.
                  if (REACT.test(source)) {
                    return this.resolve(source, SITE_IMPORTER, { ...options, skipSelf: true });
                  }

                  const found = await this.resolve(source, importer, {
                    ...options,
                    skipSelf: true,
                  });

                  const external = (found?.external ?? false) !== false;
                  const marked = external ? mark(source, importer) : undefined;

                  if (marked !== undefined) {
                    return { id: marked, external: true };
                  }

                  return (
                    found ?? this.resolve(source, SITE_IMPORTER, { ...options, skipSelf: true })
                  );
                },
              },
            ],
          },
        });
      },
    },
  };
}
