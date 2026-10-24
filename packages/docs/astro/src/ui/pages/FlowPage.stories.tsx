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
