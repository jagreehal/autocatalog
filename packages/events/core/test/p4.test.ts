import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generateExampleFromSchema } from '../src/example-gen';
import { provenanceSummary } from '../src/enrich-event';
import { ownerForPath, parseCodeowners } from '../src/codeowners';
import { scoreEvent } from '../src/health';
import type { LoadedEvent } from '../src/load';
import { eventFrontmatter } from '../src/schema';

type FrontmatterInput = z.input<typeof eventFrontmatter>;

describe('generateExampleFromSchema', () => {
  it('builds a full-shape object with format-aware strings', () => {
    const example = generateExampleFromSchema({
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        at: { type: 'string', format: 'date-time' },
        count: { type: 'integer', minimum: 3 },
        tags: { type: 'array', items: { type: 'string' } },
        kind: { type: 'string', enum: ['a', 'b'] },
        nested: { type: 'object', properties: { on: { type: 'boolean' } } },
      },
    });

    expect(example).toMatchObject({
      id: '00000000-0000-4000-8000-000000000000',
      at: '2026-01-01T12:00:00Z',
      count: 3,
      tags: ['string'],
      kind: 'a',
      nested: { on: false },
    });
  });

  it('is deterministic', () => {
    const schema = { type: 'object', properties: { n: { type: 'number' } } };
    expect(generateExampleFromSchema(schema)).toEqual(generateExampleFromSchema(schema));
  });

  it('ignores the safe-integer range Zod writes onto every int', () => {
    const int = {
      type: 'integer',
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    };

    expect(generateExampleFromSchema(int)).toBe(0);
    expect(generateExampleFromSchema({ ...int, minimum: 1 })).toBe(1);
  });

  it('terminates on deeply recursive schemas', () => {
    const deep: any = { type: 'object', properties: {} };
    let cursor = deep;

    for (let i = 0; i < 20; i++) {
      cursor.properties.child = { type: 'object', properties: {} };
      cursor = cursor.properties.child;
    }

    expect(() => generateExampleFromSchema(deep)).not.toThrow();
  });
});

describe('codeowners', () => {
  const rules = parseCodeowners(`
# comment
* @acme/default
src/payments/ @acme/billing @acme/payments
src/**/legacy-*.ts @acme/archaeology
`);

  it('parses rules skipping comments and blanks', () => {
    expect(rules).toHaveLength(3);
  });

  it('matches directory rules against nested files', () => {
    expect(ownerForPath(rules, 'src/payments/payment-events.ts')).toBe('acme/billing');
  });

  it('later rules win', () => {
    expect(ownerForPath(rules, 'src/payments/legacy-fees.ts')).toBe('acme/archaeology');
  });

  it('falls back to the catch-all', () => {
    expect(ownerForPath(rules, 'README.md')).toBe('acme/default');
  });
});

describe('scoreEvent', () => {
  function loaded(over: Partial<FrontmatterInput>, examples = 1): LoadedEvent {
    const frontmatter = eventFrontmatter.parse({
      id: 'a.b',
      version: '1.0.0',
      name: 'A',
      summary: 'A perfectly reasonable event summary.',
      owner: { team: 'x' },
      producers: ['P'],
      consumers: ['C'],
      ...over,
    });

    return {
      folder: { path: '/x', defaultDomain: 'a', isVersioned: false, parentEventPath: null },
      frontmatter: { ...frontmatter, domain: frontmatter.domain ?? 'a' },
      body: '',
      schemaPath: '/x/schema.json',
      schema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' }, correlationId: { type: 'string' } },
      },
      // Each example shows an edge case, so a complete event covers them.
      examples: Array.from({ length: examples }, (_, i) => ({
        name: `e${i}`,
        path: `/x/empty/e${i}.json`,
        data: {},
        case: 'empty' as const,
      })),
    };
  }

  it('gives a complete event full marks', () => {
    expect(scoreEvent(loaded({})).score).toBe(100);
  });

  it('penalises missing owner, consumers, and examples with hints', () => {
    const s = scoreEvent(loaded({ owner: undefined, consumers: [] }, 0));
    expect(s.score).toBe(100 - 10 - 15 - 10 - 10);
    const failed = s.checks.filter((c) => !c.earned).map((c) => c.name);
    expect(failed).toEqual(['examples', 'owner', 'consumers', 'example-cases']);
  });

  it('penalises needsReview and non-semver versions', () => {
    const s = scoreEvent(loaded({ needsReview: true, version: '1.0' }));
    expect(s.checks.find((c) => c.name === 'reviewed')?.earned).toBe(false);
    expect(s.checks.find((c) => c.name === 'semver')?.earned).toBe(false);
  });

  it('accepts v-prefixed semver and EventCatalog integer versions', () => {
    for (const version of ['v1.0.0', 'V2.1.0-beta.1', 'V1', 'v10', '3']) {
      const s = scoreEvent(loaded({ version }));
      expect(s.checks.find((c) => c.name === 'semver')?.earned, version).toBe(true);
    }
  });
});

describe('provenanceSummary', () => {
  const fm = (overrides: Partial<FrontmatterInput>) =>
    eventFrontmatter.parse({
      id: 'payment.completed',
      version: '1.0.0',
      name: 'Payment completed',
      summary: 'Paid.',
      ...overrides,
    });

  it('names the file, line and symbol, then how we know', () => {
    const summary = provenanceSummary(
      fm({
        source: { file: 'src/payments.ts', line: 4, symbol: 'PaymentCompleted' },
        provenance: { default: 'extracted', fields: {} },
        confidence: 0.95,
        needsReview: true,
      }),
    );

    expect(summary).toEqual({
      location: 'src/payments.ts:4',
      symbol: 'PaymentCompleted',
      facts: ['extracted', 'confidence 95%', 'needs review'],
    });
  });

  it('drops a symbol that only repeats the file name', () => {
    const summary = provenanceSummary(
      fm({
        source: {
          file: 'contracts/events/payment.completed.json',
          symbol: 'payment.completed.json',
        },
      }),
    );

    expect(summary.symbol).toBeNull();
  });

  it('falls back to the repository, and to nothing', () => {
    expect(provenanceSummary(fm({ source: { repo: 'acme/payments' } })).location).toBe(
      'acme/payments',
    );
    expect(provenanceSummary(fm({})).location).toBeNull();
  });
});
