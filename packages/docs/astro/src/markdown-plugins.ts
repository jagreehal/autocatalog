import { isUnifiedProcessor } from '@astrojs/markdown-remark';
import type { AstroIntegrationLogger } from 'astro';
import { z } from 'zod';
import { mermaidNode, remarkMermaid } from './mermaid';
import { rehypeFocusableTables } from './rehype-tables';
import { opensDocument, remarkRepeatedTitle } from './remark-title';
import { remarkWikiRefs, splitText } from './wiki-refs';

/**
 * The catalog's Markdown transforms, for whichever engine the site renders
 * with, the way Starlight registers its asides: Sätteri, Astro's default, by
 * its visitor plugins, or unified by remark and rehype plugins. Each does the
 * same four things: mermaid fences become diagrams, `[[kind|id]]` becomes a
 * catalog link, an opening `# Title` that repeats the page title goes, and a
 * table takes keyboard focus so it can be scrolled.
 */
export function registerMarkdownPlugins(
  processor: { name: string; options: object } | undefined,
  base: string,
  logger: Pick<AstroIntegrationLogger, 'warn'>,
): void {
  if (processor && isUnifiedProcessor(processor)) {
    processor.options.remarkPlugins.push(remarkMermaid, remarkRepeatedTitle, [
      remarkWikiRefs,
      { base },
    ]);
    processor.options.rehypePlugins.push(rehypeFocusableTables);

    return;
  }

  const satteri = satteriOptions.safeParse(processor?.name === 'satteri' && processor.options);

  if (satteri.success) {
    satteri.data.mdastPlugins.push(satteriMdast(base));
    satteri.data.hastPlugins.push(satteriTables);

    return;
  }

  logger.warn(
    `The Markdown processor "${processor?.name}" runs none of the catalog's transforms: mermaid diagrams, [[kind|id]] links and the rest render as written.`,
  );
}

// Sätteri's plugin lists, which the processor reads when it renders, so a push here lands.
const satteriOptions = z.object({
  mdastPlugins: z.custom<SatteriPlugin[]>(Array.isArray),
  hastPlugins: z.custom<SatteriPlugin[]>(Array.isArray),
});

/** A Sätteri plugin: a visitor object, or a factory that makes one per document. */
type SatteriPlugin = object;

/** The node shapes these visitors read; Sätteri hands each to the visitor its type names. */
interface MdastNode {
  type: string;
  depth?: number;
  lang?: string | null;
  meta?: string | null;
  value?: string;
}

interface MdastContext {
  textContent(node: MdastNode): string;
  parent(node: MdastNode): (MdastNode & { children: MdastNode[] }) | undefined;
  indexOf(node: MdastNode): number | undefined;
  removeNode(node: MdastNode): void;
  replaceNode(node: MdastNode, replacement: MdastNode | MdastNode[]): void;
}

interface FactoryContext {
  sourceFormat: string;
  data: { astro?: { frontmatter?: { title?: string } } };
}

function satteriMdast(base: string) {
  return ({ sourceFormat, data }: FactoryContext) => {
    const title = z.string().safeParse(data.astro?.frontmatter?.title).data?.trim().toLowerCase();

    return {
      name: 'autocatalog-markdown',
      code(node: MdastNode, ctx: MdastContext) {
        const diagram = mermaidNode(node, sourceFormat === 'mdx');

        if (diagram) ctx.replaceNode(node, diagram);
      },
      heading(node: MdastNode, ctx: MdastContext) {
        const parent = ctx.parent(node);

        const opening =
          parent?.type === 'root' && opensDocument(parent.children.slice(0, ctx.indexOf(node)));

        if (opening && node.depth === 1 && ctx.textContent(node).trim().toLowerCase() === title) {
          ctx.removeNode(node);
        }
      },
      text(node: MdastNode, ctx: MdastContext) {
        // Text anywhere inside a link stays as written: a link cannot hold another.
        for (let parent = ctx.parent(node); parent; parent = ctx.parent(parent)) {
          if (parent.type === 'link' || parent.type === 'linkReference') return;
        }

        const parts = splitText({ type: 'text', value: node.value ?? '' }, base);

        if (parts.length > 1 || parts[0]?.type === 'link') ctx.replaceNode(node, parts);
      },
    };
  };
}

/** A hast element, as Sätteri's element visitor hands it over. */
interface HastElement {
  type: 'element';
  tagName: string;
}

const satteriTables = {
  name: 'autocatalog-focusable-tables',
  element: [
    {
      filter: ['table'],
      visit(
        node: HastElement,
        ctx: { setProperty(node: HastElement, key: string, value: number): void },
      ) {
        ctx.setProperty(node, 'tabIndex', 0);
      },
    },
  ],
};
