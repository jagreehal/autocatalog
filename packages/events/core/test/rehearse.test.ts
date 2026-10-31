import { describe, expect, it } from 'vitest';
import {
  assessEventChange,
  renderDriftMarkdown,
  summariseDrift,
  type SchemaNode,
} from '../src/index';

const payment = (properties: Record<string, SchemaNode>, required: string[]): SchemaNode => ({
  type: 'object',
  properties,
  required,
});

const change = (previous: SchemaNode, proposed: SchemaNode) =>
  assessEventChange({
    domain: 'payments',
    eventId: 'payment.completed',
    consumers: ['LedgerService', 'Notifications'],
    consumerFields: { LedgerService: ['amount'], Notifications: ['id'] },
    previous,
    proposed,
  });

describe('change rehearsal', () => {
  it('shows a payload without a removed required field, and the check it fails', () => {
    const [finding] = change(
      payment({ id: { type: 'string' }, amount: { type: 'number' } }, ['id', 'amount']),
      payment({ id: { type: 'string' } }, ['id']),
    );

    expect(finding).toMatchObject({
      kind: 'field_removed',
      consumers: ['LedgerService'],
      rehearsal: { payload: { id: 'string' }, failure: '/amount is required' },
    });
  });

  it('shows the new type a field now allows', () => {
    const [finding] = change(
      payment({ amount: { type: 'number' } }, ['amount']),
      payment({ amount: { type: 'string' } }, ['amount']),
    );

    expect(finding?.rehearsal).toEqual({
      payload: { amount: 'string' },
      failure: '/amount must be number',
    });
  });

  it('finds the change inside an array of objects', () => {
    const items = (amount: SchemaNode) =>
      payment({ items: { type: 'array', items: payment({ amount }, ['amount']) } }, ['items']);

    const [finding] = change(items({ type: 'number' }), items({ type: 'string' }));

    expect(finding?.rehearsal).toEqual({
      payload: { items: [{ amount: 'string' }] },
      failure: '/items/0/amount must be number',
    });
  });

  it('takes out a field that stopped being required', () => {
    const [finding] = change(
      payment({ amount: { type: 'number' } }, ['amount']),
      payment({ amount: { type: 'number' } }, []),
    );

    expect(finding?.rehearsal?.payload).toEqual({});
  });

  it('pins each rehearsal on its own change when one diff makes several', () => {
    const findings = change(
      payment({ amount: { type: 'number' }, name: { type: 'string', maxLength: 50 } }, [
        'amount',
        'name',
      ]),
      payment({ name: { type: 'string', maxLength: 10 } }, ['name']),
    );

    expect(findings.find((f) => f.kind === 'field_removed')?.rehearsal?.failure).toBe(
      '/amount is required',
    );

    // A tighter name breaks no old reader: nothing to rehearse, and never the removal's failure.
    for (const finding of findings.filter((f) => f.kind !== 'field_removed')) {
      expect(finding.rehearsal).toBeUndefined();
    }
  });

  it('repairs the rest of the payload so the failure is only the change shown', () => {
    const findings = change(
      payment({ amount: { type: 'number' }, name: { type: 'string' } }, ['amount', 'name']),
      payment(
        { amount: { type: 'number' }, name: { type: 'integer' }, extra: { type: 'string' } },
        ['name'],
      ),
    );

    expect(findings.find((f) => f.kind === 'type_changed')?.rehearsal).toEqual({
      payload: { amount: 0, name: 0, extra: 'string' },
      failure: '/name must be string',
    });
  });

  it('claims nothing when no payload separates the schemas', () => {
    const findings = change(
      payment({ amount: { type: 'number' } }, []),
      payment({ amount: { type: 'number' } }, ['amount']),
    );

    expect(findings.every((finding) => finding.rehearsal === undefined)).toBe(true);
  });

  it('prints the payload under the finding', () => {
    const markdown = renderDriftMarkdown(
      summariseDrift(
        change(
          payment({ id: { type: 'string' }, amount: { type: 'number' } }, ['id', 'amount']),
          payment({ id: { type: 'string' } }, ['id']),
        ),
      ),
    );

    expect(markdown).toContain(
      'Rehearsal: the proposed schema accepts this payload; the current contract rejects it (`/amount is required`)',
    );
    expect(markdown).toContain('    {\n      "id": "string"\n    }');
  });
});
