// One person edits a design, and git is how others see it, so there are no live
// rooms here. These are the types the canvas still names.
import type { Editing, Moving } from '@eventcatalog/visualiser/studio';

export type { Editing, Moving };

export type Peer = {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  moving?: Moving[] | null;
  editing?: Editing | null;
  at: number;
};

export type CursorSource = {
  current: () => ReadonlyMap<string, Peer>;
  subscribe: (listener: (peers: ReadonlyMap<string, Peer>) => void) => () => void;
};
