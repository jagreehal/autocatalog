import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { parseFrontmatter as splitFrontmatter } from 'autocatalog-core';
import {
  AUTOCATALOG_ENTITY_FILE,
  DIR_BY_KIND,
  ENTITY_KINDS,
  SCHEMA_BY_KIND,
  type Agent,
  type Domain,
  type Entity,
  type EntityKind,
  type Eval,
  type Model,
  type Policy,
  type Tool,
  type Workflow,
} from './schemas.js';

/** The catalog root is absent or is not a directory. */
export class CatalogNotFoundError extends Error {
  readonly code = 'catalog_not_found';
  constructor(readonly root: string) {
    super(`catalog directory does not exist: ${root}`);
    this.name = 'CatalogNotFoundError';
  }
}

export type LoadIssue = {
  kind: 'schema' | 'parse' | 'io';
  path: string;
  message: string;
};

export type EntityMeta = {
  body: string;
  path: string;
  /** Files referenced by frontmatter (e.g. prompts.system or eval cases) that don't exist on disk. */
  missingFiles?: string[];
};

export type Catalog = {
  root: string;
  entities: Map<EntityKind, Map<string, Entity>>;
  meta: Map<string, EntityMeta>;
  issues: LoadIssue[];
};

export type EntityByKind = {
  agent: Agent;
  tool: Tool;
  model: Model;
  workflow: Workflow;
  domain: Domain;
  eval: Eval;
  policy: Policy;
};

const isOfKind =
  <K extends EntityKind>(kind: K) =>
  (entity: Entity): entity is EntityByKind[K] =>
    entity.kind === kind;

/** Every entity of one kind, typed as that kind. */
export const entitiesOf = <K extends EntityKind>(cat: Catalog, kind: K): EntityByKind[K][] =>
  [...(cat.entities.get(kind)?.values() ?? [])].filter(isOfKind(kind));

/** One entity by kind and id, typed as that kind. */
export const entityOf = <K extends EntityKind>(
  cat: Catalog,
  kind: K,
  id: string,
): EntityByKind[K] | undefined => {
  const entity = cat.entities.get(kind)?.get(id);

  return entity && isOfKind(kind)(entity) ? entity : undefined;
};

export const refKey = (kind: EntityKind, id: string): string => `${kind}/${id}`;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
};

const listDirs = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
};

const listFiles = async (dir: string, ext: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
};

const parseFrontmatter = async (filePath: string) => {
  const raw = await readFile(filePath, 'utf8');

  return splitFrontmatter(raw);
};

// Raw entity fields: an object whose values the per-kind schema checks once
// `id` and `kind` defaults are merged in.
const RawFields = z.record(z.string(), z.unknown());

const parseYaml = async (filePath: string) => {
  const raw = await readFile(filePath, 'utf8');
  const parsed = RawFields.safeParse(yaml.load(raw));

  if (!parsed.success) throw new Error('YAML file did not parse to an object');

  return parsed.data;
};

const parseJson = async (filePath: string) => {
  const raw = await readFile(filePath, 'utf8');
  const parsed = RawFields.safeParse(JSON.parse(raw));

  if (!parsed.success) throw new Error('JSON file did not parse to an object');

  return parsed.data;
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const parseManifestWithOptionalBody = async (dir: string) => {
  const manifestPath = join(dir, AUTOCATALOG_ENTITY_FILE);

  if (await exists(manifestPath)) {
    const data = await parseJson(manifestPath);
    const mdxPath = join(dir, 'index.mdx');
    let content = '';

    if (await exists(mdxPath)) {
      const parsed = await parseFrontmatter(mdxPath);
      content = parsed.content;
    }

    return { data, content, sourcePath: manifestPath };
  }

  const mdxPath = join(dir, 'index.mdx');

  if (!(await exists(mdxPath))) {
    throw new Error(`expected ${AUTOCATALOG_ENTITY_FILE} or index.mdx not found`);
  }

  const parsed = await parseFrontmatter(mdxPath);

  return { data: parsed.data, content: parsed.content, sourcePath: mdxPath };
};

const loadKind = async (
  root: string,
  kind: EntityKind,
  issues: LoadIssue[],
  meta: Map<string, EntityMeta>,
): Promise<Map<string, Entity>> => {
  const out = new Map<string, Entity>();
  const dir = join(root, DIR_BY_KIND[kind]);

  if (!(await exists(dir))) return out;

  const schema = SCHEMA_BY_KIND[kind];

  if (kind === 'model') {
    const files = await listFiles(dir, '.yaml');

    for (const file of files) {
      const filePath = join(dir, file);

      try {
        const data = await parseYaml(filePath);
        const withKind = { ...data, kind: 'model' };
        const result = schema.safeParse(withKind);

        if (!result.success) {
          for (const err of result.error.issues) {
            issues.push({
              kind: 'schema',
              path: filePath,
              message: `${err.path.join('.')}: ${err.message}`,
            });
          }

          continue;
        }

        out.set(result.data.id, result.data);
        meta.set(refKey(kind, result.data.id), { body: '', path: filePath });
      } catch (e) {
        issues.push({ kind: 'parse', path: filePath, message: errorMessage(e) });
      }
    }

    const subdirs = await listDirs(dir);

    for (const sub of subdirs) {
      const entityDir = join(dir, sub);
      const manifestPath = join(entityDir, AUTOCATALOG_ENTITY_FILE);

      if (!(await exists(manifestPath))) continue;

      try {
        const data = await parseJson(manifestPath);
        const withKind = { id: sub, kind: 'model', ...data };
        const result = schema.safeParse(withKind);

        if (!result.success) {
          for (const err of result.error.issues) {
            issues.push({
              kind: 'schema',
              path: manifestPath,
              message: `${err.path.join('.')}: ${err.message}`,
            });
          }

          continue;
        }

        const mdxPath = join(entityDir, 'index.mdx');
        let body = '';

        if (await exists(mdxPath)) {
          body = (await parseFrontmatter(mdxPath)).content;
        }

        out.set(result.data.id, result.data);
        meta.set(refKey(kind, result.data.id), { body, path: manifestPath });
      } catch (e) {
        issues.push({ kind: 'parse', path: manifestPath, message: errorMessage(e) });
      }
    }

    return out;
  }

  const subdirs = await listDirs(dir);

  for (const sub of subdirs) {
    const entityDir = join(dir, sub);

    try {
      const { data, content, sourcePath } = await parseManifestWithOptionalBody(entityDir);
      const withDefaults = { id: sub, kind, ...data };
      const result = schema.safeParse(withDefaults);

      if (!result.success) {
        for (const err of result.error.issues) {
          issues.push({
            kind: 'schema',
            path: sourcePath,
            message: `${err.path.join('.')}: ${err.message}`,
          });
        }

        continue;
      }

      const missingFiles: string[] = [];

      const entity = result.data;

      if (entity.kind === 'agent') {
        const promptRef = entity.prompts?.system;

        if (promptRef) {
          const resolved = isAbsolute(promptRef) ? promptRef : resolve(entityDir, promptRef);

          if (!(await exists(resolved))) missingFiles.push(resolved);
        }
      }

      if (entity.kind === 'eval') {
        const casesRef = entity.cases;

        if (casesRef) {
          const resolved = isAbsolute(casesRef) ? casesRef : resolve(entityDir, casesRef);

          if (!(await exists(resolved))) missingFiles.push(resolved);
        }
      }

      const entry: EntityMeta = { body: content, path: sourcePath };

      if (missingFiles.length > 0) entry.missingFiles = missingFiles;

      out.set(entity.id, entity);
      meta.set(refKey(kind, entity.id), entry);
    } catch (e) {
      issues.push({ kind: 'parse', path: entityDir, message: errorMessage(e) });
    }
  }

  return out;
};

export const loadCatalog = async (root: string): Promise<Catalog> => {
  const issues: LoadIssue[] = [];
  const meta = new Map<string, EntityMeta>();
  const entities = new Map<EntityKind, Map<string, Entity>>();

  // A directory that is not there loads as an empty catalog, and an empty
  // catalog passes every check by having nothing to fail. This throws rather
  // than recording an issue because a command is free to ignore issues — and
  // `audit` did, reporting "no findings" over a path that did not exist.
  // Load issues describe files inside a catalog; a missing catalog is a caller
  // error, and the difference has to be unmissable.
  const present = await stat(root).then(
    (entry) => entry.isDirectory(),
    () => false,
  );

  if (!present) throw new CatalogNotFoundError(root);

  for (const kind of ENTITY_KINDS) {
    entities.set(kind, await loadKind(root, kind, issues, meta));
  }

  return { root, entities, meta, issues };
};
