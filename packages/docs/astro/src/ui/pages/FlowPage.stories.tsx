/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowPage } from './FlowPage';

const meta = {
  title: 'Pages/FlowPage',
  component: FlowPage,
  parameters: { layout: 'fullscreen' },
  args: {
    repository: 'acme-platform',
    file: 'flows/order-to-dispatch.md',
    visualiser: {
      graph: {
        nodes: [
          { id: 'customer', type: 'actor', label: 'Customer', metadata: {} },
          { id: 'pay', type: 'service', label: 'PaymentService', metadata: {} },
          { id: 'declined', type: 'step', label: 'Ask for another card', metadata: {} },
        ],
        edges: [
          {
            id: 'customer->pay',
            source: 'customer',
            target: 'pay',
            type: 'flow-step',
            label: 'Pays',
          },
          {
            id: 'pay->declined',
            source: 'pay',
            target: 'declined',
            type: 'flow-step',
            label: 'Card declined',
          },
        ],
      },
      hrefs: { pay: '/services/PaymentService/' },
      steps: {
        customer: { step: { id: 'customer', title: 'Customer' }, lanes: { external: true } },
        pay: {
          step: { id: 'pay', title: 'Take payment' },
          lanes: { domain: { id: 'payments', name: 'payments' } },
        },
        declined: { step: { id: 'declined', title: 'Ask for another card' } },
      },
    },
    steps: [
      {
        id: 'customer',
        title: 'Customer',
        kind: 'actor',
        next: [{ title: 'PaymentService', label: 'Pays' }],
      },
      {
        id: 'pay',
        title: 'PaymentService',
        kind: 'service',
        href: '/services/PaymentService/',
        next: [{ title: 'Ask for another card', label: 'Card declined' }],
      },
      { id: 'declined', title: 'Ask for another card', kind: 'custom', next: [] },
    ],
    narrativeHtml: '<p>Shipping starts only once payment is taken.</p>',
  },
} satisfies Meta<typeof FlowPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithEvidence: Story = {
  args: {
    steps: [
      {
        id: 'started',
        title: 'Capture started',
        kind: 'custom',
        next: [],
        transition: { field: 'payment.status', change: 'authorised → capturing' },
        rules: ['A payment is captured once'],
        stuck: { signs: 'no capture task is running' },
        evidence: [
          { label: 'Declared in model', value: 'yes' },
          { label: 'Observed', value: 'not instrumented' },
          { label: 'Business rules', value: 'not checked' },
        ],
        notes: [
          {
            title: 'Investigating a stuck capture',
            href: '#',
            nature: 'question',
            status: 'draft',
            hotspot: true,
          },
        ],
      },
    ],
    evidence: {
      checkedAt: '2026-11-06',
      commit: 'abc1234',
      stale: true,
      undeclared: ['captured → authorised, recorded 2 times via unknown, is in no flow.'],
    },
  },
};
