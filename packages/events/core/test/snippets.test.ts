import { describe, expect, it } from 'vitest';
import { generateSnippets } from '../src/snippets';

const event = {
  id: 'payment.completed',
  version: '1.0.0',
  name: 'Payment Completed',
  domain: 'payments',
  schema: {
    type: 'object',
    required: ['id', 'amount'],
    properties: {
      id: { type: 'string' },
      amount: { type: 'integer' },
      currency: { type: 'string', enum: ['GBP', 'USD'] },
      completedAt: { type: 'string', format: 'date-time' },
    },
  },
  example: { id: 'pay_1', amount: 4999, currency: 'GBP', completedAt: '2026-05-22T10:00:00Z' },
  baseUrl: 'https://events.example.com',
};

describe('generateSnippets', () => {
  it('emits a curl command using the example payload', () => {
    const { curl } = generateSnippets(event);
    expect(curl).toContain('curl');
    expect(curl).toContain('pay_1');
    expect(curl).toContain('Content-Type: application/json');
  });

  it('emits a zod schema with required + optional fields', () => {
    const { zod } = generateSnippets(event);
    expect(zod).toContain('z.object({');
    expect(zod).toContain('id: z.string()');
    expect(zod).toContain('amount: z.number().int()');
    expect(zod).toContain("currency: z.enum(['GBP', 'USD']).optional()");
    expect(zod).toContain('z.string().datetime()');
  });

  it('emits a pydantic class', () => {
    const { pydantic } = generateSnippets(event);
    expect(pydantic).toContain('class PaymentCompleted(BaseModel):');
    expect(pydantic).toContain('id: str');
    expect(pydantic).toContain('amount: int');
    expect(pydantic).toContain('currency: Optional[Literal["GBP", "USD"]] = None');
  });

  it('emits a stable schema-ref URL', () => {
    const { ref } = generateSnippets(event);
    expect(ref).toBe('https://events.example.com/events/payments/payment.completed/schema.json');
  });
});
