import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Retirement } from 'autocatalog-core';
import { runRetire } from '../src/commands/retire';

describe('ac retire', () => {
  let dir: string;
  let events: string;

  const pact = (consumer: string, contents: Record<string, number | string>) => ({
    consumer: { name: consumer },
    provider: { name: 'PaymentService' },
    messages: [{ description: 'a PaymentCompleted event', contents }],
  });

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autocatalog-retire-test-'));
    events = path.join(dir, 'events');

    const folder = path.join(events, 'payments', 'PaymentCompleted');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, 'autocatalog.json'),
      JSON.stringify({
        id: 'payment.completed',
        version: '1.0.0',
        name: 'Payment Completed',
        summary: 'A payment completed.',
        domain: 'payments',
        producers: ['PaymentService'],
        consumers: ['BillingService', 'LedgerService', 'FraudService'],
        consumerFields: { BillingService: ['paymentId'], LedgerService: ['amount'] },
      }),
    );
    await fs.writeFile(
      path.join(folder, 'schema.json'),
      JSON.stringify({
        type: 'object',
        properties: { paymentId: { type: 'string' }, amount: { type: 'number' } },
      }),
    );

    await fs.mkdir(path.join(dir, 'pacts'));
    await fs.writeFile(
      path.join(dir, 'pacts', 'fraud.json'),
      JSON.stringify(pact('FraudService', { paymentId: 'p-1' })),
    );
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const retire = async (options: Partial<Parameters<typeof runRetire>[0]> = {}) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const code = await runRetire({
        event: 'payment.completed',
        field: 'amount',
        events,
        repository: 'payments-service',
        format: 'json',
        ...options,
      });

      // SAFETY: --format json prints the assessment and nothing else.
      return { code, retirement: JSON.parse(String(log.mock.calls[0]?.[0])) as Retirement };
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  };

  const standings = (retirement: Retirement) =>
    retirement.consumers.map((c) => `${c.consumer} ${c.standing}`);

  it('blocks on a consumer that reads the field and one that declares nothing', async () => {
    const { code, retirement } = await retire();

    expect(code).toBe(1);
    expect(standings(retirement)).toEqual([
      'LedgerService reads',
      'FraudService unspecified',
      'BillingService clear',
    ]);
  });

  it('lets a pact file settle a consumer that declared no fields', async () => {
    const { retirement } = await retire({ pacts: path.join(dir, 'pacts') });

    expect(standings(retirement)).toEqual([
      'LedgerService reads',
      'BillingService clear',
      'FraudService clear',
    ]);
    expect(retirement.consumers[2]!.evidence[1]!.says).toBe(
      'pact does not use amount; not verified',
    );
  });

  it('reads the latest pacts and their verification from a Pact Broker, and only from it', async () => {
    const server = http.createServer((request, response) => {
      // SAFETY: listening on a TCP port, so the address is an AddressInfo.
      const base = `http://localhost:${(server.address() as AddressInfo).port}`;

      const routes = new Map(
        Object.entries({
          '/pacts/provider/PaymentService/latest': {
            _links: {
              'pb:pacts': [
                { href: `${base}/pacts/ledger` },
                { href: `${base}/pacts/fraud` },
                { href: 'http://elsewhere.invalid/pacts/x' },
              ],
            },
          },
          '/pacts/ledger': {
            ...pact('LedgerService', { amount: 12 }),
            _links: { 'pb:latest-verification-results': { href: `${base}/verified/ledger` } },
          },
          '/pacts/fraud': pact('FraudService', { paymentId: 'p-1' }),
          '/verified/ledger': { success: false, providerApplicationVersion: '9.1.0' },
        }),
      );

      const body = routes.get(request.url ?? '');

      response.writeHead(body ? 200 : 404, { 'content-type': 'application/hal+json' });
      response.end(JSON.stringify(body ?? {}));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // SAFETY: listening on a TCP port, so the address is an AddressInfo.
      const { port } = server.address() as AddressInfo;
      const { retirement } = await retire({ pacts: `http://localhost:${port}` });

      expect(
        retirement.consumers.find((c) => c.consumer === 'LedgerService')?.evidence,
      ).toContainEqual({
        source: 'Pact Broker',
        standing: 'reads',
        says: 'pact expects amount; failed verification against 9.1.0',
      });
      expect(standings(retirement)).toContain('FraudService clear');
    } finally {
      server.close();
    }
  });

  it('blocks rather than pass on pacts it did not read', async () => {
    const many = path.join(dir, 'many-pacts');

    await fs.mkdir(many);
    await Promise.all(
      Array.from({ length: 201 }, (_, i) =>
        fs.writeFile(
          path.join(many, `${String(i).padStart(3, '0')}.json`),
          JSON.stringify(pact('FraudService', i === 200 ? { note: 'x' } : { paymentId: 'p' })),
        ),
      ),
    );

    const capped = await retire({ field: 'note', pacts: many });

    expect(capped.code).toBe(1);
    expect(capped.retirement.gaps).toEqual(['1 pact file(s) past the first 200']);

    const odd = path.join(dir, 'odd-pacts');

    await fs.mkdir(odd);
    await fs.writeFile(
      path.join(odd, 'ledger.json'),
      JSON.stringify({ consumer: { name: 'LedgerService' }, messages: 'see the wiki' }),
    );

    const malformed = await retire({ field: 'note', pacts: odd });

    expect(malformed.code).toBe(1);
    expect(malformed.retirement.gaps[0]).toMatch(/^ledger\.json: not a pact/);

    const empty = path.join(dir, 'empty-pacts');

    await fs.mkdir(empty);

    const none = await retire({ field: 'note', pacts: empty });

    expect(none.code).toBe(1);
    expect(none.retirement.gaps).toEqual([
      `no pact in ${empty} has a message for payments/payment.completed`,
    ]);

    const unreachable = await retire({ field: 'note', pacts: 'http://127.0.0.1:9/' });

    expect(unreachable.code).toBe(1);
    expect(unreachable.retirement.gaps[0]).toMatch(/^pacts from http:\/\/127\.0\.0\.1:9\//);
  });

  it('stops reading a pact larger than a pact can be, and blocks on it', async () => {
    const server = http.createServer((request, response) => {
      // SAFETY: listening on a TCP port, so the address is an AddressInfo.
      const base = `http://localhost:${(server.address() as AddressInfo).port}`;

      if (request.url === '/pacts/provider/PaymentService/latest') {
        response.end(JSON.stringify({ _links: { 'pb:pacts': [{ href: `${base}/pacts/huge` }] } }));

        return;
      }

      // Chunked, with no length to refuse it by up front.
      response.write('{"padding":"');

      for (let i = 0; i < 5; i += 1) response.write('x'.repeat(1024 * 1024));

      response.end('"}');
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));

    try {
      // SAFETY: listening on a TCP port, so the address is an AddressInfo.
      const { port } = server.address() as AddressInfo;

      const { code, retirement } = await retire({
        field: 'note',
        pacts: `http://localhost:${port}`,
      });

      expect(code).toBe(1);
      expect(retirement.gaps[0]).toMatch(/larger than a pact$/);
    } finally {
      server.close();
    }
  });

  it('is ready once every consumer is clear, and counts who the snapshot saw', async () => {
    const snapshot = path.join(dir, 'snapshot.json');

    await fs.writeFile(
      snapshot,
      JSON.stringify({
        spec: 'autotel-architecture/v1',
        generatedAt: '2026-10-01T00:00:00Z',
        service: 'payments',
        events: {
          'payment.completed': {
            name: 'payment.completed',
            observedCount: 3,
            firstSeen: '',
            lastSeen: '',
            fieldPaths: ['amount', 'paymentId'],
            consumers: ['AuditService'],
          },
        },
      }),
    );

    const blocked = await retire({ field: 'note', snapshot, pacts: path.join(dir, 'pacts') });

    expect(standings(blocked.retirement)).toContain('AuditService unknown');
    expect(blocked.retirement.runtime).toBe('not sent (snapshot of 2026-10-01)');

    const ready = await retire({ field: 'note', pacts: path.join(dir, 'pacts') });

    // FraudService's pact is the only word on it, and it does not use `note`.
    expect(standings(ready.retirement)).toEqual([
      'BillingService clear',
      'FraudService clear',
      'LedgerService clear',
    ]);
    expect(ready.code).toBe(0);
  });
});
