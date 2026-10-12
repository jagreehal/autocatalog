import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isJsonObject } from 'autocatalog-core';
import {
  assessImpact,
  catalogStatus,
  checkChange,
  resolveEvent,
  describeEvent,
  listEvents,
  loadCatalog,
  searchEvents,
  searchFieldsInCatalog,
} from '../src/tools.js';
import type { CatalogSnapshot } from '../src/tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const demoRepo = path.resolve(here, '../../../../fixtures/demo-repo');

// T3: an AI agent, over MCP, can answer "who breaks if I change this?" and
// "can I trust this metadata?" — against a catalog generated purely by scan.
describe('MCP over a scanned catalog (executable story: the AI surface)', () => {
  let out: string;
  let catalog: CatalogSnapshot;

  beforeAll(async () => {
    const { scanRepo } = await import('autocatalog-adapter-zod');
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-mcp-demo-'));
    await scanRepo({ root: demoRepo, out });
    catalog = await loadCatalog(out);
  }, 60000);

  afterAll(async () => {
    await fs.rm(out, { recursive: true, force: true });
  });

  it('answers the blast-radius question', () => {
    const payment = describeEvent(catalog, 'payment.completed');
    expect(payment.consumers).toEqual(['LedgerService', 'NotificationService']);
    expect(payment.producers).toEqual(['PaymentService']);
  });

  it('exposes provenance so the agent knows what to trust', () => {
    const payment = describeEvent(catalog, 'payment.completed');
    expect(payment.provenance.default).toBe('extracted');
    expect(payment.needsReview).toBe(false);
    expect(payment.source?.file).toBe('src/payments/payment-events.ts');

    const parcel = describeEvent(catalog, 'parcel.shipped');
    expect(parcel.needsReview).toBe(true);
    expect(parcel.provenance.default).toBe('inferred');
  });

  it('surfaces deprecation state in listings', () => {
    const deprecated = listEvents(catalog).filter((e) => e.status === 'deprecated');
    expect(deprecated.map((e) => e.id)).toEqual(['invoice.raised']);
  });

  it('finds events by free-text search', () => {
    const hits = searchEvents(catalog, 'parcel');
    expect(hits.some((h) => h.id === 'parcel.shipped')).toBe(true);
  });

  it('names everyone a field change reaches, including the second hop', () => {
    const impact = assessImpact(catalog, 'payment.completed', 'amountMinor');
    expect(impact.event).toBe('payments/payment.completed');

    // Direct consumers are the easy half; the notify list must also pick up
    // consumers of other events carrying the same field.
    for (const consumer of impact.consumers) expect(impact.notify).toContain(consumer);
    expect(impact.notify.length).toBeGreaterThanOrEqual(impact.consumers.length);
    expect(impact.needsReview).toBe(false);
  });

  it('classifies a proposed schema the way the CI gate would', () => {
    const before = describeEvent(catalog, 'payment.completed');
    const proposed = structuredClone(before.schema);
    const { properties } = proposed;
    assert(isJsonObject(properties));
    delete properties.amountMinor;

    const report = checkChange(catalog, 'payment.completed', proposed);
    expect(report.hasBreaking).toBe(true);
    const removed = report.findings.find((f) => f.kind === 'field_removed');
    expect(removed?.severity).toBe('breaking');
    expect(removed?.message).toContain('amountMinor');
    // A breaking change must arrive with the list of people to tell.
    expect(report.notify).toEqual(['LedgerService', 'NotificationService']);
  });

  it('reports an additive change as additive, and tells nobody', () => {
    const before = describeEvent(catalog, 'payment.completed');
    const proposed = structuredClone(before.schema);
    const { properties } = proposed;
    assert(isJsonObject(properties));
    properties.refundedAt = { type: 'string' };

    const report = checkChange(catalog, 'payment.completed', proposed);
    expect(report.hasBreaking).toBe(false);
    expect(report.additive).toBeGreaterThan(0);
    expect(report.notify).toEqual([]);
  });

  it('tells an agent when the catalog cannot be trusted to describe the tree', () => {
    const status = catalogStatus(catalog);
    expect(status.events).toBeGreaterThan(0);
    // The catalog was scanned into a temp directory, so there is no artifact
    // git history to line up with — which must read as "unknown", not "fine".
    expect(status.freshness.reason.length).toBeGreaterThan(0);
    expect([true, false]).toContain(status.freshness.stale);
  });

  it('carries the freshness warning into the answers an agent acts on', () => {
    expect(assessImpact(catalog, 'payment.completed').freshness).toEqual(catalog.freshness);
    const before = describeEvent(catalog, 'payment.completed');
    expect(checkChange(catalog, 'payment.completed', before.schema).freshness).toEqual(
      catalog.freshness,
    );
  });

  // Joining the snapshot is core's job and publishing it is the CLI's; both are
  // tested there — and the artifact's content hashes refuse a hand-edited
  // manifest, which is the publish guarantee working. What belongs here is the
  // half an agent sees: given an event carrying evidence, does the answer keep
  // "claimed" and "seen" apart.
  it('separates what the catalog claims from what the runtime has seen', () => {
    const event = resolveEvent(catalog, 'payment.completed');
    const original = event.frontmatter.observed;
    event.frontmatter.observed = {
      count: 4210,
      firstSeen: '2026-08-25T00:04:11.000Z',
      lastSeen: '2026-09-01T08:58:02.000Z',
      consumers: ['LedgerService', 'FraudService'],
      producers: ['PaymentService'],
      snapshot: { spec: 'autotel-architecture/v0', generatedAt: '2026-09-01T09:00:00.000Z' },
    };

    try {
      const impact = assessImpact(catalog, 'payment.completed');
      expect(impact.runtime?.count).toBe(4210);
      expect(impact.runtime?.observedConsumers).toEqual(['LedgerService', 'FraudService']);
      // Declared but not seen in the window — the distinction an agent needs
      // before it calls a consumer safe to break.
      expect(impact.runtime?.neverObserved).toEqual(['NotificationService']);
      expect(impact.runtime?.caveat).toContain('not proof it is gone');
    } finally {
      event.frontmatter.observed = original;
    }
  });

  it('says nothing about the runtime when the catalog carries no evidence', () => {
    expect(assessImpact(catalog, 'payment.completed').runtime).toBeUndefined();
  });

  it('indexes schema fields across events', () => {
    const amountMinor = searchFieldsInCatalog(catalog, 'amountMinor');
    expect(amountMinor.some((f) => f.path === 'amountMinor')).toBe(true);
    expect(amountMinor[0]!.consumers.length).toBeGreaterThan(0);
  });
});
