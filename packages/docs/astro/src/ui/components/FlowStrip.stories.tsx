/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowStrip } from './FlowStrip';

const meta = {
  title: 'Components/FlowStrip',
  component: FlowStrip,
  args: {
    label: 'Message flow',
    from: [{ label: 'PaymentService', href: '/services/PaymentService', kind: 'service' }],
    inbound: 'publishes',
    centre: {
      label: 'Payment completed',
      href: '/events/payment.completed',
      kind: 'event',
      detail: 'v2.0.0',
    },
    outbound: 'subscribed by',
    to: [
      { label: 'LedgerService', href: '/services/LedgerService', kind: 'service' },
      { label: 'AuditService', href: '/services/AuditService', kind: 'service' },
    ],
  },
} satisfies Meta<typeof FlowStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NothingDeclared: Story = { args: { from: [], to: [] } };

export const UnlinkedNeighbours: Story = {
  args: {
    from: [{ label: 'ExternalGateway' }],
    to: [{ label: 'LedgerService', kind: 'service' }],
  },
};

/** A service's flow: the events it consumes on the left, the ones it produces on the right. */
export const ServiceProducesOnly: Story = {
  args: {
    from: [],
    inbound: 'consumed by',
    centre: { label: 'PaymentService', kind: 'service' },
    outbound: 'produces',
    to: [
      { label: 'Payment completed', href: '/events/payment.completed', kind: 'event' },
      { label: 'Payment refunded', href: '/events/payment.refunded', kind: 'event' },
    ],
  },
};
