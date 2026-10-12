import { describe, expect, it } from 'vitest';
import { eventFrontmatter } from '../src/schema';

describe('eventFrontmatter', () => {
  it('accepts a minimal valid frontmatter and applies defaults', () => {
    const parsed = eventFrontmatter.parse({
      id: 'payment.completed',
      version: '1.0.0',
      name: 'Payment Completed',
      summary: 'Fires when a payment completes',
    });

    expect(parsed.spec).toBe('autocatalog/v2');
    expect(parsed.status).toBe('active');
    expect(parsed.producers).toEqual([]);
    expect(parsed.consumers).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.badges).toEqual([]);
    expect(parsed.schema).toBe('./schema.json');
    expect(parsed.examples).toEqual([]);
  });

  it('rejects frontmatter missing required fields', () => {
    expect(() => eventFrontmatter.parse({ id: 'x', version: '1' })).toThrow(/name/);
  });

  it('accepts owner with team and url contact', () => {
    const parsed = eventFrontmatter.parse({
      id: 'a.b',
      version: '1',
      name: 'A B',
      summary: 's',
      owner: { team: 'Payments', contact: 'https://example.com/payments' },
    });

    expect(parsed.owner?.team).toBe('Payments');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      eventFrontmatter.parse({
        id: 'a',
        version: '1',
        name: 'a',
        summary: 's',
        status: 'wat',
      }),
    ).toThrow();
  });

  it('accepts a known classification and rejects any other', () => {
    const base = { id: 'a', version: '1', name: 'a', summary: 's' };

    expect(eventFrontmatter.parse(base).classification).toBeUndefined();
    expect(eventFrontmatter.parse({ ...base, classification: 'public' }).classification).toBe(
      'public',
    );
    expect(() => eventFrontmatter.parse({ ...base, classification: 'secret' })).toThrow();
  });

  it('accepts badges with content/colors', () => {
    const parsed = eventFrontmatter.parse({
      id: 'a',
      version: '1',
      name: 'a',
      summary: 's',
      badges: [{ content: 'Webhook', backgroundColor: '#eee', textColor: '#111' }],
    });

    expect(parsed.badges[0]?.content).toBe('Webhook');
  });

  it('defaults provenance to declared and needsReview to false', () => {
    const parsed = eventFrontmatter.parse({
      id: 'a.b',
      version: '1',
      name: 'A',
      summary: 's',
    });

    expect(parsed.provenance).toEqual({ default: 'declared', fields: {} });
    expect(parsed.needsReview).toBe(false);
    expect(parsed.confidence).toBeUndefined();
  });

  it('accepts extracted provenance with per-field overrides and source location', () => {
    const parsed = eventFrontmatter.parse({
      id: 'a.b',
      version: '1',
      name: 'A',
      summary: 's',
      provenance: { default: 'extracted', fields: { owner: 'inferred' } },
      confidence: 0.6,
      needsReview: true,
      source: { type: 'code', file: 'src/events/a.ts', symbol: 'ABEvent', line: 12 },
    });

    expect(parsed.provenance.fields.owner).toBe('inferred');
    expect(parsed.source?.file).toBe('src/events/a.ts');
    expect(parsed.source?.line).toBe(12);
  });

  it('rejects a confidence outside [0,1]', () => {
    expect(() =>
      eventFrontmatter.parse({ id: 'a', version: '1', name: 'A', summary: 's', confidence: 1.2 }),
    ).toThrow();
  });

  it('rejects an unknown spec version', () => {
    expect(() =>
      eventFrontmatter.parse({
        spec: 'autocatalog/v99',
        id: 'a',
        version: '1',
        name: 'a',
        summary: 's',
      }),
    ).toThrow();
  });

  it('takes maximum lateness as an ISO 8601 duration in days, hours, minutes and seconds', () => {
    const base = { id: 'a.b', version: '1', name: 'A B', summary: 's' };

    const lateness = (maxLateness: string) =>
      eventFrontmatter.safeParse({ ...base, delivery: { maxLateness } }).success;

    expect(['PT30S', 'PT5M', 'PT1H30M', 'P1D', 'P1DT12H', 'PT0.5S'].map(lateness)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    // Months and years have no fixed length, so they cannot be compared.
    expect(['5 minutes', 'P1M', 'P1Y', 'PT', 'P', ''].map(lateness)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
