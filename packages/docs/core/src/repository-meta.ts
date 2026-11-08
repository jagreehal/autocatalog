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
  /**
   * What a reader needs to open every document here that names no `access`
   * of its own, on a site with `access`. A folder's own `access` wins.
   */
  access: z.array(z.string().min(1)).optional(),
  /** Who every document here that names no `audience` of its own is for. A folder's own wins. */
  audience: z.array(z.string().min(1)).optional(),
  /**
   * The folders of `docs/`, in reading order, nested ones by their path such as
   * `labels/faqs`. A folder left out still appears, last.
   */
  sidebar: z
    .array(
      z.strictObject({
        directory: z.string().min(1),
        label: z.string().min(1),
        collapsed: z.boolean().optional(),
        /** What a reader needs to open the documents in this folder that name none. */
        access: z.array(z.string().min(1)).optional(),
        /** Who the documents in this folder that name none are for. */
        audience: z.array(z.string().min(1)).optional(),
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

/** Whether a sidebar entry is a folder under `docs/`, such as `labels` or `labels/faqs`. */
function isDocsFolder(dir: string, directory: string): boolean {
  const segments = directory.split('/');

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }

  // Each segment by its exact name: on a disk that ignores case, "Payments"
  // would stat as the folder `payments`, while documents are matched by name.
  let at = path.join(dir, 'docs');

  for (const segment of segments) {
    const found = fs
      .readdirSync(at, { withFileTypes: true })
      .some((entry) => entry.name === segment && entry.isDirectory());

    if (!found) return false;

    at = path.join(at, segment);
  }

  return true;
}

/**
 * A repository's `docs/meta.json`, or why it cannot be used. No file says
 * nothing, which is fine. A `sidebar` entry that is not a folder directly
 * under `docs/` makes it unusable: the owner and access it gives that folder
 * would otherwise reach no document.
 */
export function readRepositoryMeta(dir: string): RepositoryMetaRead {
  const file = path.join(dir, REPOSITORY_META);

  if (!fs.existsSync(file)) return { meta: {} };

  try {
    const parsed = repositoryMetaSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));

    if (!parsed.success) return { meta: {}, problem: z.prettifyError(parsed.error) };

    const strays = (parsed.data.sidebar ?? []).filter(
      ({ directory }) => !isDocsFolder(dir, directory),
    );

    return strays.length > 0
      ? {
          meta: {},
          problem: strays
            .map(
              ({ directory }) => `sidebar names "${directory}", which is not a folder under docs/`,
            )
            .join('\n'),
        }
      : { meta: parsed.data };
  } catch (error) {
    return { meta: {}, problem: error instanceof Error ? error.message : String(error) };
  }
}
