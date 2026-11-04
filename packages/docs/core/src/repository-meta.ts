import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * How a repository describes its own documents, in `docs/meta.json`. A team
 * names itself and orders its pages here, so nobody edits the site to join it.
 */
export const repositoryMetaSchema = z.strictObject({
  $schema: z.string().optional(),
  /** What readers call this repository, in the navigation and on the home page. */
  label: z.string().min(1).optional(),
  /** One line for the home page. */
  description: z.string().min(1).optional(),
  /** Owns every document here that names no owner of its own. */
  owner: z.string().min(1).optional(),
  /** The folders of `docs/`, in reading order. A folder left out still appears, last. */
  sidebar: z
    .array(
      z.strictObject({
        directory: z.string().min(1),
        label: z.string().min(1),
        collapsed: z.boolean().optional(),
      }),
    )
    .optional(),
});

export type RepositoryMeta = z.infer<typeof repositoryMetaSchema>;

export const REPOSITORY_META = 'docs/meta.json';

export interface RepositoryMetaRead {
  meta: RepositoryMeta;
  /** Why the file could not be used. */
  problem?: string;
}

/** A repository's `docs/meta.json`, or why it cannot be used. No file says nothing, which is fine. */
export function readRepositoryMeta(dir: string): RepositoryMetaRead {
  const file = path.join(dir, REPOSITORY_META);

  if (!fs.existsSync(file)) return { meta: {} };

  try {
    const parsed = repositoryMetaSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));

    return parsed.success
      ? { meta: parsed.data }
      : { meta: {}, problem: z.prettifyError(parsed.error) };
  } catch (error) {
    return { meta: {}, problem: error instanceof Error ? error.message : String(error) };
  }
}
