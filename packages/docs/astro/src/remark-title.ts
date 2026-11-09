import { z } from 'zod';

/** An mdast node, reduced to what this plugin reads. */
interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
}

interface MarkdownFile {
  data?: { astro?: { frontmatter?: { title?: unknown } } };
}

const text = (node: MdastNode): string => node.value ?? (node.children ?? []).map(text).join('');

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Drops a document's opening `# Title` when it repeats the page title, which
 * Starlight already shows: a document reads well on GitHub with its heading,
 * and on the site without saying its name twice.
 */
/** Whether a heading after these nodes opens its document: only comments and frontmatter come before it. */
export const opensDocument = (before: Array<{ type: string }>) =>
  before.every(({ type }) => type === 'yaml' || type === 'html');

export function dropRepeatedTitle(tree: MdastNode, title: string | undefined): void {
  const first = tree.children?.findIndex(
    (_, index, all) => !opensDocument(all.slice(0, index + 1)),
  );

  if (title === undefined || first === undefined || first < 0) return;

  const heading = tree.children![first]!;

  if (heading.type === 'heading' && heading.depth === 1 && same(text(heading), title)) {
    tree.children!.splice(first, 1);
  }
}

export function remarkRepeatedTitle() {
  return (tree: MdastNode, file: MarkdownFile) => {
    // Frontmatter is the author's YAML: a title that is not text has no heading to match.
    dropRepeatedTitle(tree, z.string().safeParse(file.data?.astro?.frontmatter?.title).data);
  };
}
