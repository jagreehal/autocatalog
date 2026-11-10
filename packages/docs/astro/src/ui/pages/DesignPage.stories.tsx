/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DesignPage } from './DesignPage';

const meta = {
  title: 'Pages/DesignPage',
  component: DesignPage,
  parameters: { layout: 'fullscreen' },
  args: {
    repository: 'payments',
    file: 'designs/refunds-v2.md',
    status: 'proposed',
    changes: '1 new service, 1 new event and 2 new relations',
    visualiser: {
      graph: {
        nodes: [
          { id: 'PaymentService', type: 'service', label: 'PaymentService', metadata: {} },
          { id: 'RefundService', type: 'service', label: 'RefundService', metadata: {} },
          { id: 'refund-issued', type: 'event', label: 'Refund issued', metadata: {} },
          { id: 'LedgerService', type: 'service', label: 'LedgerService', metadata: {} },
        ],
        edges: [
          {
            id: 'RefundService->refund-issued',
            source: 'RefundService',
            target: 'refund-issued',
            type: 'publishes',
            label: 'publishes',
          },
          {
            id: 'refund-issued->LedgerService',
            source: 'refund-issued',
            target: 'LedgerService',
            type: 'subscribes',
            label: 'subscribed by',
          },
        ],
        options: { legend: true, search: false },
      },
      hrefs: {
        PaymentService: '/services/PaymentService/',
        LedgerService: '/services/LedgerService/',
      },
      proposed: ['RefundService', 'refund-issued'],
    },
    resources: [
      {
        id: 'PaymentService',
        name: 'PaymentService',
        type: 'service',
        state: 'catalog',
        href: '/services/PaymentService/',
      },
      {
        id: 'RefundService',
        name: 'RefundService',
        type: 'service',
        summary: 'Decides whether a refund is owed and issues it.',
        state: 'new',
      },
      { id: 'refund-issued', name: 'Refund issued', type: 'event', state: 'new' },
      {
        id: 'LedgerService',
        name: 'LedgerService',
        type: 'service',
        state: 'catalog',
        href: '/services/LedgerService/',
      },
    ],
    relations: [
      { from: 'RefundService', to: 'Refund issued', kind: 'sends', state: 'new' },
      { from: 'LedgerService', to: 'Refund issued', kind: 'receives', state: 'new' },
    ],
    notes: [
      { text: 'Partial refunds come later.', on: 'RefundService' },
      { text: 'Agree the event shape with the ledger team first.' },
    ],
    hotspots: [
      {
        title: 'Two services write refunds during the move',
        severity: 'critical',
        description: 'PaymentService keeps issuing refunds until RefundService is live.',
        on: 'PaymentService',
      },
      { title: 'No owner for RefundService yet', severity: 'warning', on: 'RefundService' },
      { title: 'Retention follows the ledger', severity: 'info' },
    ],
    narrativeHtml:
      '<h2>Why</h2><p>Refunds are slow to change inside PaymentService, and finance wants them audited on their own.</p>',
  },
} satisfies Meta<typeof DesignPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Under `ac site` dev, where it can be opened on the canvas. */
export const Editable: Story = { args: { editHref: '/designs/payments/refunds-v2/edit/' } };

/** Just started: nothing drawn, so the resource table stands in for the map. */
export const Draft: Story = {
  args: {
    status: 'draft',
    changes: 'Nothing yet',
    visualiser: undefined,
    resources: [],
    relations: [],
    notes: [],
    hotspots: [],
    narrativeHtml: null,
  },
};

export const Rejected: Story = { args: { status: 'rejected' } };
