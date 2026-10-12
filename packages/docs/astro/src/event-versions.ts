import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { compareSemverish, renderVersionChangelog } from 'autocatalog-core';
import type { CatalogEvent } from './catalog';
import { eventPath } from './event-path';
import { versionLabel } from './shell';
import type { EventVersionsProps } from './ui/components/EventVersions';

/**
 * Where one version of an event lives on the site, relative to its base. The
 * current version is the event page itself; each earlier one sits under it at
 * `v/<version>/`, so a link to the event keeps meaning "the contract today".
 */
export function versionPath(entry: CatalogEvent): string {
  const { isVersioned } = entry.event.folder;

  return isVersioned
    ? `${eventPath(entry)}v/${entry.event.frontmatter.version}/`
    : eventPath(entry);
}

/**
 * Every published version of the event `entry` is one of, newest first: the
 * current event and its `versioned/` history from the same repository.
 */
export function eventVersions(
  catalog: { events: CatalogEvent[]; history: CatalogEvent[] },
  entry: CatalogEvent,
): CatalogEvent[] {
  const { domain, id } = entry.event.frontmatter;

  return [...catalog.events, ...catalog.history]
    .filter(
      (other) =>
        other.repository === entry.repository &&
        other.event.frontmatter.domain === domain &&
        other.event.frontmatter.id === id,
    )
    .sort((a, b) => compareSemverish(b.event.frontmatter.version, a.event.frontmatter.version));
}

/**
 * What changed between `entry` and the version before it, as the Markdown `ac
 * changelog` prints. Null for the oldest version, which has nothing to compare
 * against.
 */
export function versionChanges(versions: CatalogEvent[], entry: CatalogEvent): string | null {
  const index = versions.findIndex(({ event }) => event === entry.event);
  const previous = index === -1 ? undefined : versions[index + 1];

  if (!previous) return null;
  const to = entry.event;

  return renderVersionChangelog({
    eventId: `${to.frontmatter.domain}/${to.frontmatter.id}`,
    fromVersion: previous.event.frontmatter.version,
    toVersion: to.frontmatter.version,
    fromSchema: previous.event.schema,
    toSchema: to.schema,
  });
}

/**
 * Every version as the Versions card lists it: newest first, each linked to its
 * own page, with the one being read marked.
 */
export function versionLinks(
  versions: CatalogEvent[],
  active: CatalogEvent,
  base: string,
): EventVersionsProps['versions'] {
  return versions.map((entry) => ({
    href: `${base}${versionPath(entry)}`,
    label: versionLabel(entry.event.frontmatter.version),
    current: !entry.event.folder.isVersioned,
    active: entry.event === active.event,
  }));
}

// A changelog has no code blocks, so no highlighter is loaded for it.
let changelogProcessor: ReturnType<typeof createMarkdownProcessor> | undefined;

/**
 * {@link versionChanges} rendered to HTML, null for the oldest version. It is
 * `ac changelog`'s Markdown, so the site and the CLI cannot describe the same
 * change two ways.
 */
export async function versionChangesHtml(
  versions: CatalogEvent[],
  active: CatalogEvent,
): Promise<string | null> {
  const changes = versionChanges(versions, active);

  if (!changes) return null;

  changelogProcessor ??= createMarkdownProcessor({ syntaxHighlight: false });

  return (await (await changelogProcessor).render(changes)).code;
}
