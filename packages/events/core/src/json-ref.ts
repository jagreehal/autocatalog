/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { isJsonObject, type JsonObject, type JsonValue } from './json';

const localRef = z.object({ $ref: z.string().startsWith('#/') });

/**
 * Resolve local `$ref` pointers (`#/components/...`) within a document.
 *
 * Only local pointers: a spec that reaches out to another file or a URL is not
 * something a passive scan should follow. Cycles throw rather than hang.
 */
export function derefLocal<T = any>(doc: any, node: any, seen = new Set<string>()): T {
  const parsed = localRef.safeParse(node);

  if (parsed.success) {
    const ref = parsed.data.$ref;

    if (seen.has(ref)) throw new Error(`circular $ref: ${ref}`);
    seen.add(ref);

    const target = ref
      .slice(2)
      .split('/')
      .reduce((acc: any, seg) => acc?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')], doc);

    if (target === undefined) throw new Error(`unresolvable $ref: ${ref}`);

    return derefLocal(doc, target, seen);
  }

  return node;
}

const refValue = z.string();

/** Every `$ref` string in a schema, mapped through `to`; everything else as it was. */
export function rewriteRefs(node: JsonValue, to: (ref: string) => string): JsonValue {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, to));

  return isJsonObject(node) ? rewriteObjectRefs(node, to) : node;
}

/** {@link rewriteRefs} for an object, which stays one. */
export function rewriteObjectRefs(node: JsonObject, to: (ref: string) => string): JsonObject {
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      const ref = key === '$ref' ? refValue.safeParse(value) : undefined;

      return [key, ref?.success ? to(ref.data) : rewriteRefs(value, to)];
    }),
  );
}
