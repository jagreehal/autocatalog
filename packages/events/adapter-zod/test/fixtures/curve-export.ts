export const jsonSchemas = [
  {
    name: 'v1.payment.completed',
    description: 'Fires when a payment completes',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'string' }, amount: { type: 'number' } },
    },
    example: { id: 'pay_1', amount: 4999 },
  },
  {
    name: 'v1.payment.failed',
    description: 'Fires when a payment fails',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'string' }, reason: { type: 'string' } },
    },
    example: { id: 'pay_2', reason: 'declined' },
  },
];
