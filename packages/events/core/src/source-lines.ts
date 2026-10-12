import { isMap, isScalar, isSeq, LineCounter, parseDocument, type ParsedNode } from 'yaml';
import { z } from 'zod';

/**
 * The JSON-pointer steps from a schema's root to the node a diff path names:
 * `items[].sku` is `properties/items/items/properties/sku`. A segment the
 * mapping does not model (a union branch, a keyword) ends it there, so a
 * finding lands on the field that holds the change rather than nowhere.
 */
export function schemaPointer(diffPath: string): string[] {
  const steps: string[] = [];

  for (const segment of diffPath.replace(/^\(root\)/, '').split('.')) {
    if (!segment) continue;
    const [, name = '', rest = ''] = /^([^[|]*)(.*)$/.exec(segment) ?? [];

    if (name === '*') steps.push('additionalProperties');
    else if (name) steps.push('properties', name);

    const arrays = /^(?:\[\])*/.exec(rest)?.[0] ?? '';

    for (let i = 0; i < arrays.length / 2; i++) steps.push('items');

    if (rest.length > arrays.length) break;
  }

  return steps;
}

/** A node the walk reached, and the offset of the key or item that names it. */
interface Found {
  node: ParsedNode | null;
  at: number;
}

/** A `$ref` into the same document; one to another file stops the walk at the ref. */
const localRef = z
  .string()
  .startsWith('#')
  .transform((ref) =>
    ref
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')),
  );

/** One step down: a mapping key or a sequence index, with where it is written. */
function child(node: ParsedNode | null, step: string): Found | undefined {
  if (isMap(node)) {
    const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === step);

    return pair && { node: pair.value, at: pair.key.range[0] };
  }

  const item = isSeq(node) ? node.items[Number(step)] : undefined;

  return item && { node: item, at: item.range[0] };
}

/**
 * Line lookups for one JSON or YAML document. JSON is YAML, so one parser
 * serves both and keeps the source offsets a plain `JSON.parse` throws away.
 * Each lookup follows `steps` as far as they go — through local `$ref`s — and
 * answers with the line of the deepest node it reached, so a field that was
 * removed lands on the object that held it.
 */
export function sourceLines(text: string): (steps: string[]) => number | undefined {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: false });
  const root = doc.contents;

  if (doc.errors.length > 0 || !root) return () => undefined;

  const walk = (steps: string[], depth: number): Found => {
    let found: Found = { node: root, at: root.range[0] };

    for (const step of steps) {
      const ref = child(found.node, '$ref')?.node;
      const pointer = localRef.safeParse(isScalar(ref) ? ref.value : undefined);

      // Depth-limited, so a ref cycle ends instead of recursing forever.
      if (pointer.success && depth < 32) {
        found = { node: walk(pointer.data, depth + 1).node, at: found.at };
      }

      const next = child(found.node, step);

      if (!next) break;
      found = next;
    }

    return found;
  };

  return (steps) => lineCounter.linePos(walk(steps, 0).at).line;
}
