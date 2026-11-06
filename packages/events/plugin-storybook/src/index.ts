import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isJsonObject,
  jsonValueSchema,
  writeComponents,
  type CatalogComponent,
  type JsonValue,
} from 'autocatalog-core';
import kleur from 'kleur';
import { z } from 'zod';

// What a Storybook build writes. The component manifest is a preview format, so
// only this package reads it, and a build without one falls back to index.json.
// Each docgen engine keeps props in a record under a key of its own, and with
// features.experimentalDocgenServer a component's docgen and stories each sit in
// a file of their own behind a `$ref`, the stories as a record, and the props
// can be the renderer's argTypes.

const storybookIndex = z.object({
  entries: z.record(
    z.string(),
    z.object({
      type: z.string(),
      id: z.string(),
      name: z.string(),
      title: z.string(),
      importPath: z.string().optional(),
    }),
  ),
});

const docgen = z
  .object({
    description: z.string().optional(),
    props: z
      .record(
        z.string(),
        z.object({
          required: z.boolean().optional(),
          description: z.string().optional(),
          tsType: z.object({ name: z.string(), raw: z.string().optional() }).optional(),
          // A name, or an object holding one, by engine.
          type: z
            .union([z.string(), z.object({ name: z.string() }).transform(({ name }) => name)])
            .optional(),
        }),
      )
      .optional(),
  })
  .optional();

/** A prop as the renderer converted it. */
const argType = z.object({
  description: z.string().optional(),
  type: z.object({ name: z.string().optional(), required: z.boolean().optional() }).optional(),
  table: z.object({ type: z.object({ summary: z.string() }).optional() }).optional(),
});

const manifestStory = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  snippet: z.string().optional(),
});

const storybookManifest = z.object({
  components: z.record(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string().optional(),
      description: z.string().optional(),
      import: z.string().optional(),
      reactDocgen: docgen,
      reactDocgenTypescript: docgen,
      reactComponentMeta: docgen,
      argTypes: z.record(z.string(), argType).optional(),
      stories: z
        .union([
          z.array(manifestStory),
          z.record(z.string(), manifestStory).transform((stories) => Object.values(stories)),
        ])
        .default([]),
    }),
  ),
});

/** Said only when there is something to say, so the committed file stays small. */
const filled = (text: string | undefined) => (text?.trim() ? text : undefined);

/** Storybook writes paths from its working directory, as `./src/Banner.stories.tsx`. */
const sourceOf = (file: string | undefined) => file?.replace(/^\.\//, '');

const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

const storyLink = (id: string) => `?path=/story/${id}`;

type ManifestComponent = z.infer<typeof storybookManifest>['components'][string];

/** The props of whichever engine ran, else the renderer's. */
function propsOf(
  doc: z.infer<typeof docgen>,
  argTypes: ManifestComponent['argTypes'],
): CatalogComponent['props'] {
  if (doc?.props)
    return Object.entries(doc.props).map(([name, facts]) => ({
      name,
      required: facts.required ?? false,
      ...defined({
        type: facts.tsType?.raw ?? facts.tsType?.name ?? facts.type,
        description: filled(facts.description),
      }),
    }));

  return Object.entries(argTypes ?? {}).map(([name, facts]) => ({
    name,
    required: facts.type?.required ?? false,
    ...defined({
      type: facts.table?.type?.summary ?? facts.type?.name,
      description: filled(facts.description),
    }),
  }));
}

function fromManifest(manifest: z.infer<typeof storybookManifest>): CatalogComponent[] {
  return Object.values(manifest.components).map((entry) => {
    const doc = entry.reactDocgen ?? entry.reactDocgenTypescript ?? entry.reactComponentMeta;

    return {
      id: entry.id,
      name: entry.name,
      ...defined({
        description: filled(entry.description) ?? filled(doc?.description),
        import: filled(entry.import),
        source: sourceOf(entry.path),
      }),
      props: propsOf(doc, entry.argTypes),
      stories: entry.stories.map(({ id, name, description, snippet }) => ({
        id,
        name,
        link: storyLink(id),
        ...defined({ description: filled(description), snippet: filled(snippet) }),
      })),
    };
  });
}

function fromIndex(index: z.infer<typeof storybookIndex>): CatalogComponent[] {
  const byTitle = new Map<string, CatalogComponent>();

  for (const { type, id, name, title, importPath } of Object.values(index.entries)) {
    if (type !== 'story') continue;

    const entry = byTitle.get(title) ?? {
      id: id.split('--')[0] ?? id,
      name: title.split('/').at(-1) ?? title,
      ...defined({ source: sourceOf(importPath) }),
      props: [],
      stories: [],
    };

    entry.stories.push({ id, name, link: storyLink(id) });
    byTitle.set(title, entry);
  }

  return [...byTitle.values()];
}

/** A Storybook build's components: the manifest's when it wrote one, else its index's stories. */
export function storybookComponents(build: {
  index: JsonValue;
  manifest?: JsonValue | undefined;
}): CatalogComponent[] {
  return build.manifest === undefined
    ? fromIndex(storybookIndex.parse(build.index))
    : fromManifest(storybookManifest.parse(build.manifest));
}

const readJson = async (file: string): Promise<JsonValue> =>
  JSON.parse(await fs.readFile(file, 'utf8'));

/** A build that wrote no manifest is still read, from its index. */
const readOptionalJson = (file: string): Promise<JsonValue | undefined> =>
  readJson(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;

    throw error;
  });

const reference = z.object({ $ref: z.string() });

const looseManifest = z.looseObject({
  components: z.record(
    z.string(),
    z.looseObject({
      docgen: jsonValueSchema.optional(),
      stories: jsonValueSchema.optional(),
    }),
  ),
});

/** What a `$ref` in the manifest points at. It stays inside the build. */
async function followReference(build: string, ref: string): Promise<JsonValue> {
  const [file = '', pointer = ''] = ref.split('#');
  const target = path.resolve(build, 'manifests', file);

  if (!target.startsWith(`${path.resolve(build)}${path.sep}`))
    throw new Error(`${ref}: outside the build`);

  const document = await readJson(target).catch((error: Error) => {
    throw new Error(`${ref}: ${error.message}`, { cause: error });
  });

  const found = pointer
    .split('/')
    .slice(1)
    .reduce<JsonValue | undefined>(
      (value, key) =>
        isJsonObject(value) ? value[key.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined,
      document,
    );

  if (found === undefined) throw new Error(`${ref}: nothing there`);

  return found;
}

/** A build's manifest with each component's `$ref` replaced by what it points at. */
async function readManifest(build: string): Promise<JsonValue | undefined> {
  const manifest = await readOptionalJson(path.join(build, 'manifests/components.json'));

  if (manifest === undefined) return undefined;

  const { components } = looseManifest.parse(manifest);

  const entries = await Promise.all(
    Object.entries(components).map(async ([key, entry]) => {
      const docgenRef = reference.safeParse(entry.docgen);
      const storiesRef = reference.safeParse(entry.stories);
      const docgenTarget = docgenRef.success && (await followReference(build, docgenRef.data.$ref));

      const storiesTarget =
        storiesRef.success && (await followReference(build, storiesRef.data.$ref));

      // Each target is the whole component, of which docgen or stories are one part.
      return [
        key,
        {
          ...entry,
          ...(isJsonObject(docgenTarget) && docgenTarget),
          ...(isJsonObject(storiesTarget) && storiesTarget),
        },
      ];
    }),
  );

  return jsonValueSchema.parse({ components: Object.fromEntries(entries) });
}

/** `ac from-storybook`: write a build's components into the repository, or check them. */
export async function runFromStorybook(opts: {
  build: string;
  root: string;
  url?: string | undefined;
  owner?: string | undefined;
  check?: boolean | undefined;
}): Promise<number> {
  try {
    const manifest = await readManifest(opts.build);

    if (manifest === undefined)
      console.warn(
        kleur.yellow(
          'No component manifest, so no props or descriptions: set features.componentsManifest in .storybook/main.ts',
        ),
      );

    const components = storybookComponents({
      index: await readJson(path.join(opts.build, 'index.json')),
      manifest,
    });

    if (manifest !== undefined && components.every(({ props }) => props.length === 0))
      console.warn(
        kleur.yellow(
          'This build has no props to publish: its docgen wrote none, as features.experimentalDocgenServer can leave it',
        ),
      );

    const result = await writeComponents(
      path.resolve(opts.root),
      {
        components,
        viewer: { name: 'Storybook', ...(opts.url && { url: opts.url }) },
        owner: opts.owner,
      },
      { check: opts.check },
    );

    if (result === 'stale') {
      console.error(kleur.red('autocatalog.components.json does not match this build'));

      return 1;
    }

    if (result === 'written') console.log(`wrote ${components.length} components`);

    return 0;
  } catch (error) {
    console.error(kleur.red(error instanceof Error ? error.message : String(error)));

    return 1;
  }
}
