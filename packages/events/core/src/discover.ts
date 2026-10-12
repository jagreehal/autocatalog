import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTOCATALOG_EVENT_FILE } from './schema';

export interface DiscoveredEventFolder {
  path: string; // absolute path to the folder containing event metadata
  defaultDomain: string; // first directory segment under events/
  isVersioned: boolean; // true if inside a versioned/ subtree
  parentEventPath: string | null; // for versioned, points at the current-version folder
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);

    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (!entry.isDirectory()) continue;

    if (
      (await fileExists(path.join(full, AUTOCATALOG_EVENT_FILE))) ||
      (await fileExists(path.join(full, 'index.mdx')))
    ) {
      results.push(full);
    }

    await walk(full, results);
  }
}

export async function discoverEventFolders(eventsRoot: string): Promise<DiscoveredEventFolder[]> {
  const absRoot = path.resolve(eventsRoot);
  const folders: string[] = [];

  try {
    await walk(absRoot, folders);
  } catch (err) {
    // Missing or unreadable events directory — return empty list and let the
    // caller (validateCatalog) translate this into a structured error if needed.
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return [];
    }

    throw err;
  }

  return folders.map((folder) => {
    const rel = path.relative(absRoot, folder);
    const segments = rel.split(path.sep);
    const defaultDomain = segments[0] ?? '';

    const versionedIdx = segments.indexOf('versioned');
    const isVersioned = versionedIdx !== -1 && versionedIdx < segments.length - 1;

    const parentEventPath = isVersioned
      ? path.join(absRoot, ...segments.slice(0, versionedIdx))
      : null;

    return { path: folder, defaultDomain, isVersioned, parentEventPath };
  });
}
