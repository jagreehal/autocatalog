import { describe, expect, it } from 'vitest';
import { schemaPointer, sourceLines } from '../src/source-lines';

describe('schemaPointer', () => {
  it('follows fields, array elements and unknown properties', () => {
    expect(schemaPointer('items[].sku')).toEqual([
      'properties',
      'items',
      'items',
      'properties',
      'sku',
    ]);
    expect(schemaPointer('meta.*')).toEqual(['properties', 'meta', 'additionalProperties']);
    expect(schemaPointer('(root)')).toEqual([]);
  });

  it('stops at a segment it does not model, so the line falls on the parent', () => {
    expect(schemaPointer('payment|anyOf[0].amount')).toEqual(['properties', 'payment']);
  });
});

describe('sourceLines', () => {
  const json = [
    '{',
    '  "type": "object",',
    '  "properties": {',
    '    "orderId": { "type": "string" },',
    '    "total": { "$ref": "#/$defs/money" }',
    '  },',
    '  "$defs": {',
    '    "money": {',
    '      "type": "object",',
    '      "properties": { "amount": { "type": "number" } }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  it('finds the line of a JSON node, following local refs', () => {
    const lineOf = sourceLines(json);
    expect(lineOf(['properties', 'orderId'])).toBe(4);
    expect(lineOf(['properties', 'total', 'properties', 'amount'])).toBe(10);
  });

  it('falls back to the deepest node it reached when the node is gone', () => {
    expect(sourceLines(json)(['properties', 'removed'])).toBe(3);
  });

  it('reads YAML, including quoted and numeric keys', () => {
    const yaml = [
      'paths:',
      '  /orders:',
      '    get:',
      '      responses:',
      "        '200':",
      '          description: ok',
      '        404:',
      '          description: missing',
    ].join('\n');

    const lineOf = sourceLines(yaml);
    expect(lineOf(['paths', '/orders', 'get', 'responses', '200'])).toBe(5);
    expect(lineOf(['paths', '/orders', 'get', 'responses', '404'])).toBe(7);
  });

  it('gives no line for text it cannot parse', () => {
    expect(sourceLines('{ "a": ')(['a'])).toBeUndefined();
  });
});
