import { describe, expect, it } from 'vitest';
import { generateExampleFromSchema } from '../src/example-gen';
import type { JsonObject } from '../src/json';

describe('generateExampleFromSchema', () => {
  it('follows a local reference', () => {
    const schema = {
      type: 'object',
      properties: {
        first: { type: 'object', properties: { id: { type: 'string' } } },
        second: { $ref: '#/properties/first' },
      },
    };

    expect(generateExampleFromSchema(schema)).toEqual({
      first: { id: 'string' },
      second: { id: 'string' },
    });
  });

  it('samples the first branch of a nullable or a union', () => {
    const nothing: JsonObject = { type: 'null' };
    const empty: JsonObject = { type: 'object', properties: {} };

    const schema = {
      type: 'object',
      properties: {
        nullable: { anyOf: [empty, nothing] },
        union: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
      },
    };

    expect(generateExampleFromSchema(schema)).toEqual({ nullable: {}, union: 0 });
  });

  it('keeps an object whose anyOf only adds constraints', () => {
    const contact: JsonObject = {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' }, phone: { type: 'string' } },
      anyOf: [{ required: ['email'] }, { required: ['phone'] }],
    };

    expect(generateExampleFromSchema(contact)).toEqual({
      email: 'user@example.com',
      phone: 'string',
    });
  });

  it('reaches a field nested deeper than a recursion guard would', () => {
    let schema: JsonObject = { type: 'string' };

    for (let level = 0; level < 10; level++) {
      schema = { type: 'object', properties: { next: schema } };
    }

    expect(JSON.stringify(generateExampleFromSchema(schema))).toContain('"string"');
  });

  it('stops at a reference that leads back to itself', () => {
    const schema = {
      type: 'object',
      properties: { child: { $ref: '#' }, name: { type: 'string' } },
    };

    expect(
      generateExampleFromSchema({ $ref: '#/definitions/node', definitions: { node: schema } }),
    ).toBeDefined();
    expect(generateExampleFromSchema(schema)).toMatchObject({ name: 'string' });
  });

  it('gives null for a reference it cannot read', () => {
    expect(generateExampleFromSchema({ $ref: 'https://example.com/other.json' })).toBeNull();
    expect(generateExampleFromSchema({ $ref: '#/nowhere' })).toBeNull();
  });

  it('survives a long chain of linked definitions', () => {
    const definitions = Object.fromEntries(
      Array.from({ length: 20_000 }, (_unused, level) => [
        `d${level}`,
        { type: 'object', properties: { next: { $ref: `#/definitions/d${level + 1}` } } },
      ]),
    );

    expect(() =>
      generateExampleFromSchema({ $ref: '#/definitions/d0', definitions }),
    ).not.toThrow();
  });

  it('survives a long chain of references to references', () => {
    const definitions: JsonObject = Object.fromEntries(
      Array.from({ length: 20_000 }, (_unused, level) => [
        `d${level}`,
        { $ref: `#/definitions/d${level + 1}` },
      ]),
    );

    expect(generateExampleFromSchema({ $ref: '#/definitions/d0', definitions })).toBeNull();
  });

  it('stays small on references that fan out exponentially', () => {
    const definitions = Object.fromEntries(
      Array.from({ length: 40 }, (_unused, level) => [
        `d${level}`,
        {
          type: 'object',
          properties: {
            left: { $ref: `#/definitions/d${level + 1}` },
            right: { $ref: `#/definitions/d${level + 1}` },
          },
        },
      ]),
    );

    const started = performance.now();

    generateExampleFromSchema({ $ref: '#/definitions/d0', definitions });

    expect(performance.now() - started).toBeLessThan(2000);
  });
});
