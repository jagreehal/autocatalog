import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJsonObject } from 'autocatalog-core';
import {
  loadCatalog,
  listEvents,
  describeEvent,
  getSchema,
  getExamples,
  searchEvents,
  findEventsBy,
  getLlmText,
  resolveEvent,
} from '../src/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const starterEvents = path.resolve(here, '../../../../fixtures/event-starter/events');

describe('tools', () => {
  it('loads the starter catalog', async () => {
    const catalog = await loadCatalog(starterEvents);
    expect(catalog.events.length).toBeGreaterThan(0);
  });

  it('listEvents returns summaries', async () => {
    const catalog = await loadCatalog(starterEvents);
    const events = listEvents(catalog);
    expect(events.length).toBeGreaterThan(0);
    const payment = events.find((e) => e.id === 'payment.completed');
    expect(payment).toBeDefined();
    expect(payment!.domain).toBe('payments');
    expect(payment!.status).toBe('active');
    expect(payment!.producers).toContain('PaymentService');
  });

  it('listEvents filters by domain', async () => {
    const catalog = await loadCatalog(starterEvents);
    const events = listEvents(catalog, 'payments');
    expect(events.every((e) => e.domain === 'payments')).toBe(true);
  });

  it('describeEvent returns full record', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = describeEvent(catalog, 'payment.completed');
    expect(result.id).toBe('payment.completed');
    expect(result.schema).toBeDefined();
    expect(isJsonObject(result.schema)).toBe(true);
    expect(result.exampleCount).toBeGreaterThan(0);
  });

  it('describeEvent supports domain/id format', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = describeEvent(catalog, 'payments/payment.completed');
    expect(result.id).toBe('payment.completed');
    expect(result.domain).toBe('payments');
  });

  it('describeEvent throws for unknown events', async () => {
    const catalog = await loadCatalog(starterEvents);
    expect(() => describeEvent(catalog, 'does.not.exist')).toThrow();
  });

  it('getSchema returns the JSON Schema', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = getSchema(catalog, 'payment.completed');
    expect(result.schema.type).toBe('object');
    expect(result.schema.properties).toBeDefined();
  });

  it('getExamples returns example payloads', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = getExamples(catalog, 'payment.completed');
    expect(result.examples.length).toBeGreaterThan(0);
    expect(result.examples[0]!.data).toBeDefined();
  });

  it('getExamples filters by name', async () => {
    const catalog = await loadCatalog(starterEvents);
    const all = getExamples(catalog, 'payment.completed');
    const first = all.examples[0]!;
    const filtered = getExamples(catalog, 'payment.completed', first.name);
    expect(filtered.examples).toHaveLength(1);
    expect(filtered.examples[0]!.name).toBe(first.name);
  });

  it('searchEvents finds by id', async () => {
    const catalog = await loadCatalog(starterEvents);
    const results = searchEvents(catalog, 'payment');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === 'payment.completed')).toBe(true);
  });

  it('searchEvents finds by producer name', async () => {
    const catalog = await loadCatalog(starterEvents);
    const results = searchEvents(catalog, 'PaymentService');
    expect(results.some((r) => r.id === 'payment.completed')).toBe(true);
  });

  it('findEventsBy matches domain', async () => {
    const catalog = await loadCatalog(starterEvents);
    const results = findEventsBy(catalog, 'domain', 'payments');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.domain === 'payments')).toBe(true);
  });

  it('findEventsBy matches array attribute', async () => {
    const catalog = await loadCatalog(starterEvents);
    const results = findEventsBy(catalog, 'producers', 'PaymentService');
    expect(results.some((r) => r.id === 'payment.completed')).toBe(true);
  });

  it('findEventsBy matches status', async () => {
    const catalog = await loadCatalog(starterEvents);
    const results = findEventsBy(catalog, 'status', 'active');
    expect(results.some((r) => r.id === 'payment.completed')).toBe(true);
  });

  it('getLlmText returns markdown for a single event', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = getLlmText(catalog, 'payment.completed');
    expect(result.text).toContain('# Payment Completed');
    expect(result.text).toContain('payment.completed');
    expect(result.text).toContain('## Schema');
    expect(result.text).toContain('```json');
    expect(result.text).toContain('## Example');
  });

  it('getLlmText returns catalog summary when no ref', async () => {
    const catalog = await loadCatalog(starterEvents);
    const result = getLlmText(catalog);
    expect(result.text).toContain('# Event Catalog');
    expect(result.text).toContain('Payment Completed');
  });

  it('resolveEvent resolves by domain/id', async () => {
    const catalog = await loadCatalog(starterEvents);
    const event = resolveEvent(catalog, 'payments/payment.completed');
    expect(event.frontmatter.id).toBe('payment.completed');
  });
});
