import type { FieldSummary } from 'autocatalog-core';
import type { PropNode } from './ui/lib/schema-tree';

/** Who else carries this field, and who would feel a change. */
export interface FieldLineage {
  /** Other events (or this one) that declare the same path. */
  carriers: number;
  consumers: string[];
  producers: string[];
  conflict?: string | undefined;
}

/** Attach lineage from the field index onto each property by dotted path. */
export function withFieldLineage(
  nodes: PropNode[],
  fields: Map<string, FieldSummary>,
  describeConflict?: (field: FieldSummary) => string | undefined,
): PropNode[] {
  return nodes.map((node) => attach(node, fields, describeConflict));
}

function attach(
  node: PropNode,
  fields: Map<string, FieldSummary>,
  describeConflict?: (field: FieldSummary) => string | undefined,
): PropNode {
  const field = node.path ? fields.get(node.path) : undefined;

  return {
    ...node,
    lineage: field
      ? {
          carriers: field.occurrences.length,
          consumers: field.consumers,
          producers: field.producers,
          conflict: describeConflict?.(field),
        }
      : undefined,
    children: node.children
      ? node.children.map((child) => attach(child, fields, describeConflict))
      : null,
  };
}

/** Index fields for one event's schema paths. */
export function fieldsByPath(fields: FieldSummary[]): Map<string, FieldSummary> {
  return new Map(fields.map((field) => [field.path, field]));
}
