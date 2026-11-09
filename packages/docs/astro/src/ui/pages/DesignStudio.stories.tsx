/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CanvasModel } from '../lib/canvas-model';
import { DesignStudio } from './DesignStudio';

const model: CanvasModel = {
  title: 'Refunds v2',
  resources: [
    {
      id: 'PaymentService',
      type: 'service',
      name: 'PaymentService',
      ref: 'service:PaymentService',
    },
    {
      id: 'RefundService',
      type: 'service',
      name: 'RefundService',
      summary: 'Decides whether a refund is owed and issues it.',
    },
    { id: 'refund-issued', type: 'event', name: 'Refund issued' },
    { id: 'LedgerService', type: 'service', name: 'LedgerService', ref: 'service:LedgerService' },
  ],
  relations: [
    { from: 'RefundService', to: 'refund-issued', kind: 'sends' },
    { from: 'refund-issued', to: 'LedgerService', kind: 'receives' },
  ],
};

const meta = {
  title: 'Pages/DesignStudio',
  component: DesignStudio,
  parameters: { layout: 'fullscreen' },
  // The check URL answers nothing in Storybook: an edit stays unsaved, with the last review.
  args: {
    title: 'Refunds v2',
    file: 'payments/designs/refunds-v2.md',
    designHref: '/designs/payments/refunds-v2/',
    checkUrl: '/designs/payments/refunds-v2/edit.json',
    watchFile: '/repos/payments/designs/refunds-v2.md',
    model,
    review: {
      changes: '1 new service, 1 new event and 2 new relations',
      added: [
        { id: 'RefundService', name: 'RefundService', type: 'service' },
        { id: 'refund-issued', name: 'Refund issued', type: 'event' },
      ],
      impact: [
        {
          name: 'LedgerService',
          kind: 'service',
          owner: 'finance-team',
          changes: ['it receives Refund issued'],
          dependents: ['PaymentService', 'ReportingService'],
        },
      ],
      runtime: {
        relations: [
          {
            from: 'PaymentService',
            to: 'payment-completed',
            kind: 'sends',
            evidence: { state: 'observed', count: 1200, event: 'payment.completed' },
          },
        ],
        undrawn: [
          { event: 'payment.completed', service: 'AuditService', role: 'consumes', count: 40 },
        ],
      },
    },
  },
} satisfies Meta<typeof DesignStudio>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A design just started: an empty canvas that touches no one. */
export const Blank: Story = {
  args: {
    model: { title: 'Refunds v2', resources: [], relations: [] },
    review: { changes: 'Nothing yet', added: [], impact: [] },
  },
};
