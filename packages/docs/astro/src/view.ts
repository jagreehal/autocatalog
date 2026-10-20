import type { DocsManifest } from 'autocatalog-docs-core';
import { resourceKey, type ResourceRef } from 'autocatalog-core';
import { day, docHref, type DocListItem } from './ui/lib/docs';

export { day, docHref, type DocListItem };

/** The shape a content-collection entry has to satisfy to be listed. */
export interface DocEntry {
  id: string;
  data: { title: string; owner: string; tags?: string[]; related?: string[] };
}

/**
 * Project collection entries into what the templates render.
 *
 * Kept as a plain function over plain data so the same call serves the index,
 * the llms.txt route and the tests, and so none of them import `astro:content`
 * to be exercised.
 */
export function listItems(entries: DocEntry[], manifest: DocsManifest): DocListItem[] {
  return entries
    .map((entry) => {
      const record = manifest[entry.id];

      return {
        id: entry.id,
        repo: entry.id.split('/')[0] ?? '',
        title: entry.data.title,
        owner: entry.data.owner,
        updated: record?.updated ?? null,
        tags: entry.data.tags ?? [],
        ...(record?.kind && { kind: record.kind }),
        ...(record?.status && { status: record.status }),
        ...(record?.date && { date: record.date }),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Repositories in name order, each with the documents it publishes. */
export function groupByRepo(items: DocListItem[]): Array<[string, DocListItem[]]> {
  return group(items, (item) => [item.repo]);
}

/** Tags in name order. Documents without tags simply do not appear. */
export function groupByTag(items: DocListItem[]): Array<[string, DocListItem[]]> {
  return group(items, (item) => item.tags);
}

function group(
  items: DocListItem[],
  keysOf: (item: DocListItem) => string[],
): Array<[string, DocListItem[]]> {
  const grouped = new Map<string, DocListItem[]>();

  for (const item of items) {
    for (const key of keysOf(item)) {
      const bucket = grouped.get(key);

      if (bucket) bucket.push(item);
      else grouped.set(key, [item]);
    }
  }

  return [...grouped].sort(([a], [b]) => a.localeCompare(b));
}

/** Stable in-page identity for any resource in the composed Catalog. */
export function catalogAnchor(ref: ResourceRef): string {
  return `resource-${encodeURIComponent(resourceKey(ref))}`;
}

/** Link from any shell surface into the composed Catalog inventory. */
export function catalogHref(ref: ResourceRef): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/catalog#${catalogAnchor(ref)}`;
}

/** A cross-repository edge, resolved to a readable title where one is known. */
export interface DocLink {
  id: string;
  title: string;
  repo: string;
  /** False when the target is not in this checkout, so the link cannot render. */
  resolved: boolean;
}

export function toLinks(ids: string[], manifest: DocsManifest): DocLink[] {
  return ids.map((id) => ({
    id,
    // An unpublished target still shows: hiding it would make a broken edge
    // look like no edge, and `ac docs check` is what fails the build for it.
    title: manifest[id]?.title ?? id,
    repo: id.split('/')[0] ?? '',
    resolved: id in manifest,
  }));
}
