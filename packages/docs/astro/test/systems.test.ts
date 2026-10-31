import { describe, expect, it } from 'vitest';
import { buildSystems } from '../src/systems';

describe('buildSystems', () => {
  it('lists systems and external systems from designs, with members', () => {
    const rows = buildSystems(
      [
        {
          repository: 'platform',
          id: 'payments-context',
          title: 'Payments context',
          resources: [
            { id: 'payments-platform', type: 'system', name: 'Payments platform' },
            {
              id: 'stripe',
              type: 'external-system',
              name: 'Stripe',
              summary: 'Card acquirer',
            },
            {
              id: 'PaymentService',
              type: 'service',
              name: 'PaymentService',
              parent: 'payments-platform',
            },
          ],
        },
      ],
      '/',
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'payments-platform',
        name: 'Payments platform',
        external: false,
        members: ['PaymentService'],
        designHref: '/designs/platform/payments-context/',
      }),
      expect.objectContaining({
        id: 'stripe',
        name: 'Stripe',
        external: true,
        summary: 'Card acquirer',
      }),
    ]);
  });
});
