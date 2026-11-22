/** @jsxImportSource react */
import type { IconName } from '../../icons';
import type { AttentionSnapshot } from '../../attention';
import type { DocListItem } from '../components/DocList';
import type { Stat } from '../components/Stats';
import type { VisualiserGraph } from '../lib/visualiser';
import { blockIds, CardGrid, HomeBlock } from './HomeBlock';
import type { CatalogProvenance, HomeBlockData, RecentChange } from './HomeBlock';

/** One way into the catalog this build actually made. */
export interface ExploreCard {
  title: string;
  text: string;
  href: string;
  icon: IconName;
  kind?: string;
}

export interface HomePageProps {
  stats: Array<Stat>;
  explore: Array<ExploreCard>;
  /** Repositories in name order, each with the documents it publishes. */
  repos: Array<{
    name: string;
    label: string;
    description?: string | undefined;
    href?: string | undefined;
    docs: Array<DocListItem>;
  }>;
  /** Tags in name order; empty when no document is tagged. */
  tags: Array<[string, Array<DocListItem>]>;
  /** What changed most recently, newest first; empty when git cannot date anything. */
  recent?: Array<RecentChange> | undefined;
  /** Dark spots: review work, quarantine, orphans. */
  attention?: AttentionSnapshot | undefined;
  /** Where the catalog's facts come from, by source. */
  provenance?: CatalogProvenance | undefined;
  /** Architecture canvas; omitted when the graph has nothing to draw. */
  map?: VisualiserGraph | undefined;
  /** Fullscreen / dedicated catalog map. */
  catalogHref?: string | undefined;
}

/** Enough to see what moves; the rest is a search away. */
export const RECENT_SHOWN = 5;

/**
 * The built-in home page's blocks, in order: `DEFAULT_HOME_LAYOUT` in
 * autocatalog-docs-core names the same, and a test holds the two together.
 */
export const HOME_PAGE_ORDER = ['search', 'provenance', 'browse', 'graph', 'recent'] as const;

/** The built-in home page: its default blocks, filled from the catalog. */
export function homePageBlocks({
  stats,
  recent,
  attention,
  provenance,
  map,
  catalogHref,
}: HomePageProps): Array<HomeBlockData> {
  const data: Record<(typeof HOME_PAGE_ORDER)[number], HomeBlockData> = {
    search: { block: 'search' },
    provenance: { block: 'provenance', provenance, attention },
    browse: { block: 'browse', stats },
    graph: { block: 'graph', map, catalogHref },
    recent: { block: 'recent', items: (recent ?? []).slice(0, RECENT_SHOWN) },
  };

  return HOME_PAGE_ORDER.map((name) => data[name]);
}

export function HomePage(props: HomePageProps) {
  const blocks = homePageBlocks(props);
  const ids = blockIds(blocks);

  return (
    <div className="not-content flex flex-col gap-10" data-wide>
      {blocks.map((block, index) => (
        <HomeBlock key={ids[index]} block={block} id={ids[index]!} />
      ))}
    </div>
  );
}

export { CardGrid };

export default HomePage;
