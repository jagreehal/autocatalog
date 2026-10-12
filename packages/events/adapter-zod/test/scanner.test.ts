import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { eventFrontmatter } from 'autocatalog-core';
import { domainForFile, idFromSymbol, scanRepo } from '../src/scanner';

const here = path.dirname(fileURLToPath(import.meta.url));

const demoRepo = path.resolve(here, '../../../../fixtures/demo-repo');

describe('idFromSymbol', () => {
  it('strips Event/EventSchema/Schema suffixes and dots the camel case', () => {
    expect(idFromSymbol('ParcelShippedEvent')).toBe('parcel.shipped');
    expect(idFromSymbol('ParcelShippedEventSchema')).toBe('parcel.shipped');
    expect(idFromSymbol('PaymentCompleted')).toBe('payment.completed');
    expect(idFromSymbol('KYCSubmittedEvent')).toBe('kycsubmitted');
  });
});

describe('domainForFile', () => {
  it('uses the parent directory name when meaningful', () => {
    expect(domainForFile('src/shipping/parcel-events.ts', 'parcel.shipped')).toBe('shipping');
  });
  it('falls back to the first id segment for generic directories', () => {
    expect(domainForFile('src/parcel-events.ts', 'parcel.shipped')).toBe('parcel');
  });
});

describe('scanRepo against fixtures/demo-repo', () => {
  let out: string;

  beforeEach(async () => {
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'ac-scan-'));
  });
  afterEach(async () => {
    await fs.rm(out, { recursive: true, force: true });
  });

  async function manifest(rel: string): Promise<z.input<typeof eventFrontmatter>> {
    return JSON.parse(await fs.readFile(path.join(out, rel, 'autocatalog.json'), 'utf8'));
  }

  it('discovers all four events, with warts intact', async () => {
    const result = await scanRepo({ root: demoRepo, out });

    expect(result.errors).toEqual([]);
    expect(result.eventsWritten).toBe(4);
    const ids = result.findings.map((f) => f.id).sort();
    expect(ids).toEqual(['invoice.raised', 'order.placed', 'parcel.shipped', 'payment.completed']);

    // defineEvent with full identity → extracted, high confidence, source-linked
    const payment = await manifest('payments/PaymentCompleted');
    expect(payment.provenance?.default).toBe('extracted');
    expect(payment.needsReview).toBeUndefined();
    expect(payment.confidence).toBeGreaterThan(0.9);
    expect(payment.source).toMatchObject({
      type: 'code',
      file: 'src/payments/payment-events.ts',
      symbol: 'PaymentCompleted',
    });
    expect(payment.source?.line).toBeGreaterThan(0);
    expect(payment.owner).toEqual({ team: 'Billing' });
    expect(payment.consumers).toContain('LedgerService');

    // deprecated wart survives extraction
    const invoice = await manifest('billing/InvoiceRaised');
    expect(invoice.status).toBe('deprecated');
    expect(invoice.deprecation?.replacedBy?.id).toBe('payment.completed');

    // no-examples wart → a deterministic baseline example is generated
    const orderExamples = await fs.readdir(path.join(out, 'orders/OrderPlaced/examples'));
    expect(orderExamples).toEqual(['generated.json']);
    const order = await manifest('orders/OrderPlaced');
    expect(order.provenance?.fields?.examples).toBe('inferred');

    const generated = JSON.parse(
      await fs.readFile(path.join(out, 'orders/OrderPlaced/examples/generated.json'), 'utf8'),
    );

    expect(generated).toHaveProperty('orderId');
    expect(generated.lines).toHaveLength(1);
    // no CODEOWNERS rule for orders → no owner invented
    expect(order.owner).toBeUndefined();

    // convention-only wart → inferred + needs review + low confidence
    const parcel = await manifest('shipping/ParcelShipped');
    // CODEOWNERS src/shipping/ rule → owner inferred, and labeled as such
    expect(parcel.owner).toEqual({ team: 'acme/logistics' });
    expect(parcel.provenance?.fields?.owner).toBe('inferred');
    expect(parcel.provenance?.default).toBe('inferred');
    expect(parcel.needsReview).toBe(true);
    expect(parcel.confidence).toBeLessThan(0.5);
    expect(parcel.provenance?.fields?.id).toBe('inferred');
    expect(parcel.source?.symbol).toBe('ParcelShippedEvent');
    expect(parcel.domain).toBe('shipping');

    // non-convention export in the same file is not an event
    const shippingFolders = await fs.readdir(path.join(out, 'shipping'));
    expect(shippingFolders).toEqual(['ParcelShipped']);
  });

  it('emits valid JSON Schema converted from zod', async () => {
    await scanRepo({ root: demoRepo, out });

    const schema = JSON.parse(
      await fs.readFile(path.join(out, 'payments/PaymentCompleted/schema.json'), 'utf8'),
    );

    expect(schema.type).toBe('object');
    expect(schema.properties.amountMinor.type).toBe('integer');
    expect(schema.required).toContain('paymentId');
  });

  it('scanned output passes catalog validation', async () => {
    await scanRepo({ root: demoRepo, out });
    const { validateCatalog } = await import('autocatalog-core');
    const result = await validateCatalog(out);
    expect(result.errors).toEqual([]);
  });
});
