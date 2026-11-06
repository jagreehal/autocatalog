import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { compareSemverish, renderVersionChangelog, type BehindReference } from 'autocatalog-core';
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

/** What changed from one version to another, as the Markdown `ac changelog` prints. */
function changelog(from: CatalogEvent, to: CatalogEvent): string {
  const { domain, id, version } = to.event.frontmatter;

  return renderVersionChangelog({
    eventId: `${domain}/${id}`,
    fromVersion: from.event.frontmatter.version,
    toVersion: version,
    fromSchema: from.event.schema,
    toSchema: to.event.schema,
  });
}

/**
 * What changed between `entry` and the version before it, as the Markdown `ac
 * changelog` prints. Null for the oldest version, which has nothing to compare
 * against.
 */
export function versionChanges(versions: CatalogEvent[], entry: CatalogEvent): string | null {
  const index = versions.findIndex(({ event }) => event === entry.event);
  const previous = index === -1 ? undefined : versions[index + 1];

  return previous ? changelog(previous, entry) : null;
}

/** The services that read exactly this version, while a newer release is out. */
function readersOf(entry: CatalogEvent, behind: BehindReference[]): BehindReference[] {
  const { domain, id, version } = entry.event.frontmatter;

  return behind.filter(
    ({ resource }) =>
      resource.kind === 'event' &&
      resource.namespace === `${entry.repository}/${domain}` &&
      resource.id === id &&
      resource.version === version,
  );
}

interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: object;
  children?: HtmlNode[];
}

/** All a changelog is made of. Anything else came from a schema, and stays as its text. */
const CHANGELOG_TAGS = new Set(['h3', 'ul', 'li', 'p', 'code']);

function keepChangelogTags(node: HtmlNode): void {
  node.children = node.children?.flatMap((child) => {
    keepChangelogTags(child);

    if (child.type !== 'element') return [child];

    child.properties = {};

    return CHANGELOG_TAGS.has(child.tagName ?? '') ? [child] : (child.children ?? []);
  });
}

// A changelog has no code blocks, so no highlighter is loaded for it. Its text
// comes from other repositories' schemas, so raw HTML is dropped.
let changelogProcessor: ReturnType<typeof createMarkdownProcessor> | undefined;

/**
 * Every version as the Versions card lists it: newest first, each linked to its
 * own page and carrying what changed since the one before, with the one being
 * read marked. A version a service still reads names it, with what upgrading
 * to the newest release changes.
 */
export async function versionLinks(
  versions: CatalogEvent[],
  active: CatalogEvent,
  base: string,
  behind: BehindReference[] = [],
): Promise<EventVersionsProps['versions']> {
  changelogProcessor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    remarkRehype: { allowDangerousHtml: false },
    rehypePlugins: [() => keepChangelogTags],
  });

  const processor = await changelogProcessor;

  return Promise.all(
    versions.map(async (entry) => {
      const changes = versionChanges(versions, entry);
      const readers = readersOf(entry, behind);

      const newest = versions.find(
        ({ event }) => event.frontmatter.version === readers[0]?.current,
      );

      return {
        href: `${base}${versionPath(entry)}`,
        label: versionLabel(entry.event.frontmatter.version),
        current: !entry.event.folder.isVersioned,
        active: entry.event === active.event,
        changesHtml: changes ? (await processor.render(changes)).code : null,
        readBy: [...new Set(readers.map(({ service }) => service))].sort(),
        upgradeHtml: newest ? (await processor.render(changelog(entry, newest))).code : null,
      };
    }),
  );
}
