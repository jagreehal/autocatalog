import type { RehypePlugin } from '@astrojs/markdown-remark';

type PropertyValue = string | number | boolean | null | undefined | Array<string | number>;

/** A hast node, reduced to what this plugin reads and writes. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: { [name: string]: PropertyValue };
  children?: HastNode[];
}

/**
 * A table wider than the column scrolls sideways, as Starlight lays it out, so
 * each table takes keyboard focus: a reader without a mouse can scroll it too.
 */
export const rehypeFocusableTables: RehypePlugin = () => (tree) => {
  focusTables(tree);
};

/** Each table under `node` takes keyboard focus. */
export function focusTables(node: HastNode): void {
  if (node.type === 'element' && node.tagName === 'table') {
    node.properties = { ...node.properties, tabIndex: 0 };
  }

  for (const child of node.children ?? []) focusTables(child);
}
