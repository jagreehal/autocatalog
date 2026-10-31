/**
 * Turn `[[kind|id]]` in Markdown into catalog links. The kind names a page
 * family; the id is what that page already uses in its URL.
 */

/** The kinds a wiki ref may name. */
export const WIKI_KINDS = [
  'service',
  'event',
  'domain',
  'owner',
  'channel',
  'system',
  'doc',
  'flow',
  'design',
] as const;

export type WikiKind = (typeof WIKI_KINDS)[number];

export interface WikiRef {
  kind: WikiKind;
  id: string;
}

const KIND_SET = new Set<string>(WIKI_KINDS);

const isWikiKind = (kind: string): kind is WikiKind => KIND_SET.has(kind);

/** One `[[kind|id]]` match, or null when the text is not a wiki ref. */
export function parseWikiRef(raw: string): WikiRef | null {
  const match = /^\[\[([a-z]+)\|([^\]]+)\]\]$/i.exec(raw.trim());

  if (!match) return null;

  const kind = match[1]!.toLowerCase();
  const id = match[2]!.trim();

  if (!isWikiKind(kind) || !id) return null;

  return { kind, id };
}

/**
 * Where a wiki ref points, relative to the site base (no trailing slash on
 * `base`). Event ids are `repository/domain/id` or `domain/id` (catalog
 * search); everything else is a single path segment or document id.
 */
export function wikiRefHref(ref: WikiRef, base = ''): string {
  const root = base.replace(/\/$/, '');
  const enc = (value: string) => value.split('/').map(encodeURIComponent).join('/');

  switch (ref.kind) {
    case 'service':
      return `${root}/services/${enc(ref.id)}/`;
    case 'domain':
      return `${root}/domains/${enc(ref.id)}/`;
    case 'owner':
      return `${root}/owners/${enc(ref.id)}/`;
    case 'channel':
      return `${root}/channels/${enc(ref.id)}/`;
    case 'system':
      return `${root}/systems/${enc(ref.id)}/`;
    case 'flow':
      return `${root}/flows/${enc(ref.id)}/`;
    case 'design':
      return `${root}/designs/${enc(ref.id)}/`;
    case 'doc':
      return `${root}/${enc(ref.id)}/`;
    case 'event': {
      const parts = ref.id.split('/').filter(Boolean);

      if (parts.length >= 3) {
        const [repository, domain, ...rest] = parts;

        return `${root}/events/${enc(repository!)}/${enc(domain!)}/${enc(rest.join('/'))}/`;
      }

      return `${root}/catalog/?kind=event&q=${encodeURIComponent(ref.id)}`;
    }
  }
}

interface TextNode {
  type: 'text';
  value: string;
}

interface LinkNode {
  type: 'link';
  url: string;
  title: string | null;
  children: TextNode[];
  data?: { hProperties?: Record<string, string> };
}

interface ParentNode {
  type: string;
  children?: Array<TextNode | LinkNode | ParentNode>;
}

const REF = /\[\[[a-z]+\|[^\]]+\]\]/gi;

/**
 * Split a text node on wiki refs and replace each match with a link that
 * carries `data-wiki-ref` for the hover card style.
 */
function splitText(node: TextNode, base: string): Array<TextNode | LinkNode> {
  const out: Array<TextNode | LinkNode> = [];
  let last = 0;

  for (const match of node.value.matchAll(REF)) {
    const raw = match[0]!;
    const index = match.index ?? 0;

    if (index > last) out.push({ type: 'text', value: node.value.slice(last, index) });

    const ref = parseWikiRef(raw);

    if (ref) {
      out.push({
        type: 'link',
        url: wikiRefHref(ref, base),
        title: `${ref.kind}: ${ref.id}`,
        children: [{ type: 'text', value: ref.id }],
        data: {
          hProperties: {
            className: 'ac-wiki-ref',
            'data-wiki-ref': ref.kind,
            'data-wiki-id': ref.id,
          },
        },
      });
    } else {
      out.push({ type: 'text', value: raw });
    }

    last = index + raw.length;
  }

  if (last === 0) return [node];

  if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) });

  return out;
}

function walk(node: ParentNode, base: string): void {
  if (!node.children) return;

  const next: ParentNode['children'] = [];

  for (const child of node.children) {
    if (child.type === 'text') {
      // SAFETY: an mdast node of type `text` is a text node.
      next.push(...splitText(child as TextNode, base));
    } else if (child.type !== 'link' && 'children' in child) {
      // SAFETY: an mdast node with `children` is a parent.
      walk(child as ParentNode, base);
      next.push(child);
    } else {
      next.push(child);
    }
  }

  node.children = next;
}

/** Remark plugin: rewrite `[[kind|id]]` in prose into catalog links. */
export function remarkWikiRefs(options: { base?: string } = {}) {
  const base = options.base ?? '';

  return (tree: ParentNode) => {
    walk(tree, base);
  };
}
