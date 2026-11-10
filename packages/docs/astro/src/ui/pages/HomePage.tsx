/** @jsxImportSource react */
import type { IconName } from '../../icons';
import type { AttentionSnapshot } from '../../attention';
import type { DocListItem } from '../components/DocList';
import type { Stat } from '../components/Stats';
import type { VisualiserGraph } from '../lib/visualiser';
import { blockIds, CardGrid, HomeBlock, type HomeBlockData } from './HomeBlock';

/** One way into the catalog this build actually made. */
export interface ExploreCard {
  title: string;
  text: string;
  href: string;
  icon: IconName;
  kind?: string;
}

export interface HomePageProps {
  stats: Stat[];
  explore: ExploreCard[];
  /** Repositories in name order, each with the documents it publishes. */
  repos: Array<{
    name: string;
    label: string;
    description?: string | undefined;
    href?: string | undefined;
    docs: DocListItem[];
  }>;
  /** Tags in name order; empty when no document is tagged. */
  tags: Array<[string, DocListItem[]]>;
  /** Dark spots: review work, quarantine, orphans. */
  attention?: AttentionSnapshot | undefined;
  /** Architecture canvas; omitted when the graph has nothing to draw. */
  map?: VisualiserGraph | undefined;
  /** Fullscreen / dedicated catalog map. */
  catalogHref?: string | undefined;
}

/**
 * The built-in home page's blocks, in order: `DEFAULT_HOME_LAYOUT` in
 * autocatalog-docs-core names the same, and a test holds the two together.
 */
export const HOME_PAGE_ORDER = [
  'countCards',
  'graph',
  'docs',
  'attention',
  'explore',
  'tags',
] as const;

/** The built-in home page: its default blocks, filled from the catalog. */
export function homePageBlocks({
  stats,
  explore,
  repos,
  tags,
  attention,
  map,
  catalogHref,
}: HomePageProps): HomeBlockData[] {
  const data: Record<(typeof HOME_PAGE_ORDER)[number], HomeBlockData> = {
    countCards: { block: 'countCards', stats },
    graph: { block: 'graph', map, catalogHref },
    docs: { block: 'docs', repos },
    attention: { block: 'attention', attention },
    explore: { block: 'explore', cards: explore },
    tags: { block: 'tags', tags },
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
