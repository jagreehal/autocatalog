import './jitless';
import '@eventcatalog/visualiser/styles.css';
import './map.css';
import { layoutGraph, NodeGraph } from '@eventcatalog/visualiser';
import { App, applyDocumentTheme, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type CSSProperties, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogMap } from '../src/map';

const app = new App({ name: 'autocatalog-map', version: '1.0.0' });

let show: (map: CatalogMap) => void = () => {};

let latest: CatalogMap | undefined;

let host: McpUiHostContext = {};

let hostChanged: (context: McpUiHostContext) => void = () => {};

// The host's theme, size and display mode, as it says them now.
const adopt = (changed: McpUiHostContext) => {
  host = { ...host, ...changed };

  if (host.theme) applyDocumentTheme(host.theme);
  hostChanged(host);
};

app.onhostcontextchanged = adopt;

// Only show_map opens this view; a result without its nodes draws nothing.
const isMap = (
  content: NonNullable<CallToolResult['structuredContent']>,
): content is CatalogMap & typeof content => Array.isArray(content.nodes);

app.ontoolresult = ({ structuredContent }) => {
  if (!structuredContent || !isMap(structuredContent)) return;

  latest = structuredContent;
  show(latest);
};

/** Busier is thicker, bounded so one hot edge cannot swamp the map. */
const weight = (state: string, count: number) =>
  state === 'unseen' ? 1.25 : Math.min(6, 1.5 + Math.log10(Math.max(count, 1)) * 2.2);

type Laid = Awaited<ReturnType<typeof layoutGraph>>;

/**
 * A level 1 domain or system as the card the visualiser draws one as, which
 * edges connect to; its layout node is a container, which they do not.
 */
function asGroupCard(node: Laid['nodes'][number], source: CatalogMap['nodes'][number] | undefined) {
  const group = source?.metadata.group;

  if (group !== 'domain' && group !== 'system') return node;

  const card = { id: node.id, name: source!.label, summary: source!.metadata.summary };

  return group === 'domain'
    ? { ...node, type: 'context-domain', data: { domain: card, mode: 'full', navigable: false } }
    : { ...node, type: 'system', data: { system: card, mode: 'full', navigable: false } };
}

/** A design's proposed parts drawn in outline, and level 1's groups as cards. */
const mark = (laid: Laid, proposed: string[] = [], source?: Pick<CatalogMap, 'nodes'>): Laid => {
  const sources = new Map(source?.nodes.map((node) => [node.id, node]));

  return {
    ...laid,
    nodes: laid.nodes.map((node) => {
      const card = asGroupCard(node, sources.get(node.id));

      return proposed.includes(node.id) ? { ...card, className: 'ac-node-proposed' } : card;
    }),
  };
};

function MapView() {
  const [map, setMap] = useState(latest);

  const [laid, setLaid] = useState<Laid>();

  const [levels, setLevels] = useState<{ 1?: Laid; 2?: Laid }>({});

  const [context, setContext] = useState(host);

  useEffect(() => {
    show = setMap;
    hostChanged = setContext;
  }, []);

  useEffect(() => {
    if (!map) return;

    let current = true;

    // The visualiser reads its grouping style from the address alone.
    if (map.lanes) {
      try {
        const url = new URL(window.location.href);

        url.searchParams.set('group', map.lanes.by);
        url.searchParams.set('groupStyle', map.lanes.style);
        window.history.replaceState(null, '', url);
      } catch {
        // A frame without an address of its own groups as boxes.
      }
    }

    void Promise.all(
      ([1, 2] as const).map(async (level) => {
        const graph = map.levels?.[level];

        return [
          level,
          graph && mark(await layoutGraph(graph.nodes, graph.edges), map.proposed, graph),
        ] as const;
      }),
    ).then((entries) => {
      if (current) setLevels(Object.fromEntries(entries.filter(([, laid]) => laid)));
    });

    void layoutGraph(map.nodes, map.edges).then(({ nodes, edges }) => {
      if (!current) return;

      setLaid(
        mark(
          {
            nodes: nodes.map((node) =>
              map.steps?.[node.id]
                ? { ...node, data: { ...node.data, ...map.steps[node.id] } }
                : node,
            ),
            edges: edges.map((edge) => {
              const seen = map.evidence?.[edge.id];

              return seen
                ? {
                    ...edge,
                    className: `ac-edge-${seen.state}`,
                    // SAFETY: a custom property, which CSSProperties has no key for.
                    style: {
                      ...edge.style,
                      '--ac-edge-weight': weight(seen.state, seen.count),
                    } as CSSProperties,
                  }
                : edge;
            }),
          },
          map.proposed,
          map,
        ),
      );
    });

    return () => {
      current = false;
    };
  }, [map]);

  const labels = new Map(
    [
      ...(map?.nodes ?? []),
      ...(map?.levels?.[1]?.nodes ?? []),
      ...(map?.levels?.[2]?.nodes ?? []),
    ].map((node) => [node.id, node.label]),
  );

  const fullscreen = context.displayMode === 'fullscreen';

  const dimensions = context.containerDimensions;

  // Inline, the map fits the room the host gives it and never scrolls inside itself.
  const height = fullscreen
    ? '100vh'
    : dimensions && 'height' in dimensions
      ? `${dimensions.height}px`
      : `${Math.min(560, dimensions?.maxHeight ?? 560)}px`;

  const insets = context.safeAreaInsets;

  // The reader asks for fullscreen; the map never switches by itself.
  const canExpand = context.availableDisplayModes?.includes('fullscreen') ?? false;

  // The visualiser draws into this box, which is there before it mounts.
  return (
    <div
      className="ac-map"
      id="autocatalog-map-portal"
      style={{
        height,
        ...(insets && {
          padding: `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px`,
        }),
      }}
    >
      {canExpand && (
        <button
          type="button"
          className="ac-expand"
          onClick={() =>
            void app
              .requestDisplayMode({ mode: fullscreen ? 'inline' : 'fullscreen' })
              .then(({ mode }) => adopt({ displayMode: mode }))
          }
        >
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      )}
      {(!map || !laid) && <div className="ac-empty">Drawing the catalog…</div>}
      {map && laid && (
        <NodeGraph
          id="autocatalog-map"
          title={map.title}
          nodes={laid.nodes}
          edges={laid.edges}
          includeKey
          showSearch={map.nodes.length > 6}
          mode="full"
          showFlowWalkthrough={map.edges.some((edge) => edge.type === 'flow-step')}
          disableMessageAnimation
          {...(map.lanes && { swimlanes: map.lanes.by })}
          {...(levels[1] && { overviewGraph: { ...levels[1], label: 'domains and systems' } })}
          {...(levels[2] && { hiddenMessagesGraph: levels[2] })}
          // A click tells the model what the reader picked, so "this one" in their next
          // message means it; nothing is posted to the conversation. A host without
          // model context leaves the click as a selection on the map.
          onNodeClick={(node) =>
            void app
              .updateModelContext({
                content: [
                  {
                    type: 'text',
                    text: `On the map "${map.title}", the reader selected ${labels.get(node.id) ?? node.id}.`,
                  },
                ],
                structuredContent: { selected: node.id },
              })
              .catch(() => undefined)
          }
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<MapView />);

void app.connect().then(() => adopt(app.getHostContext() ?? {}));
